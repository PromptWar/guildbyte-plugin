import { DatabaseSync } from 'node:sqlite'
import { createHash,randomUUID } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { animationPixels } from './decode-companion.mjs'
import { validateAnimation, validateLevelUp } from './companion-animation.mjs'
import { validateProgression, isNewer, fresh, claimable } from './progression.mjs'
import { runDuelCommand } from './duel-client.mjs'
import { webLink } from './duel-format.mjs'

export function stableId(value) {
  const hash = createHash('sha256').update(`guildbyte-v1:${value}`).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}
const isUuid = value => typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value)
const number = value => Number.isSafeInteger(value) && value >= 0 ? value : 0
const TOKEN_KEYS = { input_tokens: 'input_tokens', output_tokens: 'output_tokens', cache_read_input_tokens: 'cache_read_tokens', cache_creation_input_tokens: 'cache_write_tokens' }
// Only the family is stored and uploaded, never the raw model id. Order matters: the first match wins.
// Claude models only; any other model (OpenAI included) is 'unknown'.
const FAMILIES = [['fable', /fable/i], ['opus', /opus/i], ['sonnet', /sonnet/i], ['haiku', /haiku/i]]
export function modelFamily(id) {
  if (typeof id !== 'string') return 'unknown'
  for (const [family, pattern] of FAMILIES) if (pattern.test(id)) return family
  return 'unknown'
}
const eventStatements = new WeakMap()

export function appOrigin(value) {
  const url = new URL(value)
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Use an HTTPS app URL, or http://localhost for local development.')
  }
  return url.origin
}

export function openDatabase(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
  const file = join(directory, 'activity.sqlite')
  const db = new DatabaseSync(file)
  chmodSync(file, 0o600)
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, plan TEXT NOT NULL, token TEXT, installation_id TEXT, pairing TEXT);
    CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, offset INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, session_id TEXT, at TEXT NOT NULL, key TEXT NOT NULL,
      value REAL NOT NULL, resets_at TEXT, kind TEXT NOT NULL, source TEXT NOT NULL, account_id TEXT,
      synced INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS events_pending ON events(synced, account_id, kind);`)
  // Databases created before model tagging upgrade in place.
  const columns = db.prepare('PRAGMA table_info(events)').all().map(column => column.name)
  if (!columns.includes('model')) db.exec('ALTER TABLE events ADD COLUMN model TEXT')
  db.prepare("INSERT OR IGNORE INTO metadata VALUES ('cutoff', ?)").run(new Date().toISOString())
  // Only activity after pairing is collected. Accounts paired before this rule
  // keep their original collection start; unassigned history never uploads.
  const cutoff = getMeta(db, 'cutoff')
  for (const { id } of db.prepare("SELECT id FROM accounts WHERE token IS NOT NULL OR id IN (SELECT substr(key, 8) FROM metadata WHERE key LIKE 'reauth:%')").all())
    db.prepare('INSERT OR IGNORE INTO metadata VALUES (?, ?)').run(`paired-at:${id}`, cutoff)
  db.exec(`DELETE FROM events WHERE account_id IS NULL OR synced=0 AND account_id NOT IN
    (SELECT substr(key, 11) FROM metadata WHERE key LIKE 'paired-at:%')`)
  return db
}
const getMeta = (db, key) => db.prepare('SELECT value FROM metadata WHERE key = ?').get(key)?.value
const setMeta = (db, key, value) => db.prepare('INSERT INTO metadata VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value)
const pairedAt = (db, accountId) => accountId ? getMeta(db, `paired-at:${accountId}`) : undefined

// Live collection starts at the first successful pairing; earlier activity,
// including earlier records of the running session, is never queued.
export function markPaired(db, accountId, at = new Date().toISOString()) {
  db.prepare('INSERT OR IGNORE INTO metadata VALUES (?, ?)').run(`paired-at:${accountId}`, at)
  db.prepare('DELETE FROM events WHERE account_id=? AND synced=0 AND at < ?').run(accountId, pairedAt(db, accountId))
}

function accountIdentity() {
  const status = JSON.parse(execFileSync('claude', ['auth', 'status', '--json'], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }))
  const directory = status.configDirectory || process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  // Read only account identity. OAuth/API credentials are never read or transmitted.
  const configFile = process.env.CLAUDE_CONFIG_DIR ? join(directory, '.claude.json') : join(homedir(), '.claude.json')
  let oauth = {}
  try { oauth = JSON.parse(readFileSync(configFile, 'utf8')).oauthAccount ?? {} } catch { /* Account may not be signed in. */ }
  if (!status.loggedIn || status.authMethod !== 'claude.ai' || !isUuid(oauth.accountUuid) ||
      status.orgId && oauth.organizationUuid !== status.orgId || status.email && oauth.emailAddress !== status.email) {
    throw new Error('Sign in to a Claude subscription, then run /guildbyte-connect.')
  }
  return { id: oauth.accountUuid, plan: String(status.subscriptionType ?? 'unknown').slice(0, 64), projects: status.projectsDirectory || join(directory, 'projects') }
}

export function saveEvent(db, event) {
  if (!event.id || !Number.isFinite(event.value) || event.value < 0) return
  let statement = eventStatements.get(db)
  if (!statement) {
    statement = db.prepare(`INSERT INTO events (id, session_id, at, key, value, resets_at, kind, source, account_id, model)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET value=MAX(events.value, excluded.value), model=COALESCE(excluded.model, events.model),
      at=CASE WHEN events.key IN ('input_tokens','output_tokens','cache_read_tokens','cache_write_tokens','model_step_count') THEN MAX(events.at,excluded.at) ELSE events.at END,
      synced=0
    WHERE excluded.value > events.value OR (events.key IN ('input_tokens','output_tokens','cache_read_tokens','cache_write_tokens','model_step_count') AND excluded.at > events.at)`)
    eventStatements.set(db,statement)
  }
  statement.run(event.id, event.sessionId ?? null, event.at, event.key, event.value,
    event.resetsAt ?? null, event.kind ?? 'counter', event.source ?? 'live', event.accountId ?? null, event.model ?? null)
}

export function ingestRecord(db, record, accountId) {
  const sessionId = record.sessionId
  const date = new Date(record.timestamp)
  if (!isUuid(sessionId) || !Number.isFinite(date.getTime()) || date.getTime() > Date.now() + 300000) return
  const at = date.toISOString()
  const since = pairedAt(db, accountId)
  if (!since || at < since) return // Unpaired, or before pairing: never collected.
  const put = (identity, key, value, model) => saveEvent(db, { id: stableId(identity + ':' + key), sessionId, at, key, value, source: 'live', accountId, ...(model ? { model } : {}) })
  const message = record.message ?? {}
  if (!record.isSidechain && record.type === 'user' && !record.isMeta && !record.isSynthetic && record.uuid) {
    const content = message.content
    const human = typeof content === 'string' || Array.isArray(content) && content.length > 0 && !content.some(block => block.type === 'tool_result')
    if (human) {
      put(`session:${sessionId}`, 'session_count', 1)
      put(`prompt:${record.uuid}`, 'prompt_count', 1)
      const chars = typeof content === 'string' ? content.length : content.filter(block => block.type === 'text').reduce((sum, block) => sum + (block.text?.length ?? 0), 0)
      put(`prompt:${record.uuid}`, 'prompt_chars', chars)
    }
  }
  if (record.type === 'assistant' && message.id && message.usage) {
    put(`request:${message.id}`, 'model_step_count', 1)
    const model = modelFamily(message.model)
    for (const [field, key] of Object.entries(TOKEN_KEYS)) put(`request:${message.id}`, key, number(message.usage[field]), model)
  }
  if (record.type === 'assistant' && Array.isArray(message.content)) {
    for (const block of message.content) if (block.type === 'tool_use' && block.id) {
      put(`tool:${block.id}`, 'tool_call_count', 1)
      if (['Agent', 'Task'].includes(block.name)) put(`agent:${block.id}`, 'subagent_count', 1)
    }
  }
  if (record.type === 'system' && record.subtype === 'compact_boundary' && record.uuid) put(`compact:${record.uuid}`, 'compaction_count', 1)
}

function transcriptFiles(directory) {
  const result = []
  function walk(path, depth) {
    if (depth > 4) return
    let entries
    try { entries = readdirSync(path, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const file = join(path, entry.name)
      if (entry.isDirectory()) walk(file, depth + 1)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) result.push(file)
    }
  }
  walk(directory, 0)
  return result
}

// Incremental reads end at a complete newline; interrupted JSON lines are retried.
export function scanFile(db, file, accountId) {
  const size = statSync(file).size
  let offset = db.prepare('SELECT offset FROM files WHERE path=?').get(file)?.offset ?? 0
  if (size < offset) offset = 0
  if (size === offset) return false
  const fd = openSync(file, 'r')
  const bytes = Buffer.alloc(Math.min(size - offset, 4 * 1024 * 1024))
  let read
  try { read = readSync(fd, bytes, 0, bytes.length, offset) } finally { closeSync(fd) }
  const complete = bytes.subarray(0, read).lastIndexOf(10) + 1
  if (!complete) {
    if (read === 4 * 1024 * 1024) {
      // Oversized transcript rows are skipped locally; otherwise they could block all subsequent requests forever.
      db.prepare('INSERT INTO files VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET offset=excluded.offset').run(file, offset+read)
      setMeta(db, `oversized:${file}`, 'true')
    }
    return true
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    let consumed = 0
    let start = 0
    if (getMeta(db, `oversized:${file}`) === 'true') {
      start = bytes.subarray(0,complete).indexOf(10)+1
      consumed = start
      setMeta(db, `oversized:${file}`, 'false')
    }
    for (const line of bytes.subarray(start, complete).toString('utf8').split('\n').slice(0, -1)) {
      if (!line) { consumed += 1; continue }
      try { ingestRecord(db, JSON.parse(line), accountId) }
      catch { /* Skip malformed local records, never print their contents. */ }
      consumed += Buffer.byteLength(line) + 1
    }
    db.prepare('INSERT INTO files VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET offset=excluded.offset').run(file, offset + consumed)
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  return offset + complete < size
}

export function snapshotReadings(db, account, sessionId, usage) {
  if (!usage) return
  const readings = []
  if (usage.context?.percent != null) readings.push({ key: 'context_percent', value: usage.context.percent })
  for (const limit of usage.rateLimits ?? []) {
    if (['five_hour', 'seven_day'].includes(limit.kind)) readings.push({ key: `${limit.kind}_percent`, value: limit.percentUsed, resetsAt: limit.resetsAt })
  }
  for (const item of readings) {
    if (!Number.isFinite(item.value) || item.value < 0 || item.value > 100) continue
    const signature = JSON.stringify([item.value, item.resetsAt ?? null])
    const metaKey = `reading:${account.id}:${sessionId}:${item.key}`
    if (getMeta(db, metaKey) === signature) continue
    const at = new Date().toISOString()
    saveEvent(db, { ...item, id: stableId(`${metaKey}:${at}:${signature}`), at, kind: 'reading', accountId: account.id })
    setMeta(db, metaKey, signature)
  }
}

export function saveFailures(db, account, sessionId, failures, usage) {
  const since = pairedAt(db, account.id)
  for (const failure of failures ?? []) {
    if (!Number.isFinite(Date.parse(failure.at)) || !since || new Date(failure.at).toISOString() < since) continue
    if (failure.kind === 'context' && typeof failure.id === 'string') {
      saveEvent(db,{id:stableId(`context-limit:${sessionId}:${failure.id}`),sessionId,at:failure.at,key:'context_limit_hit_count',value:1,accountId:account.id})
    }
    if (failure.kind === 'rate_limit') {
      for (const limit of usage?.rateLimits ?? []) {
        if (!['five_hour','seven_day'].includes(limit.kind) || limit.percentUsed < 100 || !limit.resetsAt) continue
        saveEvent(db,{id:stableId(`rate-limit:${account.id}:${limit.kind}:${limit.resetsAt}`),sessionId,at:failure.at,key:`${limit.kind}_limit_hit_count`,value:1,accountId:account.id})
      }
    }
  }
}

async function send(method, origin, path, data, token) {
  const response = await fetch(origin + path, { method, redirect: 'error', signal: AbortSignal.timeout(5000),
    headers: { ...(data === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) })
  if (!response.ok) {
    let body
    try { body=await response.json() } catch { /* Older servers may return no JSON error. */ }
    const detail=typeof body?.error==='string' && body.error.length<=200 ? body.error : undefined
    const error = new Error(detail ? `Guildbyte: ${detail}` : `Guildbyte returned ${response.status}. Pending activity is saved locally.`)
    error.status = response.status
    if (detail) error.detail = detail
    // "Pair Guildbyte first" carries the setup link (duels D2).
    if (typeof body?.setupUrl==='string' && body.setupUrl.length<=500) error.setupUrl = body.setupUrl
    throw error
  }
  return response.json()
}
const request = (origin, path, data, token) => send('POST', origin, path, data, token)
export const get = (origin, path, token) => send('GET', origin, path, undefined, token)

export async function upload(db, origin, session) {
  for (const account of db.prepare('SELECT * FROM accounts WHERE token IS NOT NULL').all()) {
    const active=session?.accountId===account.id && isUuid(session.sessionId)
    const heartbeatKey = `heartbeat:${account.id}${active ? ':'+session.sessionId : ''}`
    const ackKey=active ? `visit-acks:${account.id}:${session.sessionId}` : null
    const acknowledgedVisits=ackKey ? JSON.parse(getMeta(db,ackKey) ?? '[]') : []
    if (acknowledgedVisits.length || Date.now() - Number(getMeta(db, heartbeatKey) ?? 0) >= 10000) {
      try {
        const response=await request(origin, '/api/installations/heartbeat', active ? {sessionId:session.sessionId,acknowledgedVisits} : {}, account.token)
        saveCompanion(db, account.id, response)
        saveProgression(db, account.id, response)
        saveDuelRequests(db, account.id, response, origin)
        if(active) {
          saveVisit(db,account.id,session.sessionId,response)
          // Remove only acknowledgements sent in this request; another worker
          // may have completed a different visit while the request was in flight.
          const pending=JSON.parse(getMeta(db,ackKey) ?? '[]')
          setMeta(db,ackKey,JSON.stringify(pending.filter(id=>!acknowledgedVisits.includes(id) || response.visit?.id===id)))
        }
        setMeta(db, heartbeatKey, String(Date.now()))
      } catch (error) {
        if (error.status !== 401) throw error
        db.prepare('UPDATE accounts SET token=NULL,installation_id=NULL WHERE id=?').run(account.id)
        setMeta(db, `reauth:${account.id}`, 'true')
        continue
      }
    }
    const query = `SELECT * FROM events WHERE synced=0 AND kind=? AND account_id=? AND at >= ? ORDER BY (source='live') DESC, at LIMIT ?`
    const since = pairedAt(db, account.id) ?? new Date().toISOString()
    const counters = db.prepare(query).all('counter', account.id, since, 100)
    db.prepare("UPDATE events SET synced=1 WHERE kind='reading' AND at < ?").run(new Date(Date.now() - 7 * 86400000).toISOString())
    const readings = db.prepare(query).all('reading', account.id, since, 50)
    const sent = [...counters, ...readings]
    if (!sent.length) continue
    const payload = {
      observations: counters.map(event => ({ id: event.id, sessionId: event.session_id, at: event.at, key: event.key, value: event.value,
        source: event.source === 'live' && Date.parse(event.at) < Date.now() - 7 * 86400000 ? 'history' : event.source, ...(event.model ? { model: event.model } : {}) })),
      readings: readings.map(event => ({ id: event.id, at: event.at, key: event.key, value: event.value, resetsAt: event.resets_at })),
    }
    try { saveProgression(db, account.id, await request(origin, '/api/observations', payload, account.token)) }
    catch (error) {
      if (error.status !== 401) throw error
      db.prepare('UPDATE accounts SET token=NULL,installation_id=NULL WHERE id=?').run(account.id)
      setMeta(db, `reauth:${account.id}`, 'true')
      continue
    }
    // Do not acknowledge a value or timestamp another session changed during the HTTP request.
    const ack = db.prepare('UPDATE events SET synced=1 WHERE id=? AND value=? AND at=?')
    for (const event of sent) ack.run(event.id, event.value, event.at)
  }
}

function validatedCharacter(character) {
  if (!character || !isUuid(character.id) || typeof character.png !== 'string' || character.png.length > 2 * 1024 * 1024 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(character.png) ||
      !Buffer.from(character.png, 'base64').subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return null
  const animation = validateAnimation(character.animation)
  if(character.level!==undefined && (!Number.isInteger(character.level)||character.level<1||character.level>5))return null
  if(character.heroId!==undefined && (typeof character.heroId!=='string'||!/^[a-z0-9_]{1,80}$/.test(character.heroId)))return null
  return { id: character.id, png: character.png, ...(character.level!==undefined?{level:character.level}:{}), ...(character.heroId?{heroId:character.heroId}:{}), ...(animation ? { animation } : {}) }
}

// A session keeps artwork in memory; unchanged heartbeats carry only metadata.
function companionArt(character,knownRevision,includeArt) {
  if(!character)return {character:null,revision:null}
  const {png,animation,...metadata}=character
  if(!includeArt)return {character:metadata,revision:null}
  const revision=createHash('sha256').update(JSON.stringify(character)).digest('hex')
  if(revision===knownRevision)return {character:metadata,revision}
  return {character,revision,pixels:animationPixels(animation)}
}

export function saveCompanion(db, accountId, response) {
  if (response.character === null) setMeta(db, `character:${accountId}`, 'null')
  const character=validatedCharacter(response.character)
  if(character && response.character.animation && !character.animation)throw Error('Guildbyte: incompatible animation payload. Update the plugin and restart Claude.')
  if(character)setMeta(db,`character:${accountId}`,JSON.stringify(character))
  const player=response.player
  if(player===null)setMeta(db,`player:${accountId}`,'null')
  else if(player && typeof player.handle==='string' && /^[a-z0-9_]{1,40}$/i.test(player.handle) && Number.isSafeInteger(player.points) && player.points>=0)
    setMeta(db,`player:${accountId}`,JSON.stringify({handle:player.handle,points:player.points}))
}

// Caches the server's progression snapshot. Invalid, absent or older snapshots
// keep the last good one.
export function saveProgression(db, accountId, response, now = Date.now()) {
  const snapshot = validateProgression(response?.progression, now)
  if (!snapshot) return
  const cached = JSON.parse(getMeta(db, `progression:${accountId}`) ?? 'null')
  if (isNewer(snapshot, cached, now)) setMeta(db, `progression:${accountId}`, JSON.stringify(snapshot))
}

export function cachedProgression(db, accountId, origin, now = Date.now()) {
  const snapshot = fresh(JSON.parse(getMeta(db, `progression:${accountId}`) ?? 'null'), now)
  if (!snapshot) return null
  const { claimPath, ...rest } = snapshot
  return { ...rest, claimUrl: origin + claimPath }
}

const DUEL_REQUEST_KINDS = ['duel', 'lobby', 'guild_challenge', 'guild_roster']
const printable = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f-\x9f]/.test(value)

// Caches the heartbeat's open duel requests (`duels.requests`, plan §12). An
// older server sends no `duels` field and leaves the cache as it was; an
// invalid entry is dropped, never shown.
export function saveDuelRequests(db, accountId, response, origin) {
  const requests = response?.duels?.requests
  if (!Array.isArray(requests)) return
  const valid = requests.slice(0, 20).filter(request => request && printable(request.id, 64) && (request.code === null || /^[0-9A-HJKMNP-TV-Z]{6}$/.test(request.code)) &&
    DUEL_REQUEST_KINDS.includes(request.kind) && printable(request.from, 80) && Number.isSafeInteger(request.durationSeconds) && request.durationSeconds > 0 &&
    Number.isSafeInteger(request.wagerGold) && request.wagerGold >= 0 && (request.expiresAt === null || Number.isFinite(Date.parse(request.expiresAt))))
  setMeta(db, `duel-requests:${accountId}`, JSON.stringify(valid.map(({ id, code, kind, from, durationSeconds, wagerGold, expiresAt, webUrl }) =>
    ({ id, code, kind, from, durationSeconds, wagerGold, expiresAt, webUrl: webLink(origin, webUrl, kind.startsWith('guild') ? '/duels?tab=guild' : '/duels') }))))
}

// Each reward unlock, league change and duel request is announced once, across
// every session sharing this database. Rewards and promotions are immediate. A
// demotion is queued quietly and delivered only at the next Claude session
// start; a later league change replaces it.
export function takeNotices(db, accountId, progression, sessionStart = false, now = Date.now()) {
  const key = `notified:${accountId}`, queueKey = `queued-notices:${accountId}`
  db.exec('BEGIN IMMEDIATE')
  try {
    const notified = JSON.parse(getMeta(db, key) ?? '[]')
    const queued = JSON.parse(getMeta(db, queueKey) ?? '[]')
    let queue = queued
    const notices = []
    for (const reward of claimable(progression)) {
      const id = `${progression.localDay}:${reward}`
      if (!notified.includes(id)) notices.push({ id, kind: 'reward', reward, claimUrl: progression.claimUrl })
    }
    // A new duel request toasts once in one session, whichever syncs first.
    for (const request of JSON.parse(getMeta(db, `duel-requests:${accountId}`) ?? '[]')) {
      const id = `duel-request:${request.kind}:${request.code ?? request.id}`
      if (request.expiresAt && Date.parse(request.expiresAt) <= now || notified.includes(id)) continue
      notices.push({ id, kind: 'duel-request', request })
    }
    const change = progression?.leagueChange
    if (change && !notified.includes(`league:${change.id}`)) {
      const notice = { id: `league:${change.id}`, kind: change.kind, from: change.from, to: change.to, claimUrl: progression.claimUrl }
      if (change.kind === 'demotion') queue = [notice]
      else { queue = []; notices.push(notice) }
    }
    const announced = [...notices, ...(queue !== queued ? queue : [])].map(notice => notice.id)
    if (announced.length) setMeta(db, key, JSON.stringify([...notified, ...announced].slice(-50)))
    if (sessionStart && queue.length) { notices.unshift(...queue); queue = [] }
    if (queue !== queued) setMeta(db, queueKey, JSON.stringify(queue))
    db.exec('COMMIT')
    return notices
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

export function saveVisit(db,accountId,sessionId,response) {
  const key=`visit:${accountId}:${sessionId}`,visit=response.visit
  if(visit===null) {setMeta(db,key,'null');return}
  if(!visit || !isUuid(visit.id) || typeof visit.name!=='string' || visit.name.length>80 ||
     !(visit.guild===null || typeof visit.guild==='string' && visit.guild.length<=80) ||
     !Number.isFinite(Date.parse(visit.expiresAt)) || Date.parse(visit.expiresAt)<=Date.now() || Date.parse(visit.expiresAt)>Date.now()+300000)return
  const seen=JSON.parse(getMeta(db,`visit-seen:${accountId}:${sessionId}`) ?? '[]')
  if(seen.includes(visit.id)) {setMeta(db,key,'null');return}
  const character=validatedCharacter(visit.character)
  if(!character?.animation)return
  const clean=value=>value.replace(/[\x00-\x1f\x7f]/g,'')
  setMeta(db,key,JSON.stringify({id:visit.id,name:clean(visit.name),guild:visit.guild===null ? null : clean(visit.guild),expiresAt:visit.expiresAt,character}))
}

function openLink(url) {
  const executable = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open'
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url]
  const child = spawn(executable, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => {}) // The mod also displays the link if no browser is available.
  child.unref()
}

export async function run(input, dependencies = {}) {
  const origin = appOrigin(input.appUrl ?? 'http://localhost:3000')
  const directory = dependencies.directory ?? join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'guildbyte', createHash('sha256').update(origin).digest('hex').slice(0, 16))
  const db = openDatabase(directory)
  let error
  let account
  let linkUrl
  let kiss
  let duel
  let levelUp
  try {
    account = dependencies.account ?? accountIdentity()
    db.prepare('INSERT INTO accounts(id,plan) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET plan=excluded.plan').run(account.id, account.plan)
    let active = db.prepare('SELECT * FROM accounts WHERE id=?').get(account.id)
    // Status reads only the cached authoritative snapshot; no network, no scan.
    if (input.action === 'status') {
      try { return summary(db, account, input.sessionId, origin) } finally { db.close() }
    }
    if (input.action === 'connect') {
      if (active.token) {
        try {
          const response = await request(origin, '/api/installations/heartbeat', {}, active.token)
          saveCompanion(db, account.id, response)
          saveProgression(db, account.id, response)
          saveDuelRequests(db, account.id, response, origin)
        }
        catch (failure) {
          if (failure.status !== 401) throw failure
          db.prepare('UPDATE accounts SET token=NULL,installation_id=NULL WHERE id=?').run(account.id)
          setMeta(db, `reauth:${account.id}`, 'true')
          active = db.prepare('SELECT * FROM accounts WHERE id=?').get(account.id)
        }
      }
      if (!active.token) {
      let pairing = active.pairing && JSON.parse(active.pairing)
      if (!pairing || new Date(pairing.expiresAt) <= new Date()) {
        pairing = await request(origin, '/api/pairings', {})
        if (!isUuid(pairing.id) || !/^[A-F\d]{10}$/.test(pairing.code) || !pairing.exchangeSecret || !Number.isFinite(Date.parse(pairing.expiresAt))) throw new Error('Invalid Guildbyte pairing response.')
        db.prepare('UPDATE accounts SET pairing=? WHERE id=?').run(JSON.stringify(pairing), account.id)
      }
      linkUrl = `${origin}/link?code=${pairing.code}`
      if (!dependencies.noBrowser) openLink(linkUrl)
      }
    }
    for (const pending of db.prepare('SELECT * FROM accounts WHERE pairing IS NOT NULL').all()) {
      const pairing = JSON.parse(pending.pairing)
      if (new Date(pairing.expiresAt) <= new Date()) { db.prepare('UPDATE accounts SET pairing=NULL WHERE id=?').run(pending.id); continue }
      try {
        const linked = await request(origin, '/api/pairings/exchange', { id: pairing.id, exchangeSecret: pairing.exchangeSecret, account: { id: pending.id, plan: pending.plan } })
        if (!isUuid(linked.installationId) || typeof linked.token !== 'string' || linked.token.length < 32) throw new Error('Invalid Guildbyte connection response.')
        db.prepare('UPDATE accounts SET token=?,installation_id=?,pairing=NULL WHERE id=?').run(linked.token, linked.installationId, pending.id)
        setMeta(db, `reauth:${pending.id}`, 'false')
        markPaired(db, pending.id)
      } catch (failure) { if (failure.status !== 404) throw failure }
    }
    if(input.action==='kiss') {
      const token=db.prepare('SELECT token FROM accounts WHERE id=?').get(account.id)?.token
      if(!token)throw Error('Guildbyte: run /guildbyte-connect before sending a kiss.')
      if(typeof input.target!=='string' || !/^@?[a-z0-9_]{3,24}$/i.test(input.target.trim()))throw Error('Guildbyte: use /kiss <Guildbyte handle>.')
      kiss=await request(origin,'/api/companion/kiss',{target:input.target.trim(),requestId:randomUUID()},token)
    }
    if(input.action==='duel') {
      const token=db.prepare('SELECT token FROM accounts WHERE id=?').get(account.id)?.token
      if(!token)throw Error('Guildbyte: run /guildbyte-connect before using /duel.')
      const api={get:path=>get(origin,path,token),post:(path,data)=>request(origin,path,data,token),put:(path,data)=>send('PUT',origin,path,data,token)}
      duel={...await runDuelCommand(typeof input.target==='string' ? input.target : '',api,randomUUID()),origin}
    }
    if(isUuid(input.sessionId) && Array.isArray(input.completedVisits)) {
      const key=`visit-acks:${account.id}:${input.sessionId}`,seenKey=`visit-seen:${account.id}:${input.sessionId}`
      const visit=JSON.parse(getMeta(db,`visit:${account.id}:${input.sessionId}`) ?? 'null')
      const completed=input.completedVisits.filter(id=>isUuid(id) && id===visit?.id).slice(0,20)
      if(completed.length) {
        setMeta(db,key,JSON.stringify([...new Set([...JSON.parse(getMeta(db,key) ?? '[]'),...completed])].slice(-20)))
        setMeta(db,seenKey,JSON.stringify([...new Set([...JSON.parse(getMeta(db,seenKey) ?? '[]'),...completed])].slice(-20)))
      }
    }
    // Only the running session (including its sidechains) is collected, and
    // only from the moment this account paired. Other sessions' transcripts
    // and earlier history are never imported.
    let remaining = false
    if (pairedAt(db, account.id) && isUuid(input.sessionId)) {
      const scanStarted = Date.now()
      let processed = 0
      for (const file of transcriptFiles(account.projects)) {
        if (basename(file) !== `${input.sessionId}.jsonl` && !file.includes(`${input.sessionId}/`)) continue
        const cursor = db.prepare('SELECT offset FROM files WHERE path=?').get(file)?.offset ?? 0
        if (statSync(file).size === cursor) continue
        if (processed++ >= 30 || Date.now()-scanStarted > 6000) { remaining = true; continue }
        remaining = scanFile(db, file, account.id) || remaining
      }
      saveEvent(db,{id:stableId(`session:${input.sessionId}:session_count`),sessionId:input.sessionId,at:new Date().toISOString(),key:'session_count',value:1,accountId:account.id})
      snapshotReadings(db, account, input.sessionId, input.usage)
      saveFailures(db,account,input.sessionId,input.failures,input.usage)
    }
    setMeta(db, 'historyComplete', String(!remaining))
    await upload(db, origin,{sessionId:input.sessionId,accountId:account.id})
    const current=summary(db,account,input.sessionId).character,observed=input.observedCharacter
    const automatic=current && observed?.id===current.id && Number.isInteger(observed.level) && observed.level>=1 && observed.level<current.level
    if(input.action==='levelup' || automatic){
      const token=db.prepare('SELECT token FROM accounts WHERE id=?').get(account.id)?.token
      if(!token)throw Error('Guildbyte: run /guildbyte-connect before testing level-up.')
      if(!current)throw Error('Guildbyte: open a chest and pin a hero first.')
      const fromLevel=automatic?observed.level:(current.level??1)
      const toLevel=input.action==='levelup'?(input.toLevel??Math.min(5,fromLevel+1)):current.level
      if(!Number.isInteger(toLevel)||toLevel<1||toLevel>5)throw Error('Guildbyte: use /guildbyte-levelup [1-5].')
      if(input.heroId!==undefined && (typeof input.heroId!=='string'||!/^[a-z][a-z0-9_]{0,79}$/.test(input.heroId)))throw Error('Guildbyte: use /guildbyte-levelup [1-5] [hero_id].')
      const response=await request(origin,'/api/companion/level-up',{fromLevel,toLevel,...(input.action==='levelup'&&input.heroId?{heroId:input.heroId}:{})},token)
      levelUp=validateLevelUp(response.levelUp)
      if(!levelUp)throw Error('Guildbyte: invalid level-up animation response.')
    }
  } catch (failure) { error = failure.message?.includes('Guildbyte') || failure.message?.startsWith('Sign in') ? failure.message : 'Guildbyte is offline. Activity remains saved locally.' }
  try {
    const result = summary(db, account, input.sessionId, origin)
    const notices = result.connected ? takeNotices(db, account.id, result.progression, input.sessionStart === true) : []
    const art=companionArt(result.character,input.artRevision,input.includeArt!==false),guest=companionArt(result.visit?.character,input.visitorArtRevision,input.includeArt!==false)
    return { ...result,...(result.connected ? {character:art.character} : {}),...(result.visit ? {visit:{...result.visit,character:guest.character}} : {}),artRevision:art.revision,visitorArtRevision:guest.revision,...('pixels' in art ? {pixels:art.pixels} : {}),...('pixels' in guest ? {visitorPixels:guest.pixels} : {}), ...(notices.length ? { notices } : {}), ...(kiss ? {kiss} : {}), ...(duel ? {duel} : {}), ...(levelUp ? {levelUp} : {}), ...(linkUrl ? { linkUrl } : {}), ...(error ? { error } : {}) }
  } finally { db.close() }
}

function summary(db, account,sessionId,origin) {
  const connected = Boolean(account && db.prepare('SELECT token FROM accounts WHERE id=?').get(account.id)?.token)
  const visit=connected && isUuid(sessionId) ? JSON.parse(getMeta(db,`visit:${account.id}:${sessionId}`) ?? 'null') : null
  const seen=visit ? JSON.parse(getMeta(db,`visit-seen:${account.id}:${sessionId}`) ?? '[]') : []
  return {
    connected, plan: account?.plan ?? 'Claude',
    ...(connected ? { character: JSON.parse(getMeta(db, `character:${account.id}`) ?? 'null'), player: JSON.parse(getMeta(db, `player:${account.id}`) ?? 'null'),
      progression: cachedProgression(db, account.id, origin), progressionCached: getMeta(db, `progression:${account.id}`) !== undefined } : {}),
    visit:visit && Date.parse(visit.expiresAt)>Date.now() && !seen.includes(visit.id) ? visit : null,
    accountCount: db.prepare('SELECT count(*) AS n FROM accounts WHERE token IS NOT NULL').get().n,
    pending: db.prepare('SELECT count(*) AS n FROM events WHERE synced=0').get().n,
    tokens: db.prepare("SELECT COALESCE(sum(value),0) AS n FROM events WHERE key IN ('input_tokens','output_tokens','cache_read_tokens','cache_write_tokens')").get().n,
    prompts: db.prepare("SELECT COALESCE(sum(value),0) AS n FROM events WHERE key='prompt_count'").get().n,
    historyComplete: getMeta(db, 'historyComplete') === 'true',
    ...(!connected && account && getMeta(db, `reauth:${account.id}`) === 'true' ? { error: 'Connection expired or disconnected. Run /guildbyte-connect to reauthenticate.' } : {}),
    ...(connected && db.prepare("SELECT 1 FROM metadata WHERE key LIKE 'reauth:%' AND value='true' LIMIT 1").get()
      ? { error: 'A linked Claude account needs reauthentication. Sign into it and run /guildbyte-connect.' } : {}),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const timeout=setTimeout(()=>process.exit(1),25000)
  try {
    let stdin = ''
    for await (const chunk of process.stdin) stdin += chunk
    console.log(JSON.stringify(await run(JSON.parse(stdin))))
  } catch { console.log(JSON.stringify({ error: 'Guildbyte sync could not start. Check Node 22.13+ and the app URL in /config.' })); process.exitCode = 1 }
  finally {clearTimeout(timeout)}
}
