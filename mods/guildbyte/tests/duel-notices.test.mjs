import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { openDatabase, run, saveDuelRequests, takeNotices } from '../scripts/worker.mjs'
import { duelNoticeText } from '../scripts/duel-format.mjs'

const directory = mkdtempSync(join(tmpdir(), 'guildbyte-duel-notices-'))
const accountId = randomUUID()
const origin = 'https://guildbyte.test'
const later = minutes => new Date(Date.now() + minutes * 60000).toISOString()
const request = (extra = {}) => ({ id: randomUUID(), code: 'Q7KM2P', kind: 'duel', from: 'alice', durationSeconds: 21600, wagerGold: 25, expiresAt: later(1380), webUrl: '/duels/Q7KM2P', ...extra })
const ids = notices => notices.map(notice => notice.id)

try {
  // ---------- Cache and deduplication ----------
  const db = openDatabase(directory)
  const challenge = request()
  const guild = request({ code: 'G7KM2P', kind: 'guild_challenge', from: 'Rivals', durationSeconds: 604800, webUrl: 'https://evil.test/x y' })
  saveDuelRequests(db, accountId, { duels: { badge: 2, energy: null, requests: [challenge, guild,
    request({ code: 'bad' }), request({ kind: 'mail' }), request({ from: 'x\u0007y' }), request({ wagerGold: -1 }), request({ expiresAt: 'soon' }), null] } }, origin)
  const first = takeNotices(db, accountId, null)
  assert.deepEqual(ids(first), ['duel-request:duel:Q7KM2P', 'duel-request:guild_challenge:G7KM2P'], 'Invalid requests are dropped')
  assert.deepEqual(first[0], { id: 'duel-request:duel:Q7KM2P', kind: 'duel-request', request: { ...challenge, webUrl: `${origin}/duels/Q7KM2P` } }, 'Relative links become absolute')
  assert.equal(first[1].request.webUrl, `${origin}/duels?tab=guild`, 'Unprintable links fall back to the guild tab')
  assert.match(duelNoticeText(first[0]), /^⚔ @alice challenges you · 6h · 25 gold wager · expires in 23h\. \/duel accept Q7KM2P · \/duel decline Q7KM2P · https:\/\/guildbyte\.test\/duels\/Q7KM2P$/)
  assert.deepEqual(takeNotices(db, accountId, null), [], 'A request toasts once')
  assert.deepEqual(takeNotices(db, accountId, null, true), [], 'Not even again at the next session start')

  // An older server sends no `duels` field: the cache stays, nothing repeats.
  saveDuelRequests(db, accountId, { connected: true }, origin)
  assert.deepEqual(takeNotices(db, accountId, null), [])
  // Expired requests never toast; a request without a code is keyed by id.
  const uncoded = request({ code: null, kind: 'guild_roster', from: 'Rivals' })
  saveDuelRequests(db, accountId, { duels: { requests: [request({ code: 'OLD001', expiresAt: later(-1) }), uncoded] } }, origin)
  assert.deepEqual(ids(takeNotices(db, accountId, null)), [`duel-request:guild_roster:${uncoded.id}`])
  // Duel notices share the reward and league ledger.
  const progression = { localDay: '2026-10-06', rewards: { gold: { unlocked: true, claimed: false }, chest: { unlocked: false, claimed: false } }, claimUrl: `${origin}/leaderboard` }
  saveDuelRequests(db, accountId, { duels: { requests: [request({ code: 'NEW002' })] } }, origin)
  assert.deepEqual(ids(takeNotices(db, accountId, progression)), ['2026-10-06:gold', 'duel-request:duel:NEW002'])
  assert.deepEqual(takeNotices(db, accountId, progression), [])
  db.close()
  rmSync(directory, { recursive: true, force: true })

  // ---------- Heartbeat → worker status, across concurrent sessions ----------
  let requests = [request({ code: 'HB0001' })]
  let heartbeats = 0
  const server = createServer(async (incoming, response) => {
    for await (const _ of incoming) { /* drain */ }
    const send = value => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(value)) }
    if (incoming.url === '/api/installations/heartbeat') { heartbeats++; return send({ connected: true, character: null, duels: { badge: requests.length, energy: null, requests } }) }
    if (incoming.url === '/api/observations') return send({ accepted: 0, duplicates: 0 })
    response.statusCode = 404; send({ error: 'No mock' })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const appUrl = `http://127.0.0.1:${server.address().port}`
  try {
    const dependencies = { directory, account: { id: accountId, plan: 'max', projects: join(directory, 'projects') }, noBrowser: true }
    const paired = openDatabase(directory)
    paired.prepare('INSERT INTO accounts(id,plan,token) VALUES (?,?,?)').run(accountId, 'max', 'x'.repeat(48))
    paired.close()
    const sessions = [randomUUID(), randomUUID()]
    const sync = sessionId => run({ action: 'sync', appUrl, sessionId }, dependencies)
    const both = await Promise.all(sessions.map(sync))
    assert.equal(heartbeats, 2, 'Each session sends its own heartbeat')
    const shown = both.flatMap(status => (status.notices ?? []).map(notice => notice.id))
    assert.deepEqual(shown, ['duel-request:duel:HB0001'], 'Two concurrent sessions show one toast between them')
    assert.equal(both.find(status => status.notices)?.notices[0].request.webUrl, `${appUrl}/duels/Q7KM2P`)

    // A later request toasts in whichever session syncs next; the old one stays quiet.
    requests = [...requests, request({ code: 'HB0002', kind: 'lobby', from: 'kim' })]
    const db2 = openDatabase(directory)
    db2.prepare("DELETE FROM metadata WHERE key LIKE 'heartbeat:%'").run()
    db2.close()
    const next = await sync(sessions[1])
    assert.deepEqual(ids(next.notices ?? []), ['duel-request:lobby:HB0002'])
    assert.equal((await sync(sessions[0])).notices, undefined)
  } finally { await new Promise(resolve => server.close(resolve)) }

  console.log('Duel notice checks passed: heartbeat requests validated, cached, absolute links, one toast across sessions, expiry and older servers')
} finally {
  rmSync(directory, { recursive: true, force: true })
}
