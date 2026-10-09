import assert from 'node:assert/strict'
import {register} from '../hooks/register.mjs'
const hooks=new Map(),values=new Map(),requests=[]
let response={connected:false,error:'Connection expired or disconnected. Run /guildbyte-connect to reauthenticate.'}
const next=async e=>e,flush=()=>new Promise(setImmediate)
const $={plugin:{root:'/plugin'},session:{id:async()=> 'session',usage:async()=>({})},command:{register:async()=>{}},env:{get:async key=>key==='TERM_PROGRAM'?'ghostty':undefined},state:{get:async key=>({value:values.get(key.key)}),set:async(key,value)=>{values.set(key.key,value)}},clock:{every:()=>({cancel(){}})},ui:{resolve:()=>Object.fromEntries(['Box','Image','Button','Text'].map(type=>[type,props=>({type,props})]))},process:{spawn:async function*({input}){requests.push(JSON.parse(input));yield{stream:'stdout',text:JSON.stringify(response)};return{code:0}}}}
register((event,matcher,hook)=>{if(typeof matcher==='function'){hook=matcher;matcher={}}hooks.set(event+(matcher.command?':'+matcher.command:''),hook)})
const collect=(node,type)=>[...(node?.type===type?[node]:[]),...(node?.props?.children??[]).flatMap(child=>collect(child,type))]
const buttons=node=>[...(node?.type==='Button'?[node]:[]),...(node?.props?.children??[]).flatMap(buttons)]
const render=()=>hooks.get('ui.render')($,{props:{bodyColumns:120,maxRows:4}},next)
await hooks.get('session.start')($,{},next);await flush()
let actions=buttons(await render())
assert.equal(actions.length,1)
assert.equal(actions[0].props.label,'Reconnect account','A revoked token needs pairing, not repeated uploads')
await actions[0].props.onPress();await flush()
assert.equal(requests.at(-1).action,'connect')
response={connected:true,error:'Guildbyte: Internal server error',pending:2}
await hooks.get('command.run:guildbyte-sync')($);await flush()
actions=buttons(await render())
assert.equal(actions[0].props.label,'Retry sync','An upload outage with a valid pairing still retries uploads')
response={connected:true,character:{id:'hero',png:'saved-hero',level:1,xp:0,nextLevelAt:100,canLevelUp:false}}
await hooks.get('command.run:guildbyte-sync')($);await flush()
const recovered=await render()
assert.equal(buttons(recovered).length,0,'A restored pairing removes the retry/reconnect action')
assert.equal(collect(recovered,'Image')[0].props.source.png,'saved-hero','The recovered heartbeat returns the hero to the band')
console.log('Reconnect checks passed: expired pairing offers Connect and calls pairing; a connected upload failure keeps Retry sync.')
