import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { appOrigin, openDatabase, ingestRecord, scanFile, stableId, upload, run, saveFailures, saveCompanion, modelFamily, markPaired, saveProgression, cachedProgression, takeNotices } from '../scripts/worker.mjs'

const directory = mkdtempSync(join(tmpdir(), 'guildbyte-worker-'))
const sessionId = randomUUID()
const accountId = randomUUID()
const account2 = randomUUID()
const account3 = randomUUID()
const db = openDatabase(directory)
const old = new Date(Date.now()-30*86400000).toISOString()
const beforePairing = new Date(Date.now()-120000).toISOString()
const pairedTime = new Date(Date.now()-60000).toISOString()
const live = new Date(Date.now()+100).toISOString()
const row = (type, message, timestamp=live, extra={}) => ({ type, message, sessionId, timestamp, uuid: randomUUID(), ...extra })
// Authoritative snapshots the mock server attaches to heartbeat and sync responses.
const snapshot = (overrides={}) => ({ localDay:'2026-10-05', timeZone:'Europe/Paris', effectiveTokens:8200000, streak:{current:4,longest:9,multiplier:'1.020'},
  rewards:{gold:{unlocked:true,claimed:false},chest:{unlocked:false,claimed:false}}, nextThreshold:15000000,
  expiresAt:new Date(Date.now()+3600000).toISOString(), ...overrides })
let heartbeatProgression
let syncProgression
let requests = 0
let fail = false
let expire = false
let batches = []
let claimed = false
let character = null
let visit=null
let holdAcknowledgement=false
const heartbeats=[],kisses=[],evolutions=[]
const pixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
let duringUpload
const server = createServer(async (request, response) => {
  let body = ''
  requests++
  for await (const chunk of request) body += chunk
  const payload = JSON.parse(body)
  response.setHeader('content-type', 'application/json')
  if (request.url === '/api/pairings') {
    response.end(JSON.stringify({id:randomUUID(),code:'ABCDEF1234',exchangeSecret:'y'.repeat(48),expiresAt:new Date(Date.now()+600000).toISOString()}));return
  }
  if (request.url === '/api/pairings/exchange') {
    if(!claimed){response.statusCode=404;response.end('{}');return}
    assert([accountId,account2,account3].includes(payload.account.id))
    response.end(JSON.stringify({installationId:randomUUID(),token:'x'.repeat(48)}));return
  }
  if (request.url === '/api/installations/heartbeat') {
    heartbeats.push(payload)
    if(payload.acknowledgedVisits?.includes(visit?.id) && !holdAcknowledgement)visit=null
    response.statusCode=expire ? 401 : 200; response.end(JSON.stringify({connected:!expire,character,visit:payload.sessionId===sessionId ? visit : null,...(heartbeatProgression ? {progression:heartbeatProgression} : {})})); return
  }
  if(request.url==='/api/companion/evolve'){
    assert.equal(payload.characterId,character.id)
    if(payload.level!==character.level){response.statusCode=409;response.end(JSON.stringify({error:'Guildbyte: hero changed'}));return}
    character={...character,level:character.level+1,nextLevelAt:400,canLevelUp:false}
    response.end(JSON.stringify({character,levelUp:{id:randomUUID(),heroId:character.heroId,version:1,fromLevel:payload.level,toLevel:character.level,frames:Array(18).fill(pixelPng),durations:Array(18).fill(100),durationMs:1800}}));return
  }
  if(request.url==='/api/companion/level-up'){
    assert.equal(request.headers.authorization,'Bearer '+'x'.repeat(48));evolutions.push(payload)
    response.end(JSON.stringify({levelUp:{id:randomUUID(),heroId:payload.heroId??character.heroId??'cash_cow_solopreneur',version:1,fromLevel:payload.fromLevel,toLevel:payload.toLevel,frames:Array(18).fill(pixelPng),durations:[80,...Array(16).fill(90),120],durationMs:1640}}));return
  }
  if(request.url==='/api/companion/kiss') {
    assert.equal(request.headers.authorization,'Bearer '+'x'.repeat(48));assert.match(payload.requestId,/^[a-f0-9-]{36}$/)
    kisses.push(payload);response.end(JSON.stringify({id:randomUUID(),target:payload.target.replace(/^@/,''),expiresAt:new Date(Date.now()+120000).toISOString()}));return
  }
  if (fail) { response.statusCode=503; response.end('{}'); return }
  assert.equal(request.headers.authorization, 'Bearer ' + 'x'.repeat(48))
  batches.push(payload)
  duringUpload?.()
  response.end(JSON.stringify({accepted:payload.observations.length+payload.readings.length,duplicates:0,...(syncProgression ? {progression:syncProgression} : {})}))
})
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
const origin = `http://127.0.0.1:${server.address().port}`
try {
  assert.throws(() => appOrigin('http://attacker.example'))
  assert.throws(() => appOrigin('https://user:secret@example.com'))
  assert.throws(() => appOrigin('https://example.com/path'))
  const prompt = row('user', {role:'user',content:'PRIVATE PROMPT'})
  // Nothing is collected before this account pairs, not even the running session.
  ingestRecord(db,prompt,accountId)
  assert.equal(db.prepare('SELECT count(*) AS n FROM events').get().n,0)
  markPaired(db,accountId,pairedTime)
  ingestRecord(db,row('user',{role:'user',content:'EARLIER PROMPT'},beforePairing),accountId)
  ingestRecord(db,row('user',{role:'user',content:'OLD PROMPT'},old),accountId)
  assert.equal(db.prepare('SELECT count(*) AS n FROM events').get().n,0,'Activity before pairing is never imported')
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
  assert(db.prepare("SELECT * FROM events").all().every(event=>event.source==='live'&&event.account_id===accountId),'An unpaired account collects nothing')
  // Interrupted writes are retried; records before pairing are skipped while scanning.
  const file = join(directory,'transcript.jsonl')
  const current = row('assistant',{id:'msg_live',usage:{output_tokens:99}},live)
  writeFileSync(file,JSON.stringify(row('assistant',{id:'msg_before',usage:{output_tokens:77}},beforePairing))+'\n'+JSON.stringify(current))
  scanFile(db,file,accountId)
  assert(!db.prepare('SELECT 1 FROM events WHERE id=?').get(stableId('request:msg_live:output_tokens')))
  appendFileSync(file,'\n')
  scanFile(db,file,accountId)
  assert.equal(db.prepare('SELECT value FROM events WHERE id=?').get(stableId('request:msg_live:output_tokens')).value,99)
  assert(!db.prepare('SELECT 1 FROM events WHERE id=?').get(stableId('request:msg_before:output_tokens')))
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
  assert(batches.flatMap(b=>b.observations).every(event=>event.source==='live'),'No history is uploaded')
  const sentCount=batches.length
  await upload(db,origin)
  assert.equal(batches.length,sentCount)
  // Token observations carry the model family derived from the transcript's model id, never the raw id.
  for (const [id,family] of [['claude-fable-5-1','fable'],['claude-fable-5-1[1m]','fable'],['fable','fable'],['claude-opus-5-5[1m]','opus'],['claude-opus-4-8','opus'],['opus','opus'],
    ['claude-sonnet-5','sonnet'],['sonnet','sonnet'],['claude-haiku-4-5-20251001','haiku'],['claude-opus-5-5','opus'],
    // Claude only: the former OpenAI families now resolve to unknown.
    ['gpt-5.5-codex','unknown'],['gpt-5.5','unknown'],['astra-1','unknown'],['astra-2','unknown'],['gpt-sol','unknown'],['terra','unknown'],['luna-mini','unknown'],
    ['<synthetic>','unknown'],['gpt-9-nova','unknown'],[undefined,'unknown'],[42,'unknown']]) assert.equal(modelFamily(id),family,String(id))
  ingestRecord(db,row('assistant',{id:'msg_model',model:'claude-fable-5-1',usage:{output_tokens:11}},live),accountId)
  await upload(db,origin)
  const tagged=batches.flatMap(b=>b.observations).find(o=>o.key==='output_tokens'&&o.value===11)
  assert.equal(tagged.model,'fable')
  assert(!JSON.stringify(batches).includes('claude-fable-5-1'),'Raw model ids are never uploaded')
  assert(batches.flatMap(b=>b.observations).filter(o=>o.key==='model_step_count').every(o=>!('model' in o)),'Only token observations carry a model')
  ingestRecord(db,row('assistant',{id:'msg_unknown',model:'gpt-9-nova',usage:{output_tokens:13}},live),accountId)
  await upload(db,origin)
  assert.equal(batches.flatMap(b=>b.observations).find(o=>o.value===13).model,'unknown')
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
  // Upgrading drops queued unassigned history and unpaired accounts' backlog.
  reopened.prepare("INSERT INTO events (id,at,key,value,kind,source,account_id) VALUES (?,?,?,?,?,?,?)").run(randomUUID(),old,'prompt_count',1,'counter','history',null)
  reopened.prepare("INSERT INTO events (id,at,key,value,kind,source,account_id) VALUES (?,?,?,?,?,?,?)").run(randomUUID(),live,'prompt_count',1,'counter','live',account2)
  reopened.close()
  const upgraded=openDatabase(directory)
  assert.equal(upgraded.prepare('SELECT count(*) AS n FROM events WHERE account_id IS NULL OR account_id=?').get(account2).n,0)
  assert.equal(upgraded.prepare('SELECT value FROM metadata WHERE key=?').get(`paired-at:${accountId}`).value,pairedTime)
  upgraded.close()
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
  saveFailures(db,{id:accountId},sessionId,[{kind:'context',id:'turn:0',at:beforePairing}],limit)
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
  assert.equal(received.visitorPixels.frames.filter(Boolean).length,3,'Only walk frames are decoded; stationary frames remain PNG')
  assert(received.visitorPixels?.frames[0],'The Node worker provides visitor pixels without changing the stored animation contract')
  assert.equal(received.visit.id,visit.id);assert.equal(received.visit.name,'VisitorUser')
  assert.deepEqual(received.character,character,'A visitor never replaces the pinned character')
  const cachedArt=await run({...input,action:'sync',artRevision:received.artRevision,visitorArtRevision:received.visitorArtRevision},dependencies)
  assert.equal(cachedArt.pixels,undefined,'An unchanged hero must not decode/transfer RGBA again')
  assert.equal(cachedArt.visitorPixels,undefined,'An unchanged visitor must not decode/transfer RGBA again')
  assert.equal(cachedArt.character.png,undefined,'An unchanged hero must not transfer its static PNG again')
  assert.equal(cachedArt.visit.character.animation,undefined,'Unchanged animation artwork must not be returned on every heartbeat')
  assert.equal(cachedArt.artRevision,received.artRevision)
  const textOnly=await run({...input,action:'sync',includeArt:false},dependencies)
  assert.equal(textOnly.pixels,undefined);assert.equal(textOnly.visitorPixels,undefined)
  assert.equal(textOnly.character.png,undefined);assert.equal(textOnly.visit.character.animation,undefined)
  const replacement='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNgYPj/HwADAgH/xCAAOgAAAABJRU5ErkJggg=='
  visit={...originalVisit,character:{...originalVisit.character,animation:{...animation,frames:[replacement,...animation.frames.slice(1)]}}}
  db.prepare('DELETE FROM metadata WHERE key LIKE ?').run(`heartbeat:${accountId}%`)
  const changedArt=await run({...input,action:'sync',artRevision:cachedArt.artRevision,visitorArtRevision:cachedArt.visitorArtRevision},dependencies)
  assert.notEqual(changedArt.visitorArtRevision,cachedArt.visitorArtRevision,'Changing artwork invalidates the cache even for the same hero and level')
  assert(changedArt.visitorPixels);assert.equal(changedArt.visit.character.animation.frames[0],replacement)
  visit=originalVisit
  db.prepare('DELETE FROM metadata WHERE key LIKE ?').run(`heartbeat:${accountId}%`)
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
  const playerOf=()=>JSON.parse(db.prepare('SELECT value FROM metadata WHERE key=?').get(`player:${accountId}`)?.value ?? 'undefined')
  saveCompanion(db,accountId,{character:null,player:{handle:'paul_1a2b3c4d',points:1234}})
  assert.deepEqual(playerOf(),{handle:'paul_1a2b3c4d',points:1234})
  saveCompanion(db,accountId,{player:{handle:'\u001b[31mevil',points:-1}})
  assert.deepEqual(playerOf(),{handle:'paul_1a2b3c4d',points:1234},'An invalid player keeps the last good one')
  saveCompanion(db,accountId,{player:null})
  assert.equal(playerOf(),null)
  character={...character,level:1,heroId:'cash_cow_solopreneur'}
  db.prepare('DELETE FROM metadata WHERE key LIKE ?').run(`heartbeat:${accountId}%`)
  const manual=await run({...input,action:'levelup',toLevel:5},dependencies)
  assert.equal(manual.levelUp.frames.length,18);assert.equal(manual.character.level,1,'A test preview leaves the pinned level intact')
  assert.deepEqual(evolutions.at(-1),{fromLevel:1,toLevel:5})
  const selected=await run({...input,action:'levelup',toLevel:3,heroId:'iris_archon'},dependencies)
  assert.equal(selected.levelUp.heroId,'iris_archon')
  assert.equal(selected.character.heroId,'cash_cow_solopreneur','Preview cannot replace pinned hero')
  assert.deepEqual(evolutions.at(-1),{fromLevel:1,toLevel:3,heroId:'iris_archon'})
  assert((await run({...input,action:'levelup',toLevel:6},dependencies)).error.includes('[1-5]'))
  character={...character,level:1,xp:100,canLevelUp:true,nextLevelAt:100}
  db.prepare('DELETE FROM metadata WHERE key LIKE ?').run(`heartbeat:${accountId}%`)
  const earned=await run({...input,action:'evolve',characterId:character.id,level:1},dependencies)
  assert.equal(earned.character.level,2);assert.equal(earned.character.xp,100);assert.equal(earned.character.canLevelUp,false)
  assert.equal(earned.levelUp.toLevel,2)
  const retry=await run({...input,action:'evolve',characterId:character.id,level:1},dependencies)
  assert(retry.error);assert.equal(retry.character.level,2,'Stale manual requests never grant another level')
  const beforeAuto=evolutions.length
  character={...character,level:4}
  db.prepare('DELETE FROM metadata WHERE key LIKE ?').run(`heartbeat:${accountId}%`)
  const automatic=await run({...input,action:'sync',observedCharacter:{id:character.id,level:1}},dependencies)
  assert.equal(automatic.levelUp,undefined,'Sync never triggers evolution automatically');assert.equal(evolutions.length,beforeAuto)
  assert.equal((await run({...input,action:'sync',observedCharacter:{id:character.id,level:4}},dependencies)).levelUp,undefined,'Observed evolution cannot replay every heartbeat')
  assert.equal((await run({...input,action:'sync',observedCharacter:{id:randomUUID(),level:1}},dependencies)).levelUp,undefined,'Pinning a different hero is not a level-up')
  character=null
  db.prepare('DELETE FROM metadata WHERE key LIKE ?').run(`heartbeat:${accountId}%`)
  assert.equal((await run({...input,action:'sync'},dependencies)).character,null)
  const multiple=await run(input,{...dependencies,account:{...dependencies.account,id:account2}})
  assert.equal(multiple.accountCount,2)
  // Progression cache: invalid or older snapshots keep the last good one; expiry hides it.
  const progressionOf=()=>JSON.parse(db.prepare('SELECT value FROM metadata WHERE key=?').get(`progression:${accountId}`)?.value ?? 'null')
  db.prepare('DELETE FROM metadata WHERE key=? OR key=?').run(`progression:${accountId}`,`notified:${accountId}`)
  saveProgression(db,accountId,{progression:snapshot()})
  assert.equal(progressionOf().effectiveTokens,8200000)
  saveProgression(db,accountId,{progression:{...snapshot(),effectiveTokens:-1}})
  saveProgression(db,accountId,{progression:null})
  saveProgression(db,accountId,{})
  assert.equal(progressionOf().effectiveTokens,8200000,'Invalid or absent payloads keep the cache')
  saveProgression(db,accountId,{progression:snapshot({localDay:'2026-10-04',effectiveTokens:1})})
  assert.equal(progressionOf().localDay,'2026-10-05','An older local day never replaces a newer one')
  saveProgression(db,accountId,{progression:snapshot({effectiveTokens:9000000,claimUrl:'https://evil.example/claim'})})
  assert.equal(progressionOf().effectiveTokens,9000000)
  assert.equal(cachedProgression(db,accountId,origin).claimUrl,`${origin}/leaderboard`,'Foreign claim links fall back to the app')
  assert.equal(cachedProgression(db,accountId,origin,Date.parse(progressionOf().expiresAt)),null,'Rewards disappear at local-day expiry')
  // Notices are announced once per unlock and per league change.
  const fresh=cachedProgression(db,accountId,origin)
  assert.deepEqual(takeNotices(db,accountId,fresh).map(n=>n.id),['2026-10-05:gold'])
  assert.deepEqual(takeNotices(db,accountId,fresh),[],'Unchanged state never notifies twice')
  const changeId=randomUUID()
  const later={...fresh,rewards:{gold:{unlocked:true,claimed:true},chest:{unlocked:true,claimed:false}},leagueChange:{id:changeId,kind:'promotion',from:'Silver I',to:'Gold II'}}
  assert.deepEqual(takeNotices(db,accountId,later).map(n=>n.id),['2026-10-05:chest',`league:${changeId}`])
  assert.deepEqual(takeNotices(db,accountId,later),[])
  // Demotions wait quietly for the next session start, are delivered once, and a later change replaces them.
  const demotionId=randomUUID(),demoted={...later,leagueChange:{id:demotionId,kind:'demotion',from:'Gold II',to:'Silver I'}}
  assert.deepEqual(takeNotices(db,accountId,demoted),[],'A demotion is never shown mid-session')
  assert.deepEqual(takeNotices(db,accountId,demoted),[],'A queued demotion is not queued twice')
  assert.deepEqual(takeNotices(db,accountId,null),[],'Expired progression keeps the queue')
  assert.deepEqual(takeNotices(db,accountId,null,true).map(n=>[n.kind,n.to]),[['demotion','Silver I']])
  assert.deepEqual(takeNotices(db,accountId,demoted,true),[],'A delivered demotion never repeats')
  const reDemoted={...later,leagueChange:{id:randomUUID(),kind:'demotion',from:'Silver I',to:'Silver II'}}
  assert.deepEqual(takeNotices(db,accountId,reDemoted),[])
  const promotedId=randomUUID()
  assert.deepEqual(takeNotices(db,accountId,{...later,leagueChange:{id:promotedId,kind:'promotion',from:'Silver II',to:'Gold III'}}).map(n=>n.id),[`league:${promotedId}`],'Promotions stay immediate')
  assert.deepEqual(takeNotices(db,accountId,reDemoted,true),[],'A promotion drops the stale queued demotion')
  const startDemotion={...later,leagueChange:{id:randomUUID(),kind:'demotion',from:'Gold III',to:'Silver I'}}
  assert.deepEqual(takeNotices(db,accountId,startDemotion,true).map(n=>n.kind),['demotion'],'A demotion seen at session start shows then')
  db.prepare('DELETE FROM metadata WHERE key=?').run(`queued-notices:${accountId}`)
  // End to end: sync and heartbeat responses refresh the cache; status reads it without network.
  db.prepare('DELETE FROM metadata WHERE key=? OR key=?').run(`progression:${accountId}`,`notified:${accountId}`)
  character={id:randomUUID(),png:pixelPng}
  heartbeatProgression=snapshot({effectiveTokens:1000000,rewards:{gold:{unlocked:false,claimed:false},chest:{unlocked:false,claimed:false}}})
  db.prepare('DELETE FROM metadata WHERE key LIKE ?').run(`heartbeat:${accountId}%`)
  const beat=await run({...input,action:'sync'},dependencies)
  assert.equal(beat.progression.effectiveTokens,1000000)
  assert.equal(beat.progression.claimUrl,`${origin}/leaderboard`)
  assert.equal(beat.progressionCached,true)
  assert.equal(beat.notices,undefined,'Nothing is unlocked yet')
  syncProgression=snapshot({effectiveTokens:7600000,claimUrl:'/leaderboard?claim=1',league:{division:'Gold II'},leagueChange:{id:changeId,kind:'promotion',from:'Silver I',to:'Gold II'}})
  ingestRecord(db,row('assistant',{id:'msg_progress',usage:{output_tokens:21}}),accountId)
  const synced=await run({...input,action:'sync'},dependencies)
  assert.equal(synced.progression.effectiveTokens,7600000)
  assert.equal(synced.progression.claimUrl,`${origin}/leaderboard?claim=1`)
  assert.deepEqual(synced.notices.map(n=>n.kind),['reward','promotion'])
  assert.equal((await run({...input,action:'sync'},dependencies)).notices,undefined,'A repeated sync with unchanged state does not notify')
  const before=requests
  const status=await run({...input,action:'status'},dependencies)
  assert.equal(requests,before,'Status uses only the cached snapshot')
  assert.equal(status.progression.effectiveTokens,7600000)
  assert.equal(status.notices,undefined)
  // End to end: a demotion syncs silently and appears only on the next session-start run.
  syncProgression=snapshot({effectiveTokens:7700000,league:{division:'Silver I'},leagueChange:{id:randomUUID(),kind:'demotion',from:'Gold II',to:'Silver I'}})
  ingestRecord(db,row('assistant',{id:'msg_demoted',usage:{output_tokens:22}}),accountId)
  const quiet=await run({...input,action:'sync'},dependencies)
  assert.equal(quiet.progression.league.division,'Silver I')
  assert.equal(quiet.notices,undefined,'A mid-session demotion is queued, not shown')
  assert.equal((await run({...input,action:'status'},dependencies)).notices,undefined,'Status never drains the queue')
  assert.deepEqual((await run({...input,action:'sync',sessionStart:true},dependencies)).notices.map(n=>[n.kind,n.to]),[['demotion','Silver I']])
  assert.equal((await run({...input,action:'sync',sessionStart:true},dependencies)).notices,undefined,'Delivered once')
  heartbeatProgression=syncProgression=undefined
  console.log('Worker checks passed: pairing gate, privacy, usage, retries, reinstall, expiry, pinned characters, session-isolated visits, acknowledgement, kiss commands, progression cache, notices and status')
  {
    const directory2=mkdtempSync(join(tmpdir(),'guildbyte-pairing-'))
    try {
      const runningSession=randomUUID(),otherSession=randomUUID()
      const projects=join(directory2,'projects','work')
      mkdirSync(projects,{recursive:true})
      const transcript=join(projects,`${runningSession}.jsonl`)
      const line=(session,id,tokens,at)=>JSON.stringify({type:'assistant',sessionId:session,timestamp:at,uuid:randomUUID(),message:{id,usage:{output_tokens:tokens}}})+'\n'
      writeFileSync(transcript,line(runningSession,'msg_pre_pair',5,new Date(Date.now()-1000).toISOString()))
      writeFileSync(join(projects,`${otherSession}.jsonl`),line(otherSession,'msg_other',6,new Date().toISOString()))
      const deps={directory:directory2,account:{id:account3,plan:'pro',projects:join(directory2,'projects')},noBrowser:true}
      const base={appUrl:origin,sessionId:runningSession}
      claimed=false
      const unpaired=await run({...base,action:'sync'},deps)
      assert.equal(unpaired.connected,false);assert.equal(unpaired.pending,0,'Nothing queues before pairing')
      await run({...base,action:'connect'},deps)
      claimed=true
      const sent=batches.length
      const paired=await run({...base,action:'sync'},deps)
      assert.equal(paired.connected,true)
      appendFileSync(transcript,line(runningSession,'msg_post_pair',7,new Date(Date.now()+50).toISOString()))
      await run({...base,action:'sync'},deps)
      const uploaded=batches.slice(sent).flatMap(b=>b.observations).filter(o=>o.key==='output_tokens').map(o=>o.value)
      assert.deepEqual(uploaded,[7],'Only the running session after pairing is collected; no earlier or other-session import')
    } finally { rmSync(directory2,{recursive:true,force:true}) }
  }
  console.log('Pairing checks passed: no pre-pair or other-session import')
} finally {
  db.close()
  await new Promise(resolve=>server.close(resolve))
  rmSync(directory,{recursive:true,force:true})
}
