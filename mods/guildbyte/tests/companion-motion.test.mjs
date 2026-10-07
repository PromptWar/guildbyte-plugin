import assert from 'node:assert/strict'
import { companionActivity } from '../scripts/companion-animation.mjs'
import { register } from '../hooks/register.mjs'

// Carrying walk: one 1200ms stride travels about two terminal columns.
const pace=companionActivity(0)
pace.start('pace',0)
for(let at=100;at<=1000;at+=100)pace.snapshot(at,12)
assert(Math.abs(pace.snapshot(1000,12).offset-1.6)<1e-8,'Patrol retains sub-column motion at the authored pace')
let previous=pace.snapshot(1000,12).offset
for(let at=1050;at<=2000;at+=50){const current=pace.snapshot(at,12).offset;assert(Math.abs(current-previous)<=.081,'A 50ms tick must not teleport a whole column');previous=current}

const motion=companionActivity(0)
assert.equal(motion.snapshot(19999).state,'idle')
assert.equal(motion.snapshot(20000).state,'sit')
assert.equal(motion.snapshot(90000).state,'sleep')
motion.activity(90001)
assert.equal(motion.snapshot(90001).state,'idle','Typing wakes immediately')
motion.start('main',90001)
let left=false,right=false
for(let at=90121;at<100000;at+=120) {
  const pose=motion.snapshot(at,5)
  assert(pose.offset>=0 && pose.offset<=5)
  left ||= pose.facing==='left';right ||= pose.facing==='right'
}
assert(left && right,'Thinking paces in both directions')
assert.equal(motion.snapshot(200000).state,'walk','A long active turn must not fall asleep')
motion.finish('old-turn',200000)
assert.equal(motion.snapshot(200120).state,'walk','Stale completion cannot stop the main turn')
motion.finish('main',200120)
let home
for(let at=200240;at<204000;at+=120)home=motion.snapshot(at,5)
assert.equal(home.offset,0);assert.equal(home.state,'idle');assert.equal(home.facing,'right')
assert.equal(motion.snapshot(220120).state,'sit')
assert.equal(motion.snapshot(290120).state,'sleep')
motion.preview('wave',290121)
assert.equal(motion.snapshot(390000).state,'wave')
motion.activity(390001)
assert.equal(motion.snapshot(390001).state,'idle')
motion.start('fallback',390001)
assert.equal(motion.snapshot(390121,12,false).offset,0,'Old servers animate in place')
assert.equal(motion.snapshot(390241,0,true).offset,0,'Narrow viewports cannot clip the character')

// Exercise the actual registered hooks and their downstream stream, without
// requiring a Claude login or transmitting any activity to a real server.
const originalNow=Date.now
let now=0
Date.now=()=>now
try {
  const hooks=new Map(),values=new Map(),timers=[],requests=[]
  const clips=Object.fromEntries(['idle','walk','sit','talk','kiss','wave','laugh','angry','victory','sleep'].map((s,i)=>[s,{frames:s==='walk' ? [2,3] : [i],durations:s==='walk' ? [100,100] : [100]}]))
  clips.sleep={frames:[8,19,19],durations:[300,1500,1600]}
  clips.kiss={frames:[0,13,14,0],durations:[100,100,100,100]}
  const animation={version:1,frames:Array.from({length:20},(_,i)=>`frame-${i}`),mirroredFrames:{0:'left-0',2:'left-2',3:'left-3',4:'left-4'},clips}
  const dot=Buffer.alloc(128*128*4);dot.set([255,0,0,255],(64*128+64)*4)
  const pixels={width:128,height:128,frames:Array(20).fill(dot.toString('base64')),mirroredFrames:{0:dot.toString('base64'),2:dot.toString('base64'),3:dot.toString('base64')}}
  let incoming=null
  const $={
    plugin:{root:'/plugin'},session:{id:async()=> 'session',usage:async()=>({})},
    // A terminal that shows images, so the sprite path is the one under test (others get a status line).
    env:{get:async name=>({TERM_PROGRAM:'ghostty'})[name]},
    state:{get:async key=>({value:values.get(key.key)}),set:async (key,value)=>{values.set(key.key,value)}},
    command:{register:async()=>{}},
    process:{run:async (_args,{stdin})=>{const input=JSON.parse(stdin);requests.push(input);if(input.completedVisits?.includes(incoming?.id))incoming=null;return {exitCode:0,stdout:JSON.stringify({connected:true,pixels,visitorPixels:incoming ? pixels : null,character:{id:'char',png:'idle-png',animation},visit:incoming,...(input.action==='levelup' ? {levelUp:{id:'effect-'+requests.length,fromLevel:1,toLevel:input.toLevel??2,version:1,renderScale:1.5,frames:Array.from({length:18},(_,i)=>'gold-'+i),durations:[80,...Array(16).fill(90),120],durationMs:1640}} : {}),...(input.action==='kiss' ? {kiss:{target:input.target.replace(/^@/,'')}} : {})})}}},
    clock:{every:(ms,fn)=>{const timer={ms,fn,cancelled:false,cancel(){this.cancelled=true}};timers.push(timer);return timer}},
    ui:{resolve:()=>Object.fromEntries(['Box','Image','Button','Text'].map(type=>[type,props=>({type,props})]))},
  }
  $.process.spawn=async function*({argv,input}){const result=await $.process.run(argv,{stdin:input});yield {stream:'stdout',text:result.stdout};return {code:result.exitCode}}
  register((event,matcher,hook)=>{if(typeof matcher==='function'){hook=matcher;matcher={}}hooks.set(event+(matcher.command ? ':'+matcher.command : ''),hook)})
  const next=async e=>e
  await hooks.get('session.start')($,{},next)
  await new Promise(resolve=>setImmediate(resolve))
  const tick=async at=>{now=at;timers.find(t=>t.ms===80).fn();await new Promise(resolve=>setImmediate(resolve))}
  await tick(90000)
  assert.equal(values.get('motion').state,'sleep')
  const beforeRequests=requests.length
  const edit={text:'private keyboard contents',inputText:'private keyboard contents'}
  assert.equal(await hooks.get('prompt.edit')($,edit,next),edit)
  const held=values.get('motion')
  await tick(90100)
  assert.equal(values.get('motion'),held,'Typing does not redraw the prompt band')
  await tick(90250)
  assert.equal(values.get('motion').state,'idle')
  assert.equal(requests.length,beforeRequests,'Keystrokes do not start uploads')
  await hooks.get('turn.start')($,{turnId:'t1'},next)
  const thinking={kind:'thinking',index:0,text:'private thinking'},text={kind:'text',index:1,text:'visible answer'},engine={kind:'engine',ref:7}
  const result={stopReason:'end_turn',answer:'visible answer',toolUses:[]}
  let downstreamClosed=false
  const stream=hooks.get('turn.step')($,{turnId:'t1',index:0},async function*(){try{yield thinking;yield text;yield engine;return result}finally{downstreamClosed=true}})
  assert.equal((await stream.next()).value,thinking)
  for(let at=90370;at<=91330;at+=120)await tick(at)
  assert(values.get('motion').offset>0)
  assert.equal(values.get('motion').facing,'left')
  const tree=await hooks.get('ui.render')($,{props:{bodyColumns:120,maxRows:3}},next)
  assert.equal(tree.props.children[0].props.position,'absolute')
  assert.equal(tree.props.children[0].props.right,1,'The image placement stays fixed while its pixels move')
  assert(tree.props.children[0].props.children[0].props.source.rgba,'The terminal gets a native pixel canvas')
  const larger=await hooks.get('ui.render')($,{props:{bodyColumns:120,maxRows:10}},next)
  assert.equal(larger.props.height,6)
  assert.equal(larger.props.children[0].props.children[0].props.rows,6)
  assert.equal(larger.props.children[0].props.children[0].props.columns,27)
  const narrow=await hooks.get('ui.render')($,{props:{bodyColumns:4,maxRows:2}},next)
  assert.equal(narrow.props.children[0].props.children[0].props.columns,2)
  assert.equal(narrow.props.children[0].props.children[0].props.rows,2)
  assert.equal(narrow.props.children[0].props.right,0)
  await hooks.get('ui.render')($,{props:{bodyColumns:120,maxRows:4}},next)
  assert.equal((await stream.next()).value,text)
  for(let at=91200;at<=93000;at+=120)await tick(at)
  assert.equal(values.get('motion').state,'talk')
  assert.equal(values.get('motion').offset,0,'Talking returns to the home position')
  assert.equal((await stream.next()).value,engine)
  assert.deepEqual(await stream.next(),{done:true,value:result})
  assert(downstreamClosed)
  assert.equal(values.get('motion').state,'idle','Final steps finish even without turn.complete')
  await tick(113000);assert.equal(values.get('motion').state,'sit')
  await tick(183000);assert.equal(values.get('motion').state,'sleep')
  await tick(186400);assert.equal(values.get('motion').frame,19,'Sleep holds the sleeping pose past the full clip')
  await tick(190000);assert.equal(values.get('motion').frame,19,'Sleep does not return to the sitting frame')
  const subagent=hooks.get('turn.step')($,{turnId:'agent',agentId:'agent',index:0},async function*(){yield thinking;return result})
  await subagent.next();assert.equal(values.get('motion').state,'sleep','Background agents do not wake the companion')
  await subagent.next()
  const tools=hooks.get('turn.step')($,{turnId:'tools',index:0},async function*(){yield {kind:'tool',name:'Read',id:'tool'};return {stopReason:'tool_use'}})
  await tools.next();await tools.next()
  await tick(283000);assert.equal(values.get('motion').state,'walk','Tool execution remains active')
  const cancelled=hooks.get('turn.step')($,{turnId:'cancelled',index:0},async function*(){try{yield thinking}finally{downstreamClosed=true}})
  downstreamClosed=false;await cancelled.next();await cancelled.return()
  assert(downstreamClosed,'Cancellation closes the downstream stream')
  for(let at=283120;at<=287000;at+=120)await tick(at)
  assert.equal(values.get('motion').offset,0);assert.equal(values.get('motion').state,'idle')
  const command=await hooks.get('command.run:kiss')($,{args:'@bob'})
  assert.match(command.text,/queued for @bob/)
  assert.equal(requests.at(-1).target,'@bob')
  const requestCount=requests.length
  assert.match((await hooks.get('command.run:kiss')($,{args:'two names'})).text,/Use \/kiss/)
  assert.equal(requests.length,requestCount)
  incoming={id:'visitor-id',name:'Ayla',guild:'Pixel Forge',expiresAt:new Date(now+120000).toISOString(),character:{id:'guest',png:'guest-png',animation}}
  await hooks.get('command.run:guildbyte-sync')($)
  await tick(287120)
  const visiting=await hooks.get('ui.render')($,{props:{bodyColumns:120,maxRows:10}},next)
  assert.equal(visiting.props.height,7)
  assert.equal(visiting.props.children.length,3,'Resident, visitor, and name/guild label render together')
  assert.equal(visiting.props.children[1].props.left,0,'Visitor stays in the left section')
  assert.equal(visiting.props.children[1].props.width,40,'Visitor patrol never enters the actions or player section')
  assert.equal(visiting.props.children[2].props.children[0].props.children,'Ayla · <Pixel Forge>')
  await tick(288620)
  assert.equal(values.get('motion').visit.state,'kiss')
  assert.equal(values.get('motion').state,'kiss')
  assert.equal(values.get('motion').facing,'left')
  assert.equal(values.get('motion').visit.facing,'right')
  assert.equal(values.get('motion').frame,13)
  assert.equal(values.get('motion').visit.frame,13,'Both kisses start together after arrival')
  for(const at of [289000,290000,292000]) {
    await tick(at)
    assert.equal(values.get('motion').frame,0,'Resident kiss ends at neutral without replay')
    assert.equal(values.get('motion').visit.frame,0,'Visitor kiss ends at neutral without replay')
  }
  await tick(293620)
  assert.equal(values.get('motion').visit.state,'walk');assert.equal(values.get('motion').visit.facing,'left')
  await tick(295121)
  assert.equal(values.get('motion').visit,undefined)
  await hooks.get('command.run:guildbyte-sync')($)
  assert.deepEqual(requests.at(-1).completedVisits,['visitor-id'],'A completed visit is acknowledged once')
  await tick(295241)
  assert.equal(values.get('motion').visit,undefined,'Heartbeat refresh must not restart a completed visit')
  assert.equal(await hooks.get('ui.render')($,{props:{hasSurvey:true}},next).then(e=>e.props.hasSurvey),true)
  const blits=[]
  $.ui.blit=async args=>{blits.push(args);return {}}
  await hooks.get('command.run:guildbyte-walk')($)
  await hooks.get('ui.render')($,{requestId:'band',props:{bodyColumns:120,maxRows:4}},next)
  const beforePaint=values.get('motion')
  await tick(295361)
  assert.equal(blits.at(-1)?.key,'companion','Frames replace the mounted keyed image in place')
  assert.equal(values.get('motion'),beforePaint,'Frame-only updates must not redraw the whole band')
  const latest=await hooks.get('ui.render')($,{requestId:'band',props:{bodyColumns:120,maxRows:4}},next)
  assert.deepEqual(latest.props.children[0].props.children[0].props.source,blits.at(-1).source,'Other redraws retain the latest painted frame')
  const canvas=latest.props.children[0]
  const columnPixels=128/((canvas.props.children[0].props.columns-12)/1.5)
  const centroid=source=>{const data=Buffer.from(source.rgba,'base64');let total=0,x=0;for(let i=0;i<data.length;i+=4){const a=data[i+3];total+=a;x+=(i/4%source.width)*a}return x/total}
  let lastX=centroid(blits.at(-1).source)
  for(let i=0;i<40;i++) {
    await tick(now+80)
    const image=blits.at(-1).source,x=centroid(image)
    assert(Math.abs(x-lastX)<=Math.ceil(.129*columnPixels),'Painted pixels advance by the authored sub-column tick with nearest-pixel rounding')
    lastX=x
    assert.equal(values.get('motion'),beforePaint,'Moving never remounts or repositions the image')
    assert.equal(image.width,canvas.props.children[0].props.source.width,'Canvas dimensions stay fixed across column boundaries')
  }
  const repainted=await hooks.get('ui.render')($,{requestId:'band',props:{bodyColumns:120,maxRows:4}},next)
  assert.equal(repainted.props.children[0].props.right,canvas.props.right,'No whole-cell placement jump during a redraw')
  assert(columnPixels>2)
  const queued=[];let release
  $.ui.blit=async args=>{queued.push(args);if(queued.length===1)await new Promise(resolve=>{release=resolve});return {}}
  await tick(now+80);await tick(now+80)
  assert.equal(queued.length,1,'A slow native blit cannot overlap a newer frame and paint them out of order')
  release();await new Promise(resolve=>setImmediate(resolve))
  assert.equal(queued.length,1,'After a slow paint, drop missed ticks without a catch-up redraw')
  await tick(now+80)
  assert.equal(queued.length,2,'The next scheduled tick paints the latest position')
  // A continuously busy terminal must not hold prompt hooks until every queued frame drains.
  const slow=[];let promptFinished=false
  $.ui.blit=async()=>new Promise(resolve=>{slow.push(()=>resolve({}))})
  await tick(now+80)
  const editDuringPaint=hooks.get('prompt.edit')($,{},next).then(()=>{promptFinished=true})
  await tick(now+80)
  const finishedWithoutPaint=promptFinished
  slow[0]();await new Promise(resolve=>setImmediate(resolve))
  assert.equal(slow.length,1,'Typing drops pending animation ticks without another prompt redraw')
  const finishedAfterOnePaint=promptFinished
  await editDuringPaint
  assert(finishedAfterOnePaint,'Prompt hooks wait for at most one paint, not a perpetually replenished animation queue')
  assert(finishedWithoutPaint,'Typing must return immediately even if terminal drawing is stalled')
  $.ui.blit=async args=>{blits.push(args);return {}}
  const oldUsage=$.session.usage;let releaseUsage,submitted=false
  $.session.usage=()=>new Promise(resolve=>{releaseUsage=resolve})
  const submission=hooks.get('prompt.submit')($,{text:'private keyboard contents'},next).then(()=>{submitted=true})
  await new Promise(resolve=>setImmediate(resolve))
  const submittedBeforeSync=submitted
  releaseUsage({});$.session.usage=oldUsage
  await submission;await new Promise(resolve=>setImmediate(resolve))
  assert(submittedBeforeSync,'Prompt submission must not wait for background syncing or network requests')
  $.ui.blit=async()=>({deny:'Image unavailable'})
  await tick(now+300)
  await tick(now+80)
  assert.notEqual(values.get('motion'),beforePaint,'A denied blit falls back to ordinary rendering')
  await hooks.get('command.run:guildbyte-idle')($,{})
  for(let i=0;i<60;i++)await tick(now+250)
  // Repeating a finished one-shot must restart at frame zero via the real command hook.
  await hooks.get('command.run:guildbyte-kiss')($,{})
  assert.equal(values.get('motion').frame,0)
  const kissStarted=now
  await tick(kissStarted+100);assert.equal(values.get('motion').frame,13)
  await tick(kissStarted+500);assert.equal(values.get('motion').frame,0)
  await hooks.get('command.run:guildbyte-kiss')($,{})
  await tick(kissStarted+600)
  assert.equal(values.get('motion').frame,13,'Rerunning /guildbyte-kiss must replay from the beginning')
  await hooks.get('ui.render')($,{props:{bodyColumns:120,maxRows:10}},next)
  const levelCommand=await hooks.get('command.run:guildbyte-levelup')($,{args:'5'})
  assert.match(levelCommand.text,/1 → 5/);assert.equal(values.get('motion').state,'levelup');assert.equal(values.get('motion').frame,0)
  assert.equal(values.get('status').levelUp.frames,undefined,'The level-up artwork stays in memory, outside persisted UI state')
  const auraStarted=now
  await tick(auraStarted+80);assert.equal(values.get('motion').frame,1)
  const auraTree=await hooks.get('ui.render')($,{props:{bodyColumns:120,maxRows:4}},next)
  assert.equal(auraTree.props.children[0].props.children[0].props.source.png,'gold-1','Aura frame is actually painted by the mounted image')
  const bigAura=await hooks.get('ui.render')($,{props:{bodyColumns:120,maxRows:10}},next)
  assert.equal(bigAura.props.children[0].props.children[0].props.rows,8,'Aura needs room around the unchanged hero')
  assert.equal(bigAura.props.children[0].props.children[0].props.columns,15)
  await tick(auraStarted+1641);assert.notEqual(values.get('motion').state,'levelup','The shared aura clears after one run')
  await hooks.get('command.run:guildbyte-levelup')($,{args:'5'});assert.equal(values.get('motion').frame,0,'Rerun restarts gold aura')
  await tick(now+80);assert.equal(values.get('motion').frame,1)
  const beforeInvalid=requests.length
  assert.match((await hooks.get('command.run:guildbyte-levelup')($,{args:'6'})).text,/\[1-5\]/);assert.equal(requests.length,beforeInvalid)
  await hooks.get('session.end')($,{},next)
  assert(timers.every(t=>t.cancelled),'Ending the session cancels both timers')
  assert(!JSON.stringify(requests).includes('private'),'Typing and thinking contents never enter the sync worker')
  // Text-only terminals need presence syncing, not a 20Hz animation timer.
  const textHooks=new Map(),textTimers=[]
  const textRegister=(await import('../hooks/register.mjs?text-only')).register
  textRegister((event,matcher,hook)=>textHooks.set(event,typeof matcher==='function' ? matcher : hook))
  const textApi={...$,env:{get:async()=>undefined},clock:{every:(ms)=>{const timer={ms,cancelled:false,cancel(){this.cancelled=true}};textTimers.push(timer);return timer}}}
  await textHooks.get('session.start')(textApi,{},next)
  await new Promise(resolve=>setImmediate(resolve))
  assert.deepEqual(textTimers.filter(timer=>!timer.cancelled).map(timer=>timer.ms),[10000],'Text-only terminals stop the transient loader clock and never poll hero frames')
  assert.equal(requests.at(-1).includeArt,false,'Text-only terminals do not request sprite assets')
} finally {Date.now=originalNow}
console.log('Companion checks passed: larger sprite, wake/sit/sleep, patrol/home return, streams/cancellation, visitor arrival/kiss/departure, name/guild, acknowledgement and timer cleanup.')
