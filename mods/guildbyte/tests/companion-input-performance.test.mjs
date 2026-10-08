import assert from 'node:assert/strict'
import {register} from '../hooks/register.mjs'
import {COMPANION_STATES} from '../scripts/companion-animation.mjs'
const hooks=new Map(),state=new Map(),timers=[],blits=[],writes=[],requests=[]
let now=10000,holdPaint,releasePaint,releaseWorker,renderOnWrite=false,fullBandImages=0
const workerGate=new Promise(resolve=>{releaseWorker=resolve})
const originalNow=Date.now,originalBtoa=globalThis.btoa;let encodings=0
Date.now=()=>now;globalThis.btoa=value=>{encodings++;return originalBtoa(value)}
const raw=Buffer.alloc(128*128*4);raw.set([255,0,0,255],(64*128+64)*4)
const rgba=raw.toString('base64'),frames=Array(28).fill('png')
const clips=Object.fromEntries(COMPANION_STATES.map((name,i)=>[name,{frames:[i*2,i*2+1],durations:[100,100]}]))
clips.idle={frames:[0],durations:[2000]}
const animation={frames,mirroredFrames:Object.fromEntries(frames.map((png,i)=>[i,png])),clips}
const pixels={width:128,height:128,frames:Array(28).fill(rgba),mirroredFrames:Object.fromEntries(frames.map((_,i)=>[i,rgba]))}
let response={connected:true,character:{id:'hero',level:1,xp:0,png:'png',animation},pixels}
const flush=()=>new Promise(resolve=>setImmediate(resolve)),next=async e=>e
const $={plugin:{root:'/plugin'},session:{id:async()=>'session',usage:async()=>({})},env:{get:async key=>key==='TERM_PROGRAM'?'ghostty':undefined},command:{register:async()=>{}},state:{get:async key=>({value:state.get(key.key)}),set:async(key,value)=>{writes.push(key.key);state.set(key.key,value);if(renderOnWrite)fullBandImages+=images(await render()).length}},clock:{every:(ms,fn)=>{const timer={ms,fn,cancelled:false,cancel(){this.cancelled=true}};timers.push(timer);return timer}},ui:{resolve:()=>Object.fromEntries(['Box','Image','Button','Text'].map(type=>[type,props=>({type,props})])),blit:async args=>{blits.push(args);if(holdPaint)await holdPaint;return{}}},process:{spawn:async function*({input}){requests.push(JSON.parse(input));await workerGate;yield{stream:'stdout',text:JSON.stringify(response)};return{code:0}}}}
register((event,match,hook)=>{if(typeof match==='function'){hook=match;match={}}hooks.set(event+(match.command?':'+match.command:''),hook)})
const tick=async()=>{now+=80;timers.find(t=>t.ms===80&&!t.cancelled).fn();await flush()}
const images=node=>[...(node?.type==='Image'?[node]:[]),...(Array.isArray(node?.props?.children)?node.props.children:[]).flatMap(images)]
const render=()=>hooks.get('ui.render')($,{requestId:'band',props:{bodyColumns:120,maxRows:10}},next)
const assertRenderReuse=async name=>{
 await render();const beforeEncodings=encodings
 for(let i=0;i<100;i++)await render()
 assert.equal(encodings,beforeEncodings,`${name}: unchanged host redraws must reuse composed images`)
}
const assertTypingQuiet=async name=>{
 const painted=blits.length,motionWrites=writes.filter(key=>key==='motion').length,count=requests.length
 for(let i=0;i<12;i++){
  await hooks.get('prompt.edit')($,{text:'fixture'},next);await tick()
  timers.find(t=>t.ms===10000&&!t.cancelled).fn();await flush()
 }
 assert.equal(blits.length,painted,`${name}: typing must not emit image updates`)
 assert.equal(writes.filter(key=>key==='motion').length,motionWrites,`${name}: typing must not redraw the prompt band`)
 assert.equal(requests.length,count,`${name}: typing must not spawn workers, including periodic sync`)
}
try{
 await hooks.get('session.start')($,{},next);await flush();await render()
 assert.equal(images(await render())[0].props.key,'loader')
 await assertRenderReuse('loader');await assertTypingQuiet('loader')
 releaseWorker();await flush();now+=300;await tick();await render()
 // Repeated thinking/text chunks must not bypass the scheduled frame budget.
 await hooks.get('turn.start')($,{turnId:'stream'},next);await flush();await render()
 renderOnWrite=true;const beforeStream=blits.length
 const stream=hooks.get('turn.step')($,{turnId:'stream',index:0},async function*(){
  for(let i=0;i<200;i++){
   now+=5;if(i%16===0)timers.find(t=>t.ms===80&&!t.cancelled).fn()
   yield{kind:i%2?'text':'thinking'}
  }
  return{stopReason:'tool_use'}
 })
 for await(const item of stream)await flush()
 const streamUpdates=blits.length-beforeStream+fullBandImages
 assert(streamUpdates<=15,`Stream hooks bypass the frame budget: ${streamUpdates} updates in one second`)
 renderOnWrite=false;await hooks.get('turn.complete')($,{turnId:'stream'},next);await flush();now+=300;await tick()
 // Early timer delivery and stream mode hints must not steal walk frames.
 await hooks.get('turn.start')($,{turnId:'jitter'},next);await flush();await tick();await render()
 const beforeJitter=blits.length,paintTimes=[]
 for(let i=0;i<30;i++){
  const before=blits.length;now+=1
  const tool=hooks.get('turn.step')($,{turnId:'jitter',index:i},async function*(){yield{kind:'thinking'};return{stopReason:'tool_use'}})
  for await(const item of tool)await flush()
  now+=78
  timers.find(t=>t.ms===80&&!t.cancelled).fn();await flush()
  if(blits.length>before)paintTimes.push(now)
 }
 const jitterGaps=paintTimes.slice(1).map((at,i)=>at-paintTimes[i])
 assert.equal(blits.length-beforeJitter,30,'Every delivered timer tick paints walking')
 assert(Math.max(...jitterGaps)<=100,'Early ticks must not freeze walking for a second interval')
 await hooks.get('turn.complete')($,{turnId:'jitter'},next);await flush()
 // Host redraws during streaming/interaction must reuse the held image.
 await hooks.get('command.run:guildbyte-walk')($);await render()
 await assertRenderReuse('walk')
 let baselineCalls=0,quietCalls=0
 for(const name of COMPANION_STATES){
  await hooks.get('command.run:guildbyte-'+name)($);await assertRenderReuse(name)
  const before=blits.length;for(let i=0;i<12;i++)await tick();baselineCalls+=blits.length-before
  await assertTypingQuiet(name)
  for(let i=0;i<140;i++)await tick()
  assert.equal(images(await render()).find(n=>n.props.key==='companion').props.alt,'Your Guildbyte character: idle',`${name}: resume after typing`)
 }
 // Held idle has no transport or whole-band redraws.
 await render();const beforeIdle=blits.length,beforeWrites=writes.length
 for(let i=0;i<20;i++)await tick()
 quietCalls=blits.length-beforeIdle
 assert.equal(quietCalls,0);assert.equal(writes.length,beforeWrites)
 // A slow image update drops missed ticks; it never queues a catch-up burst.
 await hooks.get('command.run:guildbyte-walk')($);await render()
 holdPaint=new Promise(resolve=>{releasePaint=resolve});const beforeSlow=blits.length
 for(let i=0;i<10;i++)await tick()
 assert.equal(blits.length-beforeSlow,1,'Only one paint may be in flight')
 releasePaint();holdPaint=undefined;await flush()
 assert.equal(blits.length-beforeSlow,1,'Completing a slow paint must not start a catch-up paint')
 await tick();assert.equal(blits.length-beforeSlow,2)
 // Feedback and visitors obey the same input budget as ordinary poses.
 holdPaint=undefined;now+=300
 response={...response,character:{...response.character,xp:25}}
 await hooks.get('command.run:guildbyte-sync')($);await flush()
 assert(images(await render()).some(n=>n.props.key==='xp-gain'))
 await assertRenderReuse('XP gain');await assertTypingQuiet('XP gain');now+=2000;await tick()
 response={...response,levelUp:{id:'effect',frames:Array(18).fill('png'),durations:Array(18).fill(80),durationMs:1440,renderScale:1.5},levelUpPixels:{width:192,height:192,frames:Array(18).fill(Buffer.alloc(192*192*4).toString('base64'))}}
 await hooks.get('command.run:guildbyte-levelup')($,{args:''});await flush()
 assert.equal(images(await render()).find(n=>n.props.key==='companion').props.alt,'Your Guildbyte character: levelup')
 await assertRenderReuse('level-up aura');await assertTypingQuiet('level-up aura');now+=2000;await tick()
 delete response.levelUp;delete response.levelUpPixels
 response={...response,visit:{id:'visit',name:'Ayla',expiresAt:new Date(now+10000).toISOString(),character:{png:'png',animation}},visitorPixels:pixels}
 await hooks.get('command.run:guildbyte-sync')($);await flush()
 assert(images(await render()).some(n=>n.props.key==='visitor'))
 await assertRenderReuse('visiting hero');await assertTypingQuiet('visiting hero')
 console.log(JSON.stringify({streamUpdatesPerSecond:streamUpdates,walkTicks:30,walkPaints:paintTimes.length,maxWalkFrameGapMs:Math.max(...jitterGaps),encodingsOnUnchangedRenders:0,overlays:4,states:COMPANION_STATES.length,animationBlits:baselineCalls,imageUpdatesWhileTyping:0,promptRedrawsWhileTyping:0,idleImageUpdates:quietCalls,maxPaintsInFlight:1,updatesPerSecond:12.5}))
 await hooks.get('session.end')($,{},next)
}finally{Date.now=originalNow;globalThis.btoa=originalBtoa}
