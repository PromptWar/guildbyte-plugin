import assert from 'node:assert/strict'
import { parseDuelCommand, formatDuelReply, formatUsage, joinToken, points, span, durationLabel, webLink, duelNoticeText, DUEL_USAGE } from '../scripts/duel-format.mjs'
import { DUEL_COMMAND, duelFailure, duelUsage } from '../hooks/duel-commands.mjs'

const now = Date.parse('2026-10-06T12:00:00Z')
const at = minutes => new Date(now + minutes * 60000).toISOString()
const origin = 'https://guildbyte.test'
const token = 'k3J9_x-QpL2mN8vR4tY6wZ1aB5cD7eF0gH2iJ4kL6mN'
const confirm = { required: false, lossGold: null, allIn: false, message: null }
const you = (extra = {}) => ({ seated: true, canAccept: false, canDecline: false, canJoin: false, canLeave: false, canCancel: false, canForfeit: false, energyCost: 0, confirm, ...extra })
const person = (handle, extra = {}) => ({ handle, href: `/players/${handle}`, seat: 0, role: 'invitee', state: 'joined', hero: null, score: null, rank: null, outcome: null, payoutGold: 0, lastSyncedAt: null, isYou: false, ...extra })
const duel = (extra = {}) => ({ id: '0b6f1d2c-3a4b-4c5d-8e9f-0a1b2c3d4e5f', code: 'Q7KM2P', url: '/duels/Q7KM2P', rulesVersion: 2, mode: 'competitive', entry: 'named', status: 'active',
  endedReason: null, invalidatedReason: null, capacity: 2, durationSeconds: 21600, wagerGold: 25, potGold: 50, createdAt: at(-60), expiresAt: null, startsAt: at(-226), endsAt: at(134),
  settlesAt: at(149), settledAt: null, provisional: true, creator: 'me', winner: null, participants: [], you: you(), ...extra })

// ---------- Parser ----------
const parse = parseDuelCommand
assert.deepEqual(parse(''), { kind: 'dashboard' })
assert.deepEqual(parse('   '), { kind: 'dashboard' })
assert.deepEqual(parse('view q7km2p'), { kind: 'view', id: 'Q7KM2P' }, 'Codes are case-insensitive')
assert.deepEqual(parse('view 0B6F1D2C-3A4B-4C5D-8E9F-0A1B2C3D4E5F'), { kind: 'view', id: '0b6f1d2c-3a4b-4c5d-8e9f-0a1b2c3d4e5f' }, 'Uuids work too')
assert.equal(parse('view Q7KM2I').kind, 'usage', 'Crockford base32 excludes I, L, O and U')
assert.equal(parse('view').kind, 'usage')
assert.deepEqual(parse('accept Q7KM2P'), { kind: 'accept', id: 'Q7KM2P', confirm: false, allIn: false })
assert.deepEqual(parse('ACCEPT Q7KM2P confirm allin'), { kind: 'accept', id: 'Q7KM2P', confirm: true, allIn: true })
for (const verb of ['decline', 'cancel', 'leave']) assert.deepEqual(parse(`${verb} Q7KM2P`), { kind: verb, id: 'Q7KM2P' })
assert.equal(parse('decline Q7KM2P confirm').kind, 'usage', 'Only accept and forfeit take confirmations')
assert.deepEqual(parse('forfeit Q7KM2P'), { kind: 'forfeit', id: 'Q7KM2P', confirm: false })
assert.deepEqual(parse('forfeit Q7KM2P confirm'), { kind: 'forfeit', id: 'Q7KM2P', confirm: true })
assert.equal(parse('forfeit Q7KM2P allin').kind, 'usage')

assert.deepEqual(parse('@Alice 6h 25'), { kind: 'challenge', handles: ['alice'], durationSeconds: 21600, wager: 25, confirm: false, allIn: false, raw: '@alice 6h 25' })
assert.deepEqual(parse('alice 1h 0'), { kind: 'challenge', handles: ['alice'], durationSeconds: 3600, wager: 0, confirm: false, allIn: false, raw: '@alice 1h 0' }, 'The @ is optional')
assert.deepEqual(parse('@a_1 @bob @cara 1d 10 confirm'), { kind: 'challenge', handles: ['a_1', 'bob', 'cara'], durationSeconds: 86400, wager: 10, confirm: true, allIn: false, raw: '@a_1 @bob @cara 1d 10' })
assert.deepEqual(parse('@bob @BOB 7d 5').handles, ['bob'], 'Duplicate handles collapse')
assert.deepEqual(parse('@ayla 3d all confirm allin'), { kind: 'challenge', handles: ['ayla'], durationSeconds: 259200, wager: 'all', confirm: true, allIn: true, raw: '@ayla 3d all' })
assert.deepEqual(parse('@alice'), { kind: 'setup', handles: ['alice'] }, 'A bare handle opens the setup hint')
assert.deepEqual(parse('@alice @bob'), { kind: 'setup', handles: ['alice', 'bob'] })
assert.match(parse('@alice 6h').error, /\/duel @alice <1h\|6h\|1d\|3d\|7d> <wager>/, 'A wager is required with a duration')
assert.equal(parse('@alice 2h 25').error, 'Durations are 1h, 6h, 1d, 3d and 7d.', 'Only the five durations are allowed')
assert.equal(parse('@alice 6h -5').kind, 'usage')
assert.equal(parse('@alice 6h 2.5').kind, 'usage')
assert.equal(parse('@alice 6h 200000001').kind, 'usage', 'Wagers stay under the technical ceiling')
assert.equal(parse('@alice 6h 25 extra').kind, 'usage')
assert.equal(parse('@al 6h 25').kind, 'usage', 'Handles are 3 to 24 characters')
assert.match(parse('6h 25').error, /Name a player first/)
assert.match(parse('@a1x @b2x @c3x @d4x @e5x @f6x @g7x @h8x 1h 0').error, /at most 8 players/)
assert.equal(parse('@a1x @b2x @c3x @d4x @e5x @f6x @g7x 1h 0').handles.length, 7)
assert.match(parse('hello! 6h 25').error, /not a Guildbyte handle/)

assert.deepEqual(parse('lobby 4 1d 10'), { kind: 'lobby', capacity: 4, durationSeconds: 86400, wager: 10, confirm: false, allIn: false, raw: 'lobby 4 1d 10' })
assert.equal(parse('lobby 9 1d 10').kind, 'usage')
assert.equal(parse('lobby 1 1d 10').kind, 'usage')
assert.equal(parse('lobby 4 1d').kind, 'usage')
assert.deepEqual(parse(`join https://guildbyte.com/duels/join/${token}`), { kind: 'join', token, confirm: false, allIn: false })
assert.deepEqual(parse(`join ${token} confirm`), { kind: 'join', token, confirm: true, allIn: false }, 'Tokens keep their case')
assert.equal(joinToken('https://guildbyte.com/duels/other/abcdefghijklmnopqrstu'), null)
assert.equal(joinToken('short'), null)
assert.equal(parse('join').kind, 'usage')
assert.deepEqual(parse('energy'), { kind: 'energy' })
assert.deepEqual(parse('energy buy'), { kind: 'energyBuy', confirm: false })
assert.deepEqual(parse('energy buy confirm'), { kind: 'energyBuy', confirm: true })
assert.equal(parse('energy sell').kind, 'usage')
assert.deepEqual(parse('link'), { kind: 'link' })
assert.deepEqual(parse('link on'), { kind: 'linkUpdate', enabled: true })
assert.deepEqual(parse('link off'), { kind: 'linkUpdate', enabled: false })
assert.deepEqual(parse('link 6h'), { kind: 'linkUpdate', durationSeconds: 21600 })
assert.deepEqual(parse('link regenerate'), { kind: 'linkRegenerate' })
assert.equal(parse('link 2h').kind, 'usage')
assert.deepEqual(parse('guild'), { kind: 'guildDashboard' })
assert.deepEqual(parse('guild @rivals'), { kind: 'guildSetup', slug: 'rivals' })
assert.deepEqual(parse('guild @Rivals 5 25'), { kind: 'guildChallenge', slug: 'rivals', teamSize: 5, wager: 25, confirm: false, raw: 'guild @rivals 5 25' })
assert.deepEqual(parse('guild night-owls 10 150 confirm'), { kind: 'guildChallenge', slug: 'night-owls', teamSize: 10, wager: 150, confirm: true, raw: 'guild @night-owls 10 150' })
assert.deepEqual(parse('guild @view'), { kind: 'guildSetup', slug: 'view' }, 'An @ slug never reads as a subcommand')
for (const [word, kind] of [['view', 'guildView'], ['accept', 'guildAccept'], ['decline', 'guildDecline'], ['cancel', 'guildCancel'], ['unready', 'guildUnready'], ['decline-selection', 'guildDeclineSelection']]) {
  assert.deepEqual(parse(`guild ${word} q7km2p`), { kind, id: 'Q7KM2P' })
  assert.equal(parse(`guild ${word} q7km2p confirm`).kind, 'usage')
}
assert.deepEqual(parse('guild ready Q7KM2P confirm allin'), { kind: 'guildReady', id: 'Q7KM2P', confirm: true, allIn: true })
assert.deepEqual(parse('guild roster Q7KM2P'), { kind: 'guildRosterView', id: 'Q7KM2P' })
assert.deepEqual(parse('guild roster Q7KM2P add @Alice'), { kind: 'guildRoster', id: 'Q7KM2P', action: 'add', handle: 'alice' })
assert.deepEqual(parse('guild roster Q7KM2P remove bob_1'), { kind: 'guildRoster', id: 'Q7KM2P', action: 'remove', handle: 'bob_1' })
for (const bad of ['guild accept', 'guild roster Q7KM2P kick @a1x', 'guild roster Q7KM2P add', 'guild @rivals 1 25', 'guild @rivals 11 25', 'guild @rivals 5 all', 'guild @rivals 5 25 allin', 'guild @x', 'guild @rivals 5']) {
  assert.equal(parse(bad).kind, 'usage', bad)
}
assert.equal(formatUsage(parse('help')), DUEL_USAGE)

// ---------- Helpers ----------
assert.equal(points('1240.0000'), '1,240')
assert.equal(points('980.2500'), '980.3')
assert.equal(points('0.0000'), '0')
assert.equal(points(null), '—')
assert.equal(span(134 * 60000), '2h 14m')
assert.equal(span(4 * 3600000), '4h')
assert.equal(span(30000), '<1m')
assert.equal(span(26 * 3600000), '1d 2h')
assert.equal(durationLabel(604800), '7d')
assert.equal(webLink(origin, '/duels/Q7KM2P'), `${origin}/duels/Q7KM2P`)
assert.equal(webLink(origin, 'https://guildbyte.com/duels'), 'https://guildbyte.com/duels')
assert.equal(webLink(origin, '//evil.example/x'), `${origin}/duels`, 'Protocol-relative links fall back')
assert.equal(webLink(origin, 'javascript:alert(1)'), `${origin}/duels`)
assert.equal(webLink(origin, '/duels\x1b[31m'), `${origin}/duels`, 'Terminal escapes never print')
assert.equal(webLink(origin, 'ftp://x', null), null)

// ---------- Dashboard (Appendix A.2) ----------
const dashboard = {
  energy: { available: 2, reserved: 0, max: 3, nextAt: at(240), price: 1000, canPurchase: true }, gold: 340, wagersEnabled: true,
  requests: [duel({ status: 'proposed', expiresAt: at(600), participants: [person('alice', { role: 'creator' }), person('me', { isYou: true, state: 'invited' })],
    you: you({ seated: false, canAccept: true, canDecline: true, energyCost: 1 }) })],
  sent: [duel({ code: 'S3NT00', status: 'proposed', mode: 'exhibition', wagerGold: 0, potGold: 0, expiresAt: at(1200), participants: [person('me', { isYou: true, role: 'creator' }), person('zed', { state: 'invited' })] })],
  lobbies: [duel({ code: 'L0BBY1', status: 'proposed', entry: 'open', capacity: 4, wagerGold: 10, durationSeconds: 86400, expiresAt: at(1080),
    participants: [person('me', { isYou: true, role: 'creator' }), person('kim', { role: 'joiner' }), person('lee', { role: 'joiner' })] })],
  active: [
    duel({ code: '8PDA00', participants: [person('me', { isYou: true, score: '1240.0000', lastSyncedAt: at(-1) }), person('bob', { score: '980.0000' })] }),
    duel({ code: 'RX4200', capacity: 5, endsAt: at(1080), participants: [person('alice', { score: '1540.0000', rank: 1 }), person('bob', { score: '1210.0000', rank: 2 }), person('me', { isYou: true, score: '720.0000', rank: 3 }), person('cy'), person('di')] }),
  ],
  exhibitions: { activeCount: 0, items: [], nextCursor: null },
  recent: [
    duel({ status: 'completed', wagerGold: 20, potGold: 40, provisional: false, participants: [person('me', { isYou: true, score: '1820.0000', outcome: 'won', payoutGold: 40 }), person('chris', { score: '1440.0000', outcome: 'lost' })] }),
    duel({ status: 'draw', wagerGold: 10, potGold: 20, provisional: false, participants: [person('me', { isYou: true, score: '5.0000', outcome: 'draw' }), person('sam', { score: '5.0000', outcome: 'draw' })] }),
  ],
  guild: { pending: [], active: [] }, record: { wins: 4, losses: 2, draws: 1, winRate: 0.5714, currentStreak: 1 }, badge: 1, webUrl: '/duels',
}
const text = formatDuelReply({ kind: 'dashboard', dashboard, origin }, now)
const expected = [
  'DUELS · Energy 2/3 · next +1 in 4h · 340 gold',
  '', 'REQUESTS',
  '[Q7KM2P] @alice · 6h · wager 25 gold',
  '       /duel accept Q7KM2P   /duel decline Q7KM2P',
  '', 'SENT',
  '[S3NT00] vs @zed · 6h · exhibition · expires in 20h',
  '       /duel cancel S3NT00',
  '', 'LOBBIES',
  '[L0BBY1] FFA · 4 players · 3/4 · 1d · wager 10 gold · expires in 18h',
  '       /duel view L0BBY1',
  '', 'ACTIVE',
  '[8PDA00] vs @bob · 2h 14m left',
  '       You 1,240 · @bob 980 · synced 1m ago',
  '[RX4200] FFA · 5 players · 18h left',
  '       #1 @alice 1,540 · #2 @bob 1,210 · #3 You 720 · #4 @cy —',
  '       /duel view RX4200',
  '', 'RECENT',
  'Won vs @chris · +20 gold · 1,820–1,440',
  'Draw vs @sam · 10 gold refunded · 5–5',
  '', 'Record 4W 2L 1D · 57% · streak 1',
  '', `Open full dashboard: ${origin}/duels`,
].join('\n')
assert.equal(text, expected)
const empty = formatDuelReply({ kind: 'dashboard', origin, dashboard: { ...dashboard, wagersEnabled: false, requests: [], sent: [], lobbies: [], active: [], recent: [], record: { wins: 0, losses: 0, draws: 0, winRate: null, currentStreak: 0 } } }, now)
assert.match(empty, /Wagered duels are not open yet: exhibitions only\./)
assert.match(empty, /No requests or active duels\. Challenge someone: \/duel @handle 6h 0/)
assert(!empty.includes('Record'))
assert.equal(formatDuelReply({ kind: 'dashboard', origin, dashboard: {} }, now).split('\n')[0], 'DUELS · Energy ?/3 · 0 gold', 'Missing fields degrade instead of throwing')

// ---------- View ----------
const view = formatDuelReply({ kind: 'view', origin, duel: duel({ participants: [person('me', { isYou: true, score: '1240.0000', rank: 1, lastSyncedAt: at(-1), hero: { characterId: null, bustUrl: null, archetype: 'Mage', rarity: 'rare' } }), person('bob', { score: '980.0000', rank: 2, lastSyncedAt: at(-3) })], you: you({ canForfeit: true }) }) }, now)
assert.equal(view, [
  'DUEL [Q7KM2P] · Competitive · Active · 2h 14m left',
  'vs @bob · 6h · 25 gold each · pot 50 gold',
  '',
  '#1 You (@me) · 1,240 · synced 1m ago · Mage rare',
  '#2 @bob · 980 · synced 3m ago',
  '', 'Provisional scores. Results settle 15 minutes after the timer ends (upload grace).',
  '', '/duel forfeit Q7KM2P',
  '', `${origin}/duels/Q7KM2P`,
].join('\n'))
const invite = formatDuelReply({ kind: 'view', origin, duel: duel({ status: 'proposed', expiresAt: at(600), provisional: false, participants: [person('alice', { role: 'creator' }), person('me', { isYou: true, state: 'invited' })],
  you: you({ canAccept: true, canDecline: true, confirm: { required: true, lossGold: 250, allIn: true, message: 'You can lose 250 gold' } }) }) }, now)
assert.match(invite, /Waiting for players · expires in 10h/)
assert.match(invite, / {2}@alice · ✓ joined\n {2}You \(@me\) · ○ invited/)
assert.match(invite, /\/duel accept Q7KM2P confirm allin {3}\/duel decline Q7KM2P/)
const settled = formatDuelReply({ kind: 'view', origin, duel: duel({ status: 'invalidated', invalidatedReason: 'Server-wide ingestion outage', provisional: false, settledAt: at(-30),
  participants: [person('me', { isYou: true, score: '3.0000', outcome: 'void' })] }) }, now)
assert.match(settled, /Invalidated: Server-wide ingestion outage\. Gold and energy were refunded\./)
assert.match(settled, /settled 30m ago/)
const hostile = formatDuelReply({ kind: 'view', origin, duel: duel({ participants: [person('\x1b]8;;evil\x07me', { isYou: true })], url: 'https://x.test/\x1b' }) }, now)
assert(!/[\x00-\x08\x0b-\x1f]/.test(hostile), 'Server strings cannot inject terminal escapes')
assert(hostile.endsWith(`${origin}/duels`))

// ---------- Mutations, confirmations, previews ----------
const created = formatDuelReply({ kind: 'created', origin, duel: duel({ status: 'proposed', expiresAt: at(1440), participants: [person('me', { isYou: true, role: 'creator' }), person('alice', { state: 'invited' })] }) }, now)
assert.equal(created, ['Challenge [Q7KM2P] sent to @alice.', '6h · wager 25 gold. Competitive · 1 energy and 25 gold reserved until it starts.',
  'Expires in 1d if not accepted. Withdraw: /duel cancel Q7KM2P', '', `${origin}/duels/Q7KM2P`].join('\n'))
const ffa = formatDuelReply({ kind: 'created', origin, duel: duel({ status: 'proposed', capacity: 3, mode: 'exhibition', wagerGold: 0, participants: [person('me', { isYou: true, role: 'creator' }), person('a1x', { state: 'invited' }), person('b2x', { state: 'invited' })] }) }, now)
assert.match(ffa, /^Free-for-all invitation \[Q7KM2P\] sent to @a1x, @b2x\.\n6h · exhibition\. Exhibition: no gold, no energy, no records\./)
const lobby = formatDuelReply({ kind: 'lobby', origin, duel: duel({ status: 'proposed', entry: 'open', capacity: 4, expiresAt: at(1440), joinUrl: `https://guildbyte.com/duels/join/${token}`, participants: [person('me', { isYou: true, role: 'creator' })] }) }, now)
assert.match(lobby, /Lobby \[Q7KM2P\] open · 1\/4 seats · 6h · wager 25 gold\./)
assert.match(lobby, new RegExp(`Share this link: https://guildbyte.com/duels/join/${token}`))
assert.match(formatDuelReply({ kind: 'accepted', origin, duel: duel({ participants: [person('me', { isYou: true }), person('alice')] }) }, now), /^Duel \[Q7KM2P\] started! vs @alice · ends in 2h 14m\.\nEnergy spent · 25 gold staked · pot 50 gold\./)
assert.match(formatDuelReply({ kind: 'joined', origin, duel: duel({ status: 'proposed', entry: 'open', capacity: 4, participants: [person('kim', { role: 'creator' }), person('me', { isYou: true })] }) }, now), /^Joined \[Q7KM2P\] FFA · 4 players\. Starts when 2 more players join\./)
assert.match(formatDuelReply({ kind: 'declined', origin, duel: duel({ status: 'cancelled' }) }, now), /^Declined \[Q7KM2P\]\. The challenge is cancelled; every stake is refunded\./)
assert.match(formatDuelReply({ kind: 'cancelled', origin, duel: duel({ status: 'cancelled' }) }, now), /^Cancelled \[Q7KM2P\]\. Gold and energy are back for everyone\./)
assert.match(formatDuelReply({ kind: 'left', origin, duel: duel({ status: 'proposed' }) }, now), /^Left \[Q7KM2P\]\. Your gold and energy are back\./)
assert.match(formatDuelReply({ kind: 'forfeited', origin, duel: duel({ status: 'completed', winner: 'bob' }) }, now), /^Forfeited \[Q7KM2P\]\. Your stake stays in the pot\.\n@bob wins the 50 gold pot\./)
assert.equal(formatDuelReply({ kind: 'confirm', action: 'challenge', command: '@alice 6h 250', wagerGold: 250, lossGold: 250, allIn: false, origin }), 'You can lose 250 gold.\nConfirm: /duel @alice 6h 250 confirm')
assert.equal(formatDuelReply({ kind: 'confirm', action: 'challenge', command: '@alice 6h 40', wagerGold: 40, lossGold: null, allIn: true, origin }), 'All-in: 40 gold is your entire balance.\nConfirm: /duel @alice 6h 40 allin')
assert.equal(formatDuelReply({ kind: 'confirm', action: 'accept', command: 'accept Q7KM2P', lossGold: 250, allIn: false, message: 'You can lose 250 gold', origin }), 'You can lose 250 gold\nConfirm: /duel accept Q7KM2P confirm')
assert.match(formatDuelReply({ kind: 'confirm', action: 'forfeit', id: 'Q7KM2P', origin }), /defeat.*\nConfirm: \/duel forfeit Q7KM2P confirm$/)
const preview = { id: 'x', code: 'L0BBY1', status: 'proposed', mode: 'competitive', creator: 'kim', participants: [{ handle: 'kim', hero: null }, { handle: 'lee', hero: null }], capacity: 6, openSeats: 4,
  durationSeconds: 86400, wagerGold: 25, potGold: 150, energyCost: 1, expiresAt: at(1080), duelUrl: '/duels/L0BBY1', you: { seated: false, canJoin: true, canLeave: false, confirm } }
assert.equal(formatDuelReply({ kind: 'preview', token, preview, origin }, now), ['FREE-FOR-ALL LOBBY [L0BBY1] · 2/6 players · expires in 18h', '1d · 25 gold each · 150 gold pot · 1 energy',
  '@kim, @lee joined · 4 open seats', '', `Join: /duel join ${token} confirm`, '', `${origin}/duels/L0BBY1`].join('\n'))
assert.match(formatDuelReply({ kind: 'preview', token, preview: { ...preview, status: 'active' }, origin }, now), /^This lobby already started\.\n\nhttps:\/\/guildbyte\.test\/duels\/L0BBY1$/)
assert.match(formatDuelReply({ kind: 'preview', token, preview: { ...preview, you: { ...preview.you, confirm: { required: true, lossGold: null, allIn: true, message: 'All-in: this is your whole balance' } } }, origin }, now), /All-in: this is your whole balance\n\nJoin: \/duel join \S+ confirm allin/)

// ---------- Energy, link, guild, errors ----------
const energy = { available: 1, reserved: 1, max: 3, nextAt: at(300), price: 1000, canPurchase: true }
assert.equal(formatDuelReply({ kind: 'energy', energy, origin }, now), ['Battle Energy 1/3 (1 reserved) · next +1 in 5h', 'Wagered player duels use 1 energy per participant. One regenerates every 8 hours.',
  'Buy 1 for 1,000 gold: /duel energy buy', '', `${origin}/duels`].join('\n'))
assert.match(formatDuelReply({ kind: 'energyConfirm', energy, origin }, now), /Buy 1 energy for 1,000 gold\? Confirm: \/duel energy buy confirm/)
assert.match(formatDuelReply({ kind: 'energyConfirm', energy: { ...energy, available: 3, reserved: 0, nextAt: null, canPurchase: false }, origin }, now), /You cannot buy energy now/)
assert.match(formatDuelReply({ kind: 'energyBought', result: { energy: { ...energy, available: 2 }, gold: 1340 }, origin }, now), /^Bought 1 Battle Energy for 1,000 gold\. 1,340 gold left\.\nBattle Energy 2\/3/)
assert.match(formatDuelReply({ kind: 'link', link: { url: null, enabled: true, durationSeconds: 21600, activeCount: 3 }, origin }), /Challenge link: on · 6h exhibitions · 3 active\nThe link is shown only when it is created/)
assert.match(formatDuelReply({ kind: 'link', regenerated: true, link: { url: '/duels/challenge/abc', enabled: true, durationSeconds: 3600, activeCount: 0 }, origin }), /previous link no longer works[\s\S]*Share: https:\/\/guildbyte\.test\/duels\/challenge\/abc/)

// ---------- Guild duels ----------
const member = (handle, state, extra = {}) => ({ handle, href: `/players/${handle}`, state, hero: null, contribution: null, payoutGold: 0, lastSyncedAt: null, isYou: false, ...extra })
const side = (which, name, extra = {}) => ({ side: which, guild: { id: `${which}-id`, name, slug: name.toLowerCase().replace(/ /g, '-') }, total: null, outcome: null, readyCount: 0, roster: [], ...extra })
const guildYou = (extra = {}) => ({ side: 'challenger', canAccept: false, canDecline: false, canCancel: false, canEditRoster: false, canReady: false, canUnready: false, canDeclineSelection: false, confirm, ...extra })
const guildDuel = (extra = {}) => ({ id: '1b6f1d2c-3a4b-4c5d-8e9f-0a1b2c3d4e5f', code: 'G7KM2P', url: '/duels/guild/G7KM2P', rulesVersion: 2, mode: 'competitive', status: 'rostering', endedReason: null, invalidatedReason: null,
  teamSize: 3, durationSeconds: 604800, wagerGold: 25, potGold: 150, proposedAt: at(-60), expiresAt: at(6 * 1440), startsAt: null, endsAt: null, settlesAt: null, settledAt: null, provisional: false, winner: null,
  sides: [side('challenger', 'Night Owls', { readyCount: 1, roster: [member('me', 'ready', { isYou: true }), member('bob', 'selected'), member('old', 'removed')] }), side('defender', 'Rivals', { readyCount: 2 })],
  you: guildYou({ canEditRoster: true, canUnready: true, canCancel: true }), ...extra })
const guildDashboard = { guild: { id: 'challenger-id', name: 'Night Owls', slug: 'night-owls' }, record: { wins: 3, losses: 1, draws: 0 }, canDeclare: true, canRespond: true,
  incoming: [guildDuel({ code: 'INC001', status: 'proposed', sides: [side('challenger', 'Rivals'), side('defender', 'Night Owls')], you: guildYou({ side: 'defender', canAccept: true, canDecline: true }) })],
  outgoing: [], rostering: [guildDuel()],
  active: [guildDuel({ code: 'ACT001', status: 'active', endsAt: at(2 * 1440 + 120), provisional: true, you: guildYou(), sides: [side('challenger', 'Night Owls', { total: '12400.0000' }), side('defender', 'Rivals', { total: '11980.5000' })] })],
  history: [guildDuel({ code: 'OLD001', status: 'completed', you: guildYou(), sides: [side('challenger', 'Night Owls', { total: '13200.0000', outcome: 'won' }), side('defender', 'Rivals', { total: '12100.0000', outcome: 'lost' })] })] }
assert.equal(formatDuelReply({ kind: 'guildDashboard', dashboard: guildDashboard, origin }, now), [
  'GUILD DUELS · Night Owls · Record 3W 1L 0D', '',
  'INCOMING', '[INC001] vs Rivals · 3v3 · 25 gold each · expires in 6d', '       /duel guild accept INC001   /duel guild decline INC001', '',
  'ROSTER LOBBIES', '[G7KM2P] vs Rivals · 3v3 · 25 gold each · ready 1/3 — 2/3 · expires in 6d', '       /duel guild roster G7KM2P   /duel guild unready G7KM2P   /duel guild cancel G7KM2P', '',
  'ACTIVE', '[ACT001] vs Rivals · 3v3 · 2d 2h left', '       Night Owls 12,400 · Rivals 11,980.5', '       /duel guild view ACT001', '',
  'HISTORY', 'Won vs Rivals · +25 gold each · 13,200–12,100', '',
  'Declare one: /duel guild @guild-slug 5 25', '', `Open guild duels: ${origin}/duels?tab=guild`].join('\n'))
const guildView = formatDuelReply({ kind: 'guildView', duel: guildDuel(), origin }, now)
assert.match(guildView, /^GUILD DUEL \[G7KM2P\] · Competitive · Picking rosters · expires in 6d\nNight Owls vs Rivals · 3v3 · 7d · 25 gold each · pot 150 gold\n\nNight Owls · ready 1\/3\n  You \(@me\) · ✓ ready\n  @bob · ○ selected\n\nRivals · ready 2\/3\n  No members selected yet\./)
assert.doesNotMatch(guildView, /@old/, 'Removed members are hidden')
assert.match(guildView, /\/duel guild roster G7KM2P add @handle   \/duel guild unready G7KM2P   \/duel guild cancel G7KM2P\n\nhttps:\/\/guildbyte\.test\/duels\/guild\/G7KM2P$/)
const liveGuild = formatDuelReply({ kind: 'guildView', duel: guildDashboard.active[0], origin }, now)
assert.match(liveGuild, /Night Owls · total 12,400\n/)
assert.match(formatDuelReply({ kind: 'guildUpdated', action: 'declare', duel: guildDuel({ status: 'proposed' }), origin }, now), /^Guild duel \[G7KM2P\] declared against Rivals · 3v3 · 7 days · 25 gold each\.\nTheir owner or a responder has 6d to accept\./)
assert.match(formatDuelReply({ kind: 'guildUpdated', action: 'add', handle: 'bob', duel: guildDuel(), origin }, now), /^Added @bob to the \[G7KM2P\] roster \(2\/3\)\. They confirm with \/duel guild ready G7KM2P/)
assert.match(formatDuelReply({ kind: 'guildUpdated', action: 'ready', duel: guildDuel(), origin }, now), /^Ready for \[G7KM2P\] · 25 gold staked\. Ready 1\/3 — 2\/3\./)
assert.match(formatDuelReply({ kind: 'guildUpdated', action: 'ready', duel: guildDuel({ status: 'active', endsAt: at(7 * 1440) }), origin }, now), /^Guild duel \[G7KM2P\] started! Night Owls vs Rivals · ends in 7d\./)
assert.match(formatDuelReply({ kind: 'guildUpdated', action: 'cancel', duel: guildDuel({ status: 'cancelled' }), origin }, now), /^Cancelled guild duel \[G7KM2P\]\. Every reserved stake is refunded\./)
assert.match(formatDuelReply({ kind: 'guildSetup', slug: 'rivals', dashboard: guildDashboard, origin }), /^Guild duel: Night Owls vs @rivals · 7 days\n[\s\S]*Send: \/duel guild @rivals 5 25/)
assert.match(formatDuelReply({ kind: 'guildSetup', slug: 'rivals', dashboard: { ...guildDashboard, canDeclare: false }, origin }), /Only your guild owner or the Declare duels role/)
assert.equal(formatDuelReply({ kind: 'confirm', action: 'guildReady', command: 'guild ready G7KM2P', lossGold: 150, allIn: false, message: null, origin }), 'You can lose 150 gold.\nConfirm: /duel guild ready G7KM2P confirm')

// ---------- Request notices ----------
const request = (extra = {}) => ({ request: { id: 'r1', code: 'Q7KM2P', kind: 'duel', from: 'alice', durationSeconds: 21600, wagerGold: 25, expiresAt: at(1380), webUrl: `${origin}/duels/Q7KM2P`, ...extra } })
assert.equal(duelNoticeText(request(), now), `⚔ @alice challenges you · 6h · 25 gold wager · expires in 23h. /duel accept Q7KM2P · /duel decline Q7KM2P · ${origin}/duels/Q7KM2P`)
assert.match(duelNoticeText(request({ kind: 'lobby', wagerGold: 0, expiresAt: null }), now), /^⚔ @alice invites you to a free-for-all · 6h · exhibition\. \/duel accept Q7KM2P/)
assert.match(duelNoticeText(request({ kind: 'guild_challenge', from: 'Rivals', durationSeconds: 604800 }), now), /^⚔ Rivals challenges your guild · 7 days · 25 gold each · expires in 23h\. \/duel guild accept Q7KM2P · \/duel guild decline Q7KM2P/)
assert.match(duelNoticeText(request({ kind: 'guild_roster', from: 'Rivals', code: null, id: 'abc' }), now), /picked for the guild duel against Rivals[\s\S]*\/duel guild ready abc · \/duel guild decline-selection abc/)
assert.equal(formatDuelReply({ kind: 'error', error: 'Guildbyte: Pair Guildbyte first', setupUrl: '/setup?next=/duels/Q7KM2P', origin }), `Guildbyte: Pair Guildbyte first\nFinish setup: ${origin}/setup?next=/duels/Q7KM2P`)
assert.match(formatDuelReply({ kind: 'setup', handles: ['alice'], origin, dashboard }, now), /^Challenge @alice\nEnergy 2\/3 · next \+1 in 4h · 340 gold\nDuration {2}1h 6h 1d 3d 7d\n[\s\S]*Send: \/duel @alice 6h 25/)
assert.match(formatDuelReply({ kind: 'setup', handles: ['a1x', 'b2x'], origin, dashboard: { ...dashboard, wagersEnabled: false } }, now), /^Free-for-all with @a1x @b2x · 3 players[\s\S]*wagers are not open yet[\s\S]*Send: \/duel @a1x @b2x 6h 0/)

// ---------- Command routing ----------
assert.equal(DUEL_COMMAND.name, 'duel')
assert.equal(duelUsage('@alice 2h 5'), 'Durations are 1h, 6h, 1d, 3d and 7d.', 'Usage errors answer without the worker')
assert.equal(duelUsage('help'), DUEL_USAGE)
assert.equal(duelUsage('  guild  '), null)
assert.equal(duelUsage('guild roster Q7KM2P add @alice'), null)
assert.match(duelUsage('guild ready'), /^Use \/duel guild ready <code>/)
assert.match(duelFailure(undefined), /syncing/)
assert.match(duelFailure({ error: 'Guildbyte is offline. Activity remains saved locally.' }), /offline/)

console.log('Duel format checks passed: parser, dashboard, view, mutations, confirmations, previews, energy, link, errors, guild commands, request notices and command routing')
