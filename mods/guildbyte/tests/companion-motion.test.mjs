import assert from 'node:assert/strict'
import { companionActivity } from '../scripts/companion-animation.mjs'
import { register } from '../hooks/register.mjs'

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
  let incoming=null
  const $={
    plugin:{root:'/plugin'},session:{id:async()=> 'session',usage:async()=>({})},
    state:{get:async key=>({value:values.get(key.key)}),set:async (key,value)=>{values.set(key.key,value)}},
    command:{register:async()=>{}},
    process:{run:async (_args,{stdin})=>{const input=JSON.parse(stdin);requests.push(input);if(input.completedVisits?.includes(incoming?.id))incoming=null;return {exitCode:0,stdout:JSON.stringify({connected:true,character:{id:'char',png:'idle-png',animation},visit:incoming,...(input.action==='kiss' ? {kiss:{target:input.target.replace(/^@/,'')}} : {})})}}},
    clock:{every:(ms,fn)=>{const timer={ms,fn,cancelled:false,cancel(){this.cancelled=true}};timers.push(timer);return timer}},
    ui:{resolve:()=>Object.fromEntries(['Box','Image','Button','Text'].map(type=>[type,props=>({type,props})]))},
  }
  register((event,matcher,hook)=>{if(typeof matcher==='function'){hook=matcher;matcher={}}hooks.set(event+(matcher.command ? ':'+matcher.command : ''),hook)})
  const next=async e=>e
  await hooks.get('session.start')($,{},next)
  const tick=async at=>{now=at;timers.find(t=>t.ms===50).fn();await Promise.resolve()}
  await tick(90000)
  assert.equal(values.get('motion').state,'sleep')
  const beforeRequests=requests.length
  const edit={text:'private keyboard contents',inputText:'private keyboard contents'}
  assert.equal(await hooks.get('prompt.edit')($,edit,next),edit)
  assert.equal(values.get('motion').state,'idle')
  assert.equal(requests.length,beforeRequests,'Keystrokes do not start uploads')
  await hooks.get('turn.start')($,{turnId:'t1'},next)
  const thinking={kind:'thinking',index:0,text:'private thinking'},text={kind:'text',index:1,text:'visible answer'},engine={kind:'engine',ref:7}
  const result={stopReason:'end_turn',answer:'visible answer',toolUses:[]}
  let downstreamClosed=false
  const stream=hooks.get('turn.step')($,{turnId:'t1',index:0},async function*(){try{yield thinking;yield text;yield engine;return result}finally{downstreamClosed=true}})
  assert.equal((await stream.next()).value,thinking)
  for(let at=90120;at<=91080;at+=120)await tick(at)
  assert(values.get('motion').offset>0)
  assert.equal(values.get('motion').facing,'left')
  const tree=await hooks.get('ui.render')($,{props:{bodyColumns:120,maxRows:3}},next)
  assert.equal(tree.props.children[0].props.position,'absolute')
  assert(tree.props.children[0].props.right>1)
  assert.match(tree.props.children[0].props.children[0].props.source.png,/^left-/)
  const larger=await hooks.get('ui.render')($,{props:{bodyColumns:120,maxRows:10}},next)
  assert.equal(larger.props.height,4)
  assert.equal(larger.props.children[0].props.children[0].props.rows,4)
  assert.equal(larger.props.children[0].props.children[0].props.columns,8)
  const narrow=await hooks.get('ui.render')($,{props:{bodyColumns:4,maxRows:2}},next)
  assert.equal(narrow.props.children[0].props.children[0].props.columns,4)
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
  assert.equal(visiting.props.height,5)
  assert.equal(visiting.props.children.length,3,'Resident, visitor, and name/guild label render together')
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
  assert.equal(latest.props.children[0].props.children[0].props.source.png,blits.at(-1).source.png,'Other redraws retain the latest painted frame')
  $.ui.blit=async()=>({deny:'Image unavailable'})
  await tick(295401)
  await tick(295461)
  assert.notEqual(values.get('motion'),beforePaint,'A denied blit falls back to ordinary rendering')
  await hooks.get('session.end')($,{},next)
  assert(timers.every(t=>t.cancelled),'Ending the session cancels both timers')
  assert(!JSON.stringify(requests).includes('private'),'Typing and thinking contents never enter the sync worker')
} finally {Date.now=originalNow}
console.log('Companion checks passed: larger sprite, wake/sit/sleep, patrol/home return, streams/cancellation, visitor arrival/kiss/departure, name/guild, acknowledgement and timer cleanup.')
