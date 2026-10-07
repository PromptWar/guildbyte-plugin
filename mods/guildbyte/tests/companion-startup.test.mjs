import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {openDatabase,run} from '../scripts/worker.mjs'
const directory=mkdtempSync(join(tmpdir(),'guildbyte-startup-')),accountId=randomUUID(),otherId=randomUUID(),sessionId=randomUUID(),heroId=randomUUID()
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
const db=openDatabase(directory),calls=[]
let expired=false
const server=createServer(async(req,res)=>{
 let raw='';for await(const part of req)raw+=part
 calls.push({path:req.url,body:JSON.parse(raw)})
 res.setHeader('content-type','application/json')
 assert.equal(req.url,'/api/installations/heartbeat','Bootstrap must make only its own display/presence request')
 res.statusCode=expired?401:200
 res.end(JSON.stringify(expired?{}:{connected:true,character:{id:heroId,png,level:1,xp:20,nextLevelAt:100,canLevelUp:false},visit:null}))
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const appUrl=`http://127.0.0.1:${server.address().port}`
const account={id:accountId,plan:'max',get projects(){throw Error('History scan must not delay startup')}}
try{
 for(const id of [accountId,otherId])db.prepare('INSERT INTO accounts(id,plan,token) VALUES(?,?,?)').run(id,'max','x'.repeat(48))
 db.prepare('INSERT INTO events(id,at,key,value,kind,source,account_id) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),new Date().toISOString(),'prompt_count',1,'counter','live',accountId)
 const response=await run({action:'status',sessionId,appUrl},{directory,account})
 assert.equal(response.character?.id,heroId,'Hero response must precede history scanning and uploads')
 assert.equal(response.error,undefined)
 assert.equal(calls.length,1,'Other subscriptions cannot delay the visible hero')
 assert.equal(calls[0].body.sessionId,sessionId,'Fast fetch still registers session presence')
 assert.equal(response.pending,1,'Queued activity is untouched until normal background sync')
 assert.equal(db.prepare('SELECT count(*) n FROM files').get().n,0)
 expired=true
 const revoked=await run({action:'status',sessionId,appUrl},{directory,account})
 assert.equal(revoked.connected,false,'Fast startup honors revoked tokens rather than showing a stale cached hero')
 assert.equal(revoked.character,undefined)
 const count=calls.length
 const unlinked=await run({action:'status',sessionId,appUrl},{directory,account})
 assert.equal(unlinked.connected,false);assert.equal(calls.length,count,'Unlinked startup requires neither scanning nor HTTP')
 console.log('Startup passed: one fresh heartbeat, no history scan/uploads/other accounts, queued activity retained, correct presence and revocation.')
}finally{db.close();await new Promise(resolve=>server.close(resolve));rmSync(directory,{recursive:true,force:true})}
