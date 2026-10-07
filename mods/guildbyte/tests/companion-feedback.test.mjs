import assert from 'node:assert/strict'
import {register} from '../hooks/register.mjs'
import {levelUpCanvas,xpCanvas} from '../scripts/companion-pixels.mjs'
import {companionActivity} from '../scripts/companion-animation.mjs'
const next=async e=>e,flush=()=>new Promise(resolve=>setImmediate(resolve)),originalNow=Date.now
let now=0;Date.now=()=>now
const hooks=new Map(),values=new Map(),timers=[],requests=[],blits=[]
const dot=Buffer.alloc(128*128*4);dot.set([255,0,0,255],(64*128+64)*4)
const mirror=Buffer.alloc(128*128*4);mirror.set([255,0,0,255],(64*128+63)*4)
const rgba=dot.toString('base64'),pixels={width:128,height:128,frames:Array(28).fill(rgba),mirroredFrames:Object.fromEntries(Array.from({length:28},(_,i)=>[i,mirror.toString('base64')]))}
const aura=Buffer.alloc(192*192*4);aura.set([255,0,0,255],(116*192+96)*4)
const levelUpPixels={width:192,height:192,frames:Array(18).fill(aura.toString('base64'))}
const clips=Object.fromEntries(['idle','walk','sit','talk','kiss','wave','laugh','angry','victory','sleep'].map(state=>[state,{frames:[0,1],durations:[100,100]}]))
const animation={frames:Array(28).fill('png'),mirroredFrames:Object.fromEntries(Array.from({length:28},(_,i)=>[i,'left-png'])),clips}
let character={id:'hero',heroId:'cash_cow_solopreneur',level:1,xp:20,nextLevelAt:100,canLevelUp:false},effect
const $={plugin:{root:'/plugin'},session:{id:async()=> 'session',usage:async()=>({})},command:{register:async()=>{}},env:{get:async key=>key==='TERM_PROGRAM'?'ghostty':undefined},state:{get:async key=>({value:values.get(key.key)}),set:async(key,value)=>{values.set(key.key,value)}},clock:{every:(ms,fn)=>{const timer={ms,fn,cancel(){this.cancelled=true}};timers.push(timer);return timer}},ui:{resolve:()=>Object.fromEntries(['Box','Image','Button','Text'].map(type=>[type,props=>({type,props})])),blit:async args=>{blits.push(args);return {}}},process:{spawn:async function*({input}){
 const request=JSON.parse(input);requests.push(request)
 if(request.action==='evolve'){
  assert.equal(request.characterId,character.id);assert.equal(request.level,character.level)
  effect={version:1,id:'evolution',heroId:character.heroId,fromLevel:character.level,toLevel:character.level+1,frames:Array(18).fill('gold-png'),durations:Array(18).fill(100),durationMs:1800,renderScale:1.5}
  character={...character,level:2,nextLevelAt:400,canLevelUp:false}
 }
 yield {stream:'stdout',text:JSON.stringify({connected:true,character:{...character,png:'png',animation},pixels,...(effect?{levelUp:effect,levelUpPixels}:{})})};effect=undefined;return {code:0}
}}}
register((event,matcher,hook)=>{if(typeof matcher==='function'){hook=matcher;matcher={}}hooks.set(event+(matcher.command?':'+matcher.command:''),hook)})
const collect=(node,type)=>[...(node?.type===type?[node]:[]),...(Array.isArray(node?.props?.children)?node.props.children:[]).flatMap(child=>collect(child,type))]
const render=()=>hooks.get('ui.render')($,{requestId:'band',props:{bodyColumns:120,maxRows:10}},next)
const tick=async ms=>{now+=ms;timers.find(t=>t.ms===50&&!t.cancelled).fn();await flush()}
const centroid=source=>{const data=Buffer.from(source.rgba,'base64');let mass=0,x=0,y=0;for(let i=0;i<data.length;i+=4){const a=data[i+3];mass+=a;x+=(i/4%source.width)*a;y+=Math.floor(i/4/source.width)*a}return {x:x/mass,y:y/mass}}
try{
 await hooks.get('session.start')($,{},next);await flush()
 assert.equal(values.get('motion').xp,undefined,'Initial XP establishes a baseline without replaying past gains')
 assert.equal(collect(await render(),'Button').length,0,'No action frame when nothing can be done')
 await hooks.get('turn.start')($,{turnId:'thinking'},next)
 for(let i=0;i<20;i++)await tick(50)
 await render()
 character={...character,xp:100,canLevelUp:true}
 await hooks.get('command.run:guildbyte-sync')($);await flush()
 const gained=await render(),button=collect(gained,'Button').find(node=>node.props.label==='Level up')
 assert(button,'Full XP exposes the manual evolution action')
 assert(collect(gained,'Box').some(node=>node.props.key==='actions'&&node.props.borderColor==='#d7ad64'),'Actions share the app gold frame')
 assert.equal(values.get('motion').xp.amount,80)
 const popup=collect(gained,'Image').find(node=>node.props.key==='xp-gain');assert(popup)
 const initialY=centroid(popup.props.source).y
 await tick(100);assert(centroid(blits.findLast(b=>b.key==='xp-gain').source).y<initialY,'XP rises in pixels rather than jumping terminal rows')
 $.ui.blit=async()=>({deny:'capture current state'});await tick(50)
 $.ui.blit=async args=>{blits.push(args);return {}}
 const position=values.get('motion').offset
 button.props.onPress();await flush()
 assert.equal(requests.at(-1).action,'evolve')
 assert.equal(values.get('motion').state,'levelup');assert.equal(values.get('motion').offset,position,'Manual aura begins at the current patrol position')
 const evolved=await render();assert.equal(collect(evolved,'Button').length,0,'Consumed action hides its frame immediately')
 const auraImage=collect(evolved,'Image').find(node=>node.props.key==='companion'),auraPoint=centroid(auraImage.props.source)
 const normal=centroid((await import('../scripts/companion-pixels.mjs')).pixelCanvas(pixels,0,'left',8,12,position))
 assert.equal(auraPoint.x-auraImage.props.source.width,normal.x-320,'Hero x anchor matches across differently sized effect canvases')
 assert.equal(auraPoint.y-auraImage.props.source.height,normal.y-128,'Hero floor matches across differently sized effect canvases')
 for(let i=0;i<15;i++)await tick(100)
 assert.equal(values.get('motion').offset,position,'Aura holds the current position through thinking')
 await tick(400);assert(Math.abs(values.get('motion').offset-position)<=.4,'Walking resumes without catching up or returning home')
 assert.equal(values.get('motion').xp,undefined,'XP animation ends without an extra clock')
 await hooks.get('command.run:guildbyte-sync')($);await flush();assert.equal(values.get('motion').xp,undefined,'Unchanged sync never repeats gain animation')
 character={...character,id:'other',xp:500,level:3,nextLevelAt:900};await hooks.get('command.run:guildbyte-sync')($);await flush();assert.equal(values.get('motion').xp,undefined,'Switching heroes never reports their historical XP as a gain')
 const paused=companionActivity(0);paused.start('a',0);paused.snapshot(250);const held=paused.snapshot(500)
 assert.equal(paused.snapshot(10000,12,true,true).offset,held.offset)
 assert(paused.snapshot(10050).offset-held.offset<=.081)
 await hooks.get('session.end')($,{},next);assert(timers.every(t=>t.cancelled))
 console.log('Feedback passed: purple rising XP, no replay, conditional gold action frame, manual evolution, identical aura x/floor anchors and no patrol jump.')
}finally{Date.now=originalNow}
