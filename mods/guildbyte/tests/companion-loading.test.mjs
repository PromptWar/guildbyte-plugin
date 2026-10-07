import assert from 'node:assert/strict'
import {register} from '../hooks/register.mjs'
const hooks=new Map(),values=new Map(),timers=[]
let release
const response=new Promise(resolve=>{release=resolve})
const $={plugin:{root:'/plugin'},session:{id:async()=> 'session',usage:async()=>({})},env:{get:async key=>key==='TERM_PROGRAM'?'ghostty':undefined},command:{register:async()=>{}},state:{get:async key=>({value:values.get(key.key)}),set:async(key,value)=>{values.set(key.key,value)}},clock:{every:(ms,fn)=>{const timer={ms,fn,cancelled:false,cancel(){this.cancelled=true}};timers.push(timer);return timer}},ui:{resolve:()=>Object.fromEntries(['Box','Image','Button','Text'].map(type=>[type,props=>({type,props})]))},process:{spawn:async function*(){await response;yield {stream:'stdout',text:JSON.stringify({connected:false})};return {code:0}}}}
register((event,matcher,hook)=>{if(typeof matcher==='function')hook=matcher;hooks.set(event+(matcher?.command?':'+matcher.command:''),hook)})
const next=async e=>e
let started=false
const starting=hooks.get('session.start')($,{},next).then(value=>{started=true;return value})
await new Promise(resolve=>setImmediate(resolve))
const tree=await hooks.get('ui.render')($,{requestId:'band',props:{bodyColumns:120,maxRows:4}},next)
const collect=(node,type)=>[...(node?.type===type?[node]:[]),...(node?.props?.children??[]).flatMap(child=>collect(child,type))]
try {
 assert(started,'Starting Claude must not wait for loading/network completion')
 assert.equal(collect(tree,'Button').length,0,'Connection must not be offered before loading resolves')
 const image=collect(tree,'Image')[0]
 assert.equal(image.props.alt,'Loading Guildbyte','Initial load shows a pixel loader, never retired hero artwork')
 assert(image.props.source.rgba,'Loader uses a small native pixel frame')
 assert(!JSON.stringify(tree).includes('cash-cow.png'),'Retired fallback is never rendered')
 const realNow=Date.now,at=Date.now();Date.now=()=>at+250
 try{timers.find(timer=>timer.ms===200).fn();await new Promise(resolve=>setImmediate(resolve))}
 finally{Date.now=realNow}
 const advanced=await hooks.get('ui.render')($,{props:{bodyColumns:120,maxRows:4}},next)
 assert.notDeepEqual(collect(advanced,'Image')[0].props.source,image.props.source,'Pixel loader advances while response is pending')
} finally {release();await starting;await new Promise(resolve=>setImmediate(resolve))}
const disconnected=await hooks.get('ui.render')($,{requestId:'band',props:{bodyColumns:120,maxRows:4}},next)
assert.equal(collect(disconnected,'Image').length,0,'Disconnected users see no placeholder hero or endless loader')
assert.equal(collect(disconnected,'Button')[0].props.label,'Connect account')
assert.deepEqual(timers.filter(timer=>!timer.cancelled).map(timer=>timer.ms),[10000],'Loader animation clock stops after loading')
console.log('Loading checks passed: pixel loader during pending sync, connect action after response, no retired hero fallback.')
