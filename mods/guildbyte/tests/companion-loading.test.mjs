import assert from 'node:assert/strict'
import {register} from '../hooks/register.mjs'
import {LOADER_FRAMES,LOADER_INTERVAL} from '../scripts/companion-loader.mjs'
const filled=LOADER_FRAMES.map(frame=>{const bytes=Buffer.from(frame.image.rgba,'base64');let n=0;for(let i=0;i<bytes.length;i+=4)if(bytes[i]>100&&bytes[i+3])n++;return n/16})
assert.deepEqual(filled,[1,2,3,4,5,6,7,8],'Loading must visibly fill every square, then repeat quickly')
assert.equal(LOADER_INTERVAL*LOADER_FRAMES.length,640)
const hooks=new Map(),values=new Map(),timers=[],blits=[],requests=[]
let release
const response=new Promise(resolve=>{release=resolve})
const $={plugin:{root:'/plugin'},session:{id:async()=> 'session',usage:async()=>({})},env:{get:async key=>key==='TERM_PROGRAM'?'ghostty':undefined},command:{register:async()=>{}},state:{get:async key=>({value:values.get(key.key)}),set:async(key,value)=>{values.set(key.key,value)}},clock:{every:(ms,fn)=>{const timer={ms,fn,cancelled:false,cancel(){this.cancelled=true}};timers.push(timer);return timer}},ui:{blit:async args=>{blits.push(args);return {}},resolve:()=>Object.fromEntries(['Box','Image','Button','Text'].map(type=>[type,props=>({type,props})]))},process:{spawn:async function*(args){requests.push(JSON.parse(args.input));await response;yield {stream:'stdout',text:JSON.stringify({connected:false})};return {code:0}}}}
register((event,matcher,hook)=>{if(typeof matcher==='function')hook=matcher;hooks.set(event+(matcher?.command?':'+matcher.command:''),hook)})
const next=async e=>e
let started=false
const starting=hooks.get('session.start')($,{},next).then(value=>{started=true;return value})
await new Promise(resolve=>setImmediate(resolve))
const tree=await hooks.get('ui.render')($,{requestId:'band',props:{bodyColumns:120,maxRows:4}},next)
const collect=(node,type)=>[...(node?.type===type?[node]:[]),...(node?.props?.children??[]).flatMap(child=>collect(child,type))]
try {
 assert.equal(requests[0].action,'status','Initial hero fetch must bypass usage/history sync')
 assert(started,'Starting Claude must not wait for loading/network completion')
 assert.equal(collect(tree,'Button').length,0,'Connection must not be offered before loading resolves')
 const image=collect(tree,'Image')[0]
 assert.equal(image.props.alt,'Loading Guildbyte','Initial load shows a pixel loader, never retired hero artwork')
 assert(image.props.source.rgba,'Loader uses a small native pixel frame')
 assert(!JSON.stringify(tree).includes('cash-cow.png'),'Retired fallback is never rendered')
 const realNow=Date.now,at=Date.now();Date.now=()=>at+250
 try{timers.find(timer=>timer.ms===LOADER_INTERVAL).fn();await new Promise(resolve=>setImmediate(resolve))}
 finally{Date.now=realNow}
 assert.equal(blits.at(-1).key,'loader','Loader repaints only its keyed image')
 assert.notDeepEqual(blits.at(-1).source,image.props.source)
 $.ui.blit=async()=>({deny:'fallback'})
 const realFallbackNow=Date.now;Date.now=()=>at+400
 try{timers.find(timer=>timer.ms===LOADER_INTERVAL).fn();await new Promise(resolve=>setImmediate(resolve))}
 finally{Date.now=realFallbackNow}
 assert.notEqual(values.get('motion').frame,0,'Denied blits fall back to normal UI rendering')
 const advanced=await hooks.get('ui.render')($,{props:{bodyColumns:120,maxRows:4}},next)
 assert.notDeepEqual(collect(advanced,'Image')[0].props.source,image.props.source,'Pixel loader advances while response is pending')
} finally {release();await starting;await new Promise(resolve=>setImmediate(resolve))}
const disconnected=await hooks.get('ui.render')($,{requestId:'band',props:{bodyColumns:120,maxRows:4}},next)
assert.equal(collect(disconnected,'Image').length,0,'Disconnected users see no placeholder hero or endless loader')
assert.equal(collect(disconnected,'Button')[0].props.label,'Connect account')
assert.deepEqual(timers.filter(timer=>!timer.cancelled).map(timer=>timer.ms),[10000],'Loader animation clock stops after loading')
timers.find(timer=>timer.ms===10000).fn();await new Promise(resolve=>setImmediate(resolve))
assert.equal(requests.at(-1).action,'sync','Normal background activity capture still runs after bootstrap')
console.log('Loading checks passed: pixel loader during pending sync, connect action after response, no retired hero fallback.')
