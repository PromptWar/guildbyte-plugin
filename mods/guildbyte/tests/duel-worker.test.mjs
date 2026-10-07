import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { openDatabase, run, get } from '../scripts/worker.mjs'
import { formatDuelReply } from '../scripts/duel-format.mjs'

const directory = mkdtempSync(join(tmpdir(), 'guildbyte-duel-'))
const accountId = randomUUID()
const bearer = 'x'.repeat(48)
const token = 'k3J9_x-QpL2mN8vR4tY6wZ1aB5cD7eF0gH2iJ4kL6mN'
const confirm = (lossGold = null, allIn = false) => ({ required: Boolean(lossGold || allIn), lossGold, allIn, message: lossGold ? `You can lose ${lossGold} gold` : allIn ? 'All-in' : null })
const summary = (extra = {}) => ({ id: randomUUID(), code: 'Q7KM2P', url: '/duels/Q7KM2P', rulesVersion: 2, mode: 'competitive', entry: 'named', status: 'proposed', endedReason: null, invalidatedReason: null,
  capacity: 2, durationSeconds: 21600, wagerGold: 25, potGold: 50, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), startsAt: null, endsAt: null,
  settlesAt: null, settledAt: null, provisional: false, creator: 'me', winner: null,
  participants: [{ handle: 'me', href: '/players/me', seat: 0, role: 'creator', state: 'joined', hero: null, score: null, rank: null, outcome: null, payoutGold: 0, lastSyncedAt: null, isYou: true },
    { handle: 'alice', href: '/players/alice', seat: 1, role: 'invitee', state: 'invited', hero: null, score: null, rank: null, outcome: null, payoutGold: 0, lastSyncedAt: null, isYou: false }],
  you: { seated: true, canAccept: false, canDecline: false, canJoin: false, canLeave: false, canCancel: true, canForfeit: false, energyCost: 1, confirm: confirm() }, ...extra })
const guildSide = (which, name) => ({ side: which, guild: { id: `${which}-id`, name, slug: name.toLowerCase() }, total: null, outcome: null, readyCount: 0, roster: [] })
const guildSummary = (extra = {}) => ({ id: randomUUID(), code: 'G7KM2P', url: '/duels/guild/G7KM2P', rulesVersion: 2, mode: 'competitive', status: 'rostering', endedReason: null, invalidatedReason: null,
  teamSize: 3, durationSeconds: 604800, wagerGold: 150, potGold: 900, proposedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 6 * 86400000).toISOString(), startsAt: null, endsAt: null,
  settlesAt: null, settledAt: null, provisional: false, winner: null, sides: [guildSide('challenger', 'Owls'), guildSide('defender', 'Rivals')],
  you: { side: 'challenger', canAccept: false, canDecline: false, canCancel: true, canEditRoster: true, canReady: true, canUnready: false, canDeclineSelection: true, confirm: confirm(150) }, ...extra })
const energy = { available: 2, reserved: 1, max: 3, nextAt: new Date(Date.now() + 3600000).toISOString(), price: 1000, canPurchase: true }

// Mock app: records every call and answers from `state`.
const state = { gold: 340, inviteConfirm: confirm(), lobbyConfirm: confirm(), link: { url: null, enabled: true, durationSeconds: 21600, activeCount: 2 }, failNext: null, offline: false }
const calls = []
const server = createServer(async (request, response) => {
  let body = ''
  for await (const chunk of request) body += chunk
  const url = new URL(request.url, 'http://mock')
  const send = (value, status = 200) => { response.statusCode = status; response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(value)) }
  // The regular sync that follows every worker action.
  if (url.pathname === '/api/installations/heartbeat') return send({ connected: true, character: null })
  if (url.pathname === '/api/observations') return send({ accepted: JSON.parse(body).observations.length, duplicates: 0 })
  calls.push({ method: request.method, path: url.pathname, body: body ? JSON.parse(body) : undefined, auth: request.headers.authorization, type: request.headers['content-type'] })
  if (state.offline) { request.socket.destroy(); return }
  if (state.failNext) { const failure = state.failNext; state.failNext = null; return send(failure.body, failure.status) }
  const key = `${request.method} ${url.pathname}`
  const payload = body ? JSON.parse(body) : {}
  switch (key) {
    case 'GET /api/duels/me': return send({ energy, gold: state.gold, wagersEnabled: true, requests: [summary({ code: 'REQ001', participants: summary().participants.map(p => ({ ...p, isYou: !p.isYou, handle: p.isYou ? 'alice' : 'me', state: p.isYou ? 'joined' : 'invited' })), you: { ...summary().you, canAccept: true, canDecline: true } })],
      sent: [], lobbies: [], active: [], exhibitions: { activeCount: 0, items: [], nextCursor: null }, recent: [], guild: { pending: [], active: [] }, record: { wins: 0, losses: 0, draws: 0, winRate: null, currentStreak: 0 }, badge: 1, webUrl: '/duels' })
    case 'POST /api/duels': return send(summary({ durationSeconds: payload.durationSeconds, wagerGold: payload.wagerGold, potGold: payload.wagerGold * 2, mode: payload.wagerGold ? 'competitive' : 'exhibition' }), 201)
    case 'POST /api/duels/lobbies': return send(summary({ code: 'L0BBY1', entry: 'open', capacity: payload.capacity, joinUrl: `/duels/join/${token}`, participants: summary().participants.slice(0, 1) }), 201)
    case 'GET /api/duels/Q7KM2P': return send(summary({ status: 'proposed', you: { ...summary().you, canAccept: true, canDecline: true, confirm: state.inviteConfirm } }))
    case 'POST /api/duels/Q7KM2P/accept': return send(summary({ status: 'active', startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 21600000).toISOString(), provisional: true }))
    case 'POST /api/duels/Q7KM2P/decline': return send(summary({ status: 'cancelled', endedReason: 'declined' }))
    case 'POST /api/duels/Q7KM2P/cancel': return send(summary({ status: 'cancelled', endedReason: 'cancelled' }))
    case 'POST /api/duels/Q7KM2P/leave': return send(summary({ status: 'proposed' }))
    case 'POST /api/duels/Q7KM2P/forfeit': return send(summary({ status: 'completed', endedReason: 'forfeit', winner: 'alice' }))
    case `GET /api/duels/join/${token}`: return send({ id: randomUUID(), code: 'L0BBY1', status: 'proposed', mode: 'competitive', creator: 'kim', participants: [{ handle: 'kim', hero: null }], capacity: 4, openSeats: 3,
      durationSeconds: 86400, wagerGold: 150, potGold: 600, energyCost: 1, expiresAt: new Date(Date.now() + 3600000).toISOString(), duelUrl: '/duels/L0BBY1', you: { seated: false, canJoin: true, canLeave: false, confirm: state.lobbyConfirm } })
    case `POST /api/duels/join/${token}`: return send(summary({ code: 'L0BBY1', entry: 'open', capacity: 4 }))
    case 'GET /api/duels/energy': return send(energy)
    case 'POST /api/duels/energy/purchase': return send({ energy: { ...energy, available: 3, reserved: 0, nextAt: null, canPurchase: false }, gold: state.gold - 1000 })
    case 'GET /api/duels/link': return send(state.link)
    case 'PUT /api/duels/link': state.link = { ...state.link, ...payload, url: null }; return send(state.link)
    case 'GET /api/guild-duels/me': return send({ guild: { id: 'challenger-id', name: 'Owls', slug: 'owls' }, incoming: [], outgoing: [], rostering: [guildSummary()], active: [], history: [], record: { wins: 1, losses: 0, draws: 0 }, canDeclare: true, canRespond: true })
    case 'POST /api/guild-duels': return send(guildSummary({ status: 'proposed', teamSize: payload.teamSize, wagerGold: payload.wagerGold }), 201)
    case 'GET /api/guild-duels/G7KM2P': return send(guildSummary())
    case 'POST /api/guild-duels/G7KM2P/roster': return send(guildSummary({ sides: [{ ...guildSide('challenger', 'Owls'), roster: [{ handle: payload.handle, href: '', state: 'selected', hero: null, contribution: null, payoutGold: 0, lastSyncedAt: null, isYou: false }] }, guildSide('defender', 'Rivals')] }))
    case 'POST /api/guild-duels/G7KM2P/ready': return send(guildSummary({ status: 'active', endsAt: new Date(Date.now() + 7 * 86400000).toISOString() }))
    case 'POST /api/guild-duels/G7KM2P/accept': case 'POST /api/guild-duels/G7KM2P/decline': case 'POST /api/guild-duels/G7KM2P/cancel':
    case 'POST /api/guild-duels/G7KM2P/unready': case 'POST /api/guild-duels/G7KM2P/decline-selection': return send(guildSummary())
    case 'POST /api/duels/link/regenerate': return send({ ...state.link, url: '/duels/challenge/newtoken' })
  }
  send({ error: `No mock for ${key}` }, 404)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const dependencies = { directory, account: { id: accountId, plan: 'max', projects: join(directory, 'projects') }, noBrowser: true }
const duel = async args => {
  calls.length = 0
  const status = await run({ action: 'duel', appUrl: origin, sessionId: randomUUID(), ...(args ? { target: args } : {}) }, dependencies)
  return { status, result: status.duel, text: status.duel ? formatDuelReply(status.duel) : null, calls: calls.slice() }
}
const route = list => list.map(call => `${call.method} ${call.path}`)

try {
  // Without a token the command never reaches the app.
  const unpaired = await duel('')
  assert.equal(unpaired.result, undefined)
  assert.match(unpaired.status.error, /run \/guildbyte-connect before using \/duel/)
  assert.equal(unpaired.calls.length, 0)
  const db = openDatabase(directory)
  db.prepare('INSERT INTO accounts(id,plan,token) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token').run(accountId, 'max', bearer)
  db.close()

  // GET support: bearer auth, no body, no content type.
  const fetched = await get(origin, '/api/duels/energy', bearer)
  assert.deepEqual(fetched, energy)
  assert.deepEqual(calls.at(-1), { method: 'GET', path: '/api/duels/energy', body: undefined, auth: `Bearer ${bearer}`, type: undefined })

  // Dashboard.
  const dashboard = await duel('')
  assert.deepEqual(route(dashboard.calls), ['GET /api/duels/me'])
  assert.equal(dashboard.result.kind, 'dashboard')
  assert.equal(dashboard.status.connected, true, 'The full status still returns so the companion keeps rendering')
  assert.match(dashboard.text, /^DUELS · Energy 2\/3 \(1 reserved\) · next \+1 in 1h · 340 gold/)
  assert.match(dashboard.text, /\[REQ001\] @alice · 6h · wager 25 gold\n {7}\/duel accept REQ001 {3}\/duel decline REQ001/)
  assert(dashboard.text.endsWith(`Open full dashboard: ${origin}/duels`))
  assert(dashboard.calls.every(call => call.auth === `Bearer ${bearer}`))

  // Setup hint and view.
  const setup = await duel('@alice')
  assert.deepEqual(route(setup.calls), ['GET /api/duels/me'])
  assert.match(setup.text, /^Challenge @alice\n/)
  const view = await duel('view q7km2p')
  assert.deepEqual(route(view.calls), ['GET /api/duels/Q7KM2P'])
  assert.match(view.text, /\/duel accept Q7KM2P {3}\/duel decline Q7KM2P {3}\/duel cancel Q7KM2P/)
  assert(view.text.endsWith(`${origin}/duels/Q7KM2P`))

  // Challenges: exhibition, small wager, loss confirmation, all-in.
  const exhibition = await duel('@alice 1h 0')
  assert.deepEqual(route(exhibition.calls), ['GET /api/duels/me', 'POST /api/duels'])
  const sent = exhibition.calls[1].body
  assert.deepEqual({ ...sent, requestId: undefined }, { opponents: ['alice'], durationSeconds: 3600, wagerGold: 0, requestId: undefined })
  assert.match(sent.requestId, /^[a-f0-9-]{36}$/)
  assert.match(exhibition.text, /^Challenge \[Q7KM2P\] sent to @alice\.\n1h · exhibition\. Exhibition: no gold/)
  const small = await duel('@alice @bob 6h 25')
  assert.deepEqual(small.calls[1].body.opponents, ['alice', 'bob'])
  assert.equal(small.calls[1].body.wagerGold, 25)
  assert(!('confirmLoss' in small.calls[1].body) && !('confirmAllIn' in small.calls[1].body))
  const big = await duel('@alice 6h 250')
  assert.deepEqual(route(big.calls), ['GET /api/duels/me'], 'Over 100 gold, nothing is staked before confirmation')
  assert.equal(big.text, 'You can lose 250 gold.\nConfirm: /duel @alice 6h 250 confirm')
  const bigConfirmed = await duel('@alice 6h 250 confirm')
  assert.equal(bigConfirmed.calls[1].body.confirmLoss, 250)
  assert.equal(bigConfirmed.result.kind, 'created')
  const allIn = await duel('@alice 6h all confirm')
  assert.deepEqual(route(allIn.calls), ['GET /api/duels/me'])
  assert.equal(allIn.text, 'You can lose 340 gold.\nAll-in: 340 gold is your entire balance.\nConfirm: /duel @alice 6h 340 confirm allin', '`all` resolves to the server balance and needs allin')
  const allInConfirmed = await duel('@alice 6h all confirm allin')
  assert.deepEqual({ wagerGold: allInConfirmed.calls[1].body.wagerGold, confirmLoss: allInConfirmed.calls[1].body.confirmLoss, confirmAllIn: allInConfirmed.calls[1].body.confirmAllIn }, { wagerGold: 340, confirmLoss: 340, confirmAllIn: true })
  state.gold = 40
  const smallAllIn = await duel('@alice 6h 40')
  assert.equal(smallAllIn.text, 'All-in: 40 gold is your entire balance.\nConfirm: /duel @alice 6h 40 allin', 'A small full-balance wager still needs All-in')
  state.gold = 0
  assert.equal((await duel('@alice 6h all allin')).text, 'You have no gold to wager. Use 0 for an exhibition.')
  state.gold = 340

  // Lobby.
  const lobby = await duel('lobby 4 1d 10')
  assert.deepEqual(route(lobby.calls), ['GET /api/duels/me', 'POST /api/duels/lobbies'])
  assert.deepEqual({ ...lobby.calls[1].body, requestId: undefined }, { capacity: 4, durationSeconds: 86400, wagerGold: 10, requestId: undefined })
  assert.match(lobby.text, new RegExp(`Share this link: ${origin}/duels/join/${token}`))
  assert.equal((await duel('lobby 4 1d 150')).text, 'You can lose 150 gold.\nConfirm: /duel lobby 4 1d 150 confirm')

  // Accept reads the server's confirmation requirement first.
  const accepted = await duel('accept Q7KM2P')
  assert.deepEqual(route(accepted.calls), ['GET /api/duels/Q7KM2P', 'POST /api/duels/Q7KM2P/accept'])
  assert.deepEqual(accepted.calls[1].body, {})
  assert.match(accepted.text, /^Duel \[Q7KM2P\] started!/)
  state.inviteConfirm = confirm(250, true)
  const unconfirmed = await duel('accept Q7KM2P confirm')
  assert.deepEqual(route(unconfirmed.calls), ['GET /api/duels/Q7KM2P'], 'All-in still missing')
  assert.equal(unconfirmed.text, 'You can lose 250 gold\nConfirm: /duel accept Q7KM2P confirm allin')
  const acceptedAllIn = await duel('accept Q7KM2P confirm allin')
  assert.deepEqual(acceptedAllIn.calls[1].body, { confirmLoss: 250, confirmAllIn: true })
  state.inviteConfirm = confirm()

  // Decline, cancel, leave.
  for (const [verb, pattern] of [['decline', /^Declined \[Q7KM2P\]\. The challenge is cancelled/], ['cancel', /^Cancelled \[Q7KM2P\]/], ['leave', /^Left \[Q7KM2P\]/]]) {
    const reply = await duel(`${verb} Q7KM2P`)
    assert.deepEqual(route(reply.calls), [`POST /api/duels/Q7KM2P/${verb}`])
    assert.deepEqual(reply.calls[0].body, {})
    assert.match(reply.text, pattern)
    assert(reply.text.endsWith(`${origin}/duels/Q7KM2P`))
  }

  // Forfeit needs its typed confirmation and sends {confirm: true}.
  const forfeitPrompt = await duel('forfeit Q7KM2P')
  assert.equal(forfeitPrompt.calls.length, 0)
  assert.match(forfeitPrompt.text, /Confirm: \/duel forfeit Q7KM2P confirm$/)
  const forfeited = await duel('forfeit Q7KM2P confirm')
  assert.deepEqual(forfeited.calls.map(call => [call.method, call.path, call.body]), [['POST', '/api/duels/Q7KM2P/forfeit', { confirm: true }]])
  assert.match(forfeited.text, /@alice wins the 50 gold pot/)

  // Join: preview first, then join with the server's confirmation values.
  const preview = await duel(`join https://guildbyte.com/duels/join/${token}`)
  assert.deepEqual(route(preview.calls), [`GET /api/duels/join/${token}`], 'The token goes only to the configured app')
  assert.match(preview.text, new RegExp(`Join: /duel join ${token} confirm`))
  state.lobbyConfirm = confirm(150)
  const joined = await duel(`join ${token} confirm`)
  assert.deepEqual(route(joined.calls), [`GET /api/duels/join/${token}`, `POST /api/duels/join/${token}`])
  assert.deepEqual(joined.calls[1].body, { confirmLoss: 150 })
  assert.match(joined.text, /^Joined \[L0BBY1\]/)
  state.lobbyConfirm = confirm(150, true)
  const needsAllIn = await duel(`join ${token} confirm`)
  assert.equal(needsAllIn.calls.length, 1)
  assert.match(needsAllIn.text, /Join: \/duel join \S+ confirm allin/)
  state.lobbyConfirm = confirm()

  // Energy.
  const meter = await duel('energy')
  assert.deepEqual(route(meter.calls), ['GET /api/duels/energy'])
  assert.match(meter.text, /^Battle Energy 2\/3 \(1 reserved\) · next \+1 in 1h/)
  const buyPrompt = await duel('energy buy')
  assert.deepEqual(route(buyPrompt.calls), ['GET /api/duels/energy'])
  assert.match(buyPrompt.text, /Confirm: \/duel energy buy confirm/)
  state.gold = 1340
  const bought = await duel('energy buy confirm')
  assert.deepEqual(route(bought.calls), ['POST /api/duels/energy/purchase'])
  assert.equal(bought.calls[0].body.expectedGold, 1000)
  assert.match(bought.calls[0].body.requestId, /^[a-f0-9-]{36}$/)
  assert.match(bought.text, /^Bought 1 Battle Energy for 1,000 gold\. 340 gold left\./)

  state.gold = 340

  // Link.
  assert.deepEqual(route((await duel('link')).calls), ['GET /api/duels/link'])
  const off = await duel('link off')
  assert.deepEqual(off.calls.map(call => `${call.method} ${call.path} ${JSON.stringify(call.body ?? null)}`), ['GET /api/duels/link null', 'PUT /api/duels/link {"enabled":false,"durationSeconds":21600}'])
  assert.match(off.text, /^Challenge link: off · 6h/)
  const longer = await duel('link 1d')
  assert.deepEqual(longer.calls[1].body, { enabled: false, durationSeconds: 86400 }, 'Changing the duration keeps the enabled flag')
  const regenerated = await duel('link regenerate')
  assert.deepEqual(route(regenerated.calls), ['POST /api/duels/link/regenerate'])
  assert.match(regenerated.text, new RegExp(`Share: ${origin}/duels/challenge/newtoken`))

  // Guild duels: dashboard, declare (with the large-stake confirmation), roster, ready and answers.
  const guildBoard = await duel('guild')
  assert.deepEqual(route(guildBoard.calls), ['GET /api/guild-duels/me'])
  assert.match(guildBoard.text, /^GUILD DUELS · Owls · Record 1W 0L 0D[\s\S]*ROSTER LOBBIES\n\[G7KM2P\] vs Rivals/)
  const guildSetup = await duel('guild @rivals')
  assert.equal(guildSetup.result.kind, 'guildSetup')
  assert.deepEqual(route(guildSetup.calls), ['GET /api/guild-duels/me'])
  const bigDeclare = await duel('guild @rivals 3 150')
  assert.equal(bigDeclare.calls.length, 0, 'A stake over 100 asks before declaring')
  assert.match(bigDeclare.text, /Each selected member stakes 150 gold when they press Ready\.\nConfirm: \/duel guild @rivals 3 150 confirm/)
  const declared = await duel('guild @rivals 3 150 confirm')
  assert.deepEqual(declared.calls.map(call => [call.method, call.path, { ...call.body, requestId: typeof call.body.requestId }]), [['POST', '/api/guild-duels', { opponentGuild: 'rivals', teamSize: 3, wagerGold: 150, requestId: 'string' }]])
  assert.match(declared.text, /^Guild duel \[G7KM2P\] declared against Rivals · 3v3/)
  const added = await duel('guild roster G7KM2P add @Alice')
  assert.deepEqual(added.calls.map(call => [call.path, call.body]), [['/api/guild-duels/G7KM2P/roster', { action: 'add', handle: 'alice' }]])
  assert.match(added.text, /^Added @alice to the \[G7KM2P\] roster \(1\/3\)/)
  assert.equal((await duel('guild roster G7KM2P')).result.kind, 'guildRoster')
  const readyAsk = await duel('guild ready G7KM2P')
  assert.deepEqual(route(readyAsk.calls), ['GET /api/guild-duels/G7KM2P'], 'Ready reads the stake confirmation first')
  assert.equal(readyAsk.text, 'You can lose 150 gold\nConfirm: /duel guild ready G7KM2P confirm')
  const ready = await duel('guild ready G7KM2P confirm')
  assert.deepEqual(ready.calls[1], { method: 'POST', path: '/api/guild-duels/G7KM2P/ready', body: { confirmLoss: 150 }, auth: `Bearer ${bearer}`, type: 'application/json' })
  assert.match(ready.text, /^Guild duel \[G7KM2P\] started!/)
  for (const action of ['accept', 'decline', 'cancel', 'unready', 'decline-selection']) {
    const answered = await duel(`guild ${action} G7KM2P`)
    assert.deepEqual(answered.calls.map(call => `${call.method} ${call.path} ${JSON.stringify(call.body)}`), [`POST /api/guild-duels/G7KM2P/${action} {}`])
    assert.equal(answered.result.action, action)
  }
  state.failNext = { status: 404, body: {} }
  assert.equal((await duel('guild view G7KM2P')).text, 'Guildbyte returned 404: guild duel not found, you have no guild, or this server has no guild duels yet.')
  const guildUsage = await duel('guild ready')
  assert.equal(guildUsage.calls.length, 0, 'Usage errors never call the app')
  const bad = await duel('@alice 6h -1')
  assert.equal(bad.calls.length, 0)
  assert.equal(bad.result.kind, 'error')

  // Server errors keep their message and setup link.
  state.failNext = { status: 409, body: { error: 'Pair Guildbyte first', setupUrl: '/setup?next=/duels/Q7KM2P' } }
  const unpairedAccept = await duel('decline Q7KM2P')
  assert.deepEqual({ kind: unpairedAccept.result.kind, status: unpairedAccept.result.status }, { kind: 'error', status: 409 })
  assert.equal(unpairedAccept.text, `Guildbyte: Pair Guildbyte first\nFinish setup: ${origin}/setup?next=/duels/Q7KM2P`)
  state.failNext = { status: 402, body: { error: 'Not enough gold' } }
  assert.equal((await duel('cancel Q7KM2P')).text, 'Guildbyte: Not enough gold')
  state.failNext = { status: 503, body: { error: 'Wagered duels are not open yet' } }
  assert.equal((await duel('energy')).text, 'Guildbyte: Wagered duels are not open yet')
  state.failNext = { status: 404, body: {} }
  assert.equal((await duel('view Q7KM2P')).text, 'Guildbyte returned 404: duel not found, or this server has no Duels yet.')
  state.failNext = { status: 401, body: { error: 'Unauthorized' } }
  assert.match((await duel('')).text, /Run \/guildbyte-connect/)
  // A network failure is a worker error, not a duel result.
  state.offline = true
  const offline = await duel('')
  assert.equal(offline.result, undefined)
  assert.equal(offline.status.error, 'Guildbyte is offline. Activity remains saved locally.')
  state.offline = false

  console.log('Duel worker checks passed: GET support, dashboard, view, challenges, confirmations, all-in, lobby, accept, decline, cancel, leave, forfeit, join, energy, link, guild duels and errors')
} finally {
  await new Promise(resolve => server.close(resolve))
  rmSync(directory, { recursive: true, force: true })
}
