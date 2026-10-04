import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { appOrigin, openDatabase, ingestRecord, scanFile, stableId, upload, run, saveFailures, saveCompanion } from '../scripts/worker.mjs'

const directory = mkdtempSync(join(tmpdir(), 'guildbyte-worker-'))
const sessionId = randomUUID()
const accountId = randomUUID()
const account2 = randomUUID()
const db = openDatabase(directory)
const old = new Date(Date.now()-30*86400000).toISOString()
const live = new Date(Date.now()+100).toISOString()
const row = (type, message, timestamp=old, extra={}) => ({ type, message, sessionId, timestamp, uuid: randomUUID(), ...extra })
let fail = false
let expire = false
let batches = []
let claimed = false
let character = null
let visit=null
let holdAcknowledgement=false
const heartbeats=[],kisses=[]
const pixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
let duringUpload
const server = createServer(async (request, response) => {
  let body = ''
  for await (const chunk of request) body += chunk
  const payload = JSON.parse(body)
  response.setHeader('content-type', 'application/json')
  if (request.url === '/api/pairings') {
    response.end(JSON.stringify({id:randomUUID(),code:'ABCDEF1234',exchangeSecret:'y'.repeat(48),expiresAt:new Date(Date.now()+600000).toISOString()}));return
  }
  if (request.url === '/api/pairings/exchange') {
    if(!claimed){response.statusCode=404;response.end('{}');return}
    assert([accountId,account2].includes(payload.account.id))
    response.end(JSON.stringify({installationId:randomUUID(),token:'x'.repeat(48)}));return
  }
  if (request.url === '/api/installations/heartbeat') {
    heartbeats.push(payload)
    if(payload.acknowledgedVisits?.includes(visit?.id) && !holdAcknowledgement)visit=null
    response.statusCode=expire ? 401 : 200; response.end(JSON.stringify({connected:!expire,character,visit:payload.sessionId===sessionId ? visit : null})); return
  }
  if(request.url==='/api/companion/kiss') {
    assert.equal(request.headers.authorization,'Bearer '+'x'.repeat(48));assert.match(payload.requestId,/^[a-f0-9-]{36}$/)
    kisses.push(payload);response.end(JSON.stringify({id:randomUUID(),target:payload.target.replace(/^@/,''),expiresAt:new Date(Date.now()+120000).toISOString()}));return
  }
  if (fail) { response.statusCode=503; response.end('{}'); return }
  assert.equal(request.headers.authorization, 'Bearer ' + 'x'.repeat(48))
  batches.push(payload)
  duringUpload?.()
  response.end(JSON.stringify({accepted:payload.observations.length+payload.readings.length,duplicates:0}))
})
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
const origin = `http://127.0.0.1:${server.address().port}`
try {
  assert.throws(() => appOrigin('http://attacker.example'))
  assert.throws(() => appOrigin('https://user:secret@example.com'))
  assert.throws(() => appOrigin('https://example.com/path'))
  const prompt = row('user', {role:'user',content:'PRIVATE PROMPT'})
  ingestRecord(db,prompt,accountId)
  ingestRecord(db,prompt,accountId)
  ingestRecord(db,row('user',{role:'user',content:[{type:'tool_result',content:'PRIVATE CODE'}]}),accountId)
  const request = row('assistant',{id:'msg_shared',usage:{input_tokens:2,output_tokens:100,cache_read_input_tokens:500,cache_creation_input_tokens:20},content:[{type:'tool_use',id:'tool_shared',name:'Agent',input:{prompt:'PRIVATE TASK'}}]})
  ingestRecord(db,request,accountId)
  ingestRecord(db,request,account2)
  ingestRecord(db,{...request,message:{...request.message,usage:{...request.message.usage,output_tokens:150}}},accountId)
  assert.equal(db.prepare("SELECT value FROM events WHERE key='output_tokens'").get().value,150)
  assert.equal(db.prepare("SELECT count(*) AS n FROM events WHERE key='prompt_count'").get().n,1)
  assert.equal(db.prepare("SELECT count(*) AS n FROM events WHERE key='subagent_count'").get().n,1)
  assert(db.prepare("SELECT * FROM events").all().every(event=>event.source==='history'&&event.account_id===null))
  // Unattributed live records do not consume another running session's cursor.
  const file = join(directory,'transcript.jsonl')
  const current = row('assistant',{id:'msg_live',usage:{output_tokens:99}},live)
  writeFileSync(file,JSON.stringify(current))
  scanFile(db,file,accountId,true)
  assert(!db.prepare('SELECT 1 FROM events WHERE id=?').get(stableId('request:msg_live:output_tokens')))
  appendFileSync(file,'\n')
  scanFile(db,file,null,true)
  assert.equal(db.prepare('SELECT offset FROM files WHERE path=?').get(file).offset,0)
  scanFile(db,file,accountId,true)
  assert.equal(db.prepare('SELECT value FROM events WHERE id=?').get(stableId('request:msg_live:output_tokens')).value,99)
  db.prepare('INSERT INTO accounts(id,plan,token) VALUES (?,?,?)').run(accountId,'max','x'.repeat(48))
  fail=true
  await assert.rejects(upload(db,origin))
  assert(db.prepare('SELECT count(*) AS n FROM events WHERE synced=0').get().n>0)
  fail=false
  await upload(db,origin)
  assert.equal(db.prepare('SELECT count(*) AS n FROM events WHERE synced=0').get().n,0)
  const sent = JSON.stringify(batches)
  assert(!sent.includes('PRIVATE')&&!sent.includes('prompt"')&&!sent.includes('tool_shared'))
  assert(batches[0].observations.some(event=>event.source==='live'))
  const sentCount=batches.length
  await upload(db,origin)
  assert.equal(batches.length,sentCount)
  // A concurrent session can advance a request timestamp while a batch is in flight.
  const progressive = {...current,timestamp:new Date(Date.now()+200).toISOString()}
  ingestRecord(db,progressive,accountId)
  const outputId=stableId('request:msg_live:output_tokens')
  duringUpload=()=>db.prepare('UPDATE events SET at=?,synced=0 WHERE id=?').run(new Date(Date.now()+300).toISOString(),outputId)
  await upload(db,origin)
  assert.equal(db.prepare('SELECT synced FROM events WHERE id=?').get(outputId).synced,0)
  duringUpload=undefined
  await upload(db,origin)
  assert.equal(db.prepare('SELECT synced FROM events WHERE id=?').get(outputId).synced,1)
  // Reopening the durable DB (as after reinstall) retains tokens and checkpoints.
  const reopened=openDatabase(directory)
  assert.equal(reopened.prepare('SELECT token FROM accounts WHERE id=?').get(accountId).token,'x'.repeat(48))
  ingestRecord(reopened,request,accountId)
  assert.equal(reopened.prepare('SELECT count(*) AS n FROM events WHERE synced=0').get().n,0)
  reopened.close()
  // Expiry keeps unsent events and clears the unusable token for reauthentication.
  ingestRecord(db,row('assistant',{id:'msg_after',usage:{output_tokens:8}},live),accountId)
  db.prepare('DELETE FROM metadata WHERE key LIKE ?').run(`heartbeat:${accountId}%`)
  expire=true
  await upload(db,origin)
  assert.equal(db.prepare('SELECT token FROM accounts WHERE id=?').get(accountId).token,null)
  assert(db.prepare('SELECT count(*) AS n FROM events WHERE synced=0').get().n>0)
  // Exhaustion requires a real failure plus a reported exhausted budget, never just a percentage.
  const failures=[{kind:'rate_limit',at:live},{kind:'context',id:'turn:1',at:live}]
  const limit={rateLimits:[{kind:'five_hour',percentUsed:100,resetsAt:new Date(Date.now()+3600000).toISOString()}]}
  saveFailures(db,{id:accountId},sessionId,failures,limit)
  saveFailures(db,{id:accountId},sessionId,failures,limit)
  assert.equal(db.prepare("SELECT count(*) AS n FROM events WHERE key='context_limit_hit_count'").get().n,1)
  assert.equal(db.prepare("SELECT count(*) AS n FROM events WHERE key='five_hour_limit_hit_count'").get().n,1)
  assert.equal(db.prepare("SELECT count(*) AS n FROM events WHERE key='seven_day_limit_hit_count'").get().n,0)
  expire=false
  const input={action:'connect',appUrl:origin,sessionId,importHistory:true}
  const dependencies={directory,account:{id:accountId,plan:'max',projects:join(directory,'empty-projects')},noBrowser:true}
  const connecting=await run(input,dependencies)
  assert(connecting.linkUrl.endsWith('/link?code=ABCDEF1234'))
  assert(!connecting.connected)
  claimed=true
  const connected=await run({...input,action:'sync'},dependencies)
  assert.equal(connected.connected,true)
  character={id:randomUUID(),png:pixelPng}
  db.prepare('DELETE FROM metadata WHERE key LIKE ?').run(`heartbeat:${accountId}%`)
  const pinned=await run({...input,action:'sync'},dependencies)
  assert.deepEqual(pinned.character,character)
  character={id:randomUUID(),png:pixelPng}
  db.prepare('DELETE FROM metadata WHERE key LIKE ?').run(`heartbeat:${accountId}%`)
  const switched=await run({...input,action:'sync'},dependencies)
  assert.deepEqual(switched.character,character)
  const animation={version:1,frames:Array(20).fill(pixelPng),clips:Object.fromEntries(['idle','walk','sit','talk','kiss','wave','laugh','angry','victory','sleep'].map(s=>[s,{frames:[0,1,2],durations:[100,100,100]}]))}
  visit={id:randomUUID(),name:'Visitor\0User',guild:'Pixel Forge',expiresAt:new Date(Date.now()+120000).toISOString(),character:{id:randomUUID(),png:pixelPng,animation}}
  const originalVisit=visit
  db.prepare('DELETE FROM metadata WHERE key LIKE ?').run(`heartbeat:${accountId}%`)
  const received=await run({...input,action:'sync'},dependencies)
  assert.equal(received.visit.id,visit.id);assert.equal(received.visit.name,'VisitorUser')
  assert.deepEqual(received.character,character,'A visitor never replaces the pinned character')
  holdAcknowledgement=true
  const acknowledged=await run({...input,action:'sync',completedVisits:[visit.id]},dependencies)
  assert.equal(acknowledged.visit,null)
  assert(JSON.parse(db.prepare('SELECT value FROM metadata WHERE key=?').get(`visit-acks:${accountId}:${sessionId}`).value).includes(originalVisit.id),'An early acknowledgement must remain queued until the server accepts it')
  holdAcknowledgement=false
  assert.equal((await run({...input,action:'sync'},dependencies)).visit,null)
  assert.deepEqual(JSON.parse(db.prepare('SELECT value FROM metadata WHERE key=?').get(`visit-acks:${accountId}:${sessionId}`).value),[])
  assert(heartbeats.some(h=>h.sessionId===sessionId && h.acknowledgedVisits?.includes(originalVisit.id)))
  visit=originalVisit
  db.prepare('DELETE FROM metadata WHERE key LIKE ?').run(`heartbeat:${accountId}%`)
  assert.equal((await run({...input,action:'sync'},dependencies)).visit,null,'Acknowledged visits cannot replay locally')
  assert.equal((await run({...input,action:'sync',sessionId:randomUUID()},dependencies)).visit,null,'Visits remain isolated by session')
  const kissed=await run({...input,action:'kiss',target:'@bob'},dependencies)
  assert.equal(kissed.kiss.target,'bob');assert.equal(kisses.length,1)
  assert((await run({...input,action:'kiss',target:'invalid user name'},dependencies)).error.includes('use /kiss'))
  assert.equal(kisses.length,1)
  saveCompanion(db,accountId,{character:{id:character.id,png:'invalid'}})
  assert.deepEqual(JSON.parse(db.prepare('SELECT value FROM metadata WHERE key=?').get(`character:${accountId}`).value),character)
  character=null
  db.prepare('DELETE FROM metadata WHERE key LIKE ?').run(`heartbeat:${accountId}%`)
  assert.equal((await run({...input,action:'sync'},dependencies)).character,null)
  const multiple=await run(input,{...dependencies,account:{...dependencies.account,id:account2}})
  assert.equal(multiple.accountCount,2)
  console.log('Worker checks passed: history, privacy, usage, retries, reinstall, expiry, pinned characters, session-isolated visits, acknowledgement and kiss commands')
} finally {
  db.close()
  await new Promise(resolve=>server.close(resolve))
  rmSync(directory,{recursive:true,force:true})
}
