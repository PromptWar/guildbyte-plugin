// Typed /duel commands: parsing and text rendering. The app is authoritative for
// every rule (eligibility, energy, payouts, allowed actions); this module only
// reads its responses. Pure JavaScript: the worker (Node) and the mod (no Node)
// both import it.

export const DURATIONS = { '1h': 3600, '6h': 21600, '1d': 86400, '3d': 259200, '7d': 604800 }
// Rule 13 thresholds, mirrored only to prompt before the request; the server enforces them too.
export const CONFIRM_ABOVE = 100
export const ENERGY_PRICE = 1000
export const MAX_WAGER = 200000000
export const MAX_OPPONENTS = 7

const HANDLE = /^@?[a-z0-9_]{3,24}$/i
const GUILD_SLUG = /^@?[a-z0-9-]{3,32}$/i
const CODE = /^[0-9A-HJKMNP-TV-Z]{6}$/
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/
const FLAGS = ['confirm', 'allin']

export const DUEL_USAGE = [
  'Duels',
  '  /duel                              dashboard: requests, active duels, energy',
  '  /duel @alice 6h 25                 challenge (0 gold = exhibition)',
  '  /duel @a @b @c 1d 10               free-for-all invitation',
  '  /duel lobby 4 1d 10                open lobby with a join link',
  '  /duel join <link>                  preview, then add confirm to join',
  '  /duel view|accept|decline|cancel|leave|forfeit <code>',
  '  /duel energy [buy]                 Battle Energy',
  '  /duel link [on|off|1h…7d|regenerate]  your public exhibition link',
  'Guild duels (7 days, rosters of 2-10)',
  '  /duel guild                        your guild\'s duels and record',
  '  /duel guild @rivals 5 25           declare: team size, stake per member',
  '  /duel guild view|accept|decline|cancel <code>',
  '  /duel guild roster <code> [add|remove @handle]',
  '  /duel guild ready|unready|decline-selection <code>',
  'Durations: 1h 6h 1d 3d 7d. Wagers: a whole number or all. Add confirm (over 100 gold) and allin (whole balance) when asked.',
].join('\n')

const usage = error => ({ kind: 'usage', error })

function duelId(value) {
  if (typeof value !== 'string') return null
  if (UUID.test(value)) return value.toLowerCase()
  const code = value.toUpperCase()
  return CODE.test(code) ? code : null
}

function wager(value) {
  if (value === 'all') return 'all'
  if (!/^\d+$/.test(value)) return null
  const amount = Number(value)
  return Number.isSafeInteger(amount) && amount <= MAX_WAGER ? amount : null
}

// Pulls the confirm/allin tokens out of a word list.
function flags(words) {
  return { rest: words.filter(word => !FLAGS.includes(word)), confirm: words.includes('confirm'), allIn: words.includes('allin') }
}

// Accepts a lobby URL (any host; the token is sent only to the configured app) or a bare token.
export function joinToken(value) {
  if (typeof value !== 'string') return null
  if (TOKEN.test(value)) return value
  try {
    const match = new URL(value).pathname.match(/^\/duels\/join\/([^/]+)\/?$/)
    return match && TOKEN.test(match[1]) ? match[1] : null
  } catch { return null }
}

// Returns {kind, ...} for the worker, or {kind:'usage', error} for a local reply.
export function parseDuelCommand(args = '') {
  const words = String(args ?? '').trim().split(/\s+/).filter(Boolean)
  const lower = words.map(word => word.toLowerCase())
  const [head, ...tail] = lower
  if (!head) return { kind: 'dashboard' }
  if (head === 'help') return usage(null)
  if (head === 'guild') return parseGuildCommand(words.slice(1), tail)
  if (['view', 'accept', 'decline', 'cancel', 'leave', 'forfeit'].includes(head)) {
    const { rest, confirm, allIn } = flags(tail)
    const id = duelId(words[1])
    if (!id || rest.length !== 1) return usage(`Use /duel ${head} <code>, for example /duel ${head} Q7KM2P.`)
    if ((confirm || allIn) && !['accept', 'forfeit'].includes(head) || allIn && head === 'forfeit') return usage(`/duel ${head} takes no confirmation.`)
    return { kind: head, id, ...(head === 'accept' || head === 'forfeit' ? { confirm } : {}), ...(head === 'accept' ? { allIn } : {}) }
  }
  if (head === 'join') {
    const { confirm, allIn } = flags(tail)
    const raw = words.slice(1).filter(word => !FLAGS.includes(word.toLowerCase()))
    const token = joinToken(raw[0])
    if (!token || raw.length !== 1) return usage('Use /duel join <lobby link>.')
    return { kind: 'join', token, confirm, allIn }
  }
  if (head === 'energy') {
    const { rest, confirm } = flags(tail)
    if (!rest.length && !confirm) return { kind: 'energy' }
    if (rest.length === 1 && rest[0] === 'buy') return { kind: 'energyBuy', confirm }
    return usage('Use /duel energy, or /duel energy buy.')
  }
  if (head === 'link') {
    if (tail.length > 1) return usage('Use /duel link, link on, link off, link <duration> or link regenerate.')
    const [option] = tail
    if (!option) return { kind: 'link' }
    if (option === 'on' || option === 'off') return { kind: 'linkUpdate', enabled: option === 'on' }
    if (DURATIONS[option]) return { kind: 'linkUpdate', durationSeconds: DURATIONS[option] }
    if (option === 'regenerate') return { kind: 'linkRegenerate' }
    return usage(`Unknown link option "${option}". Durations are 1h, 6h, 1d, 3d and 7d.`)
  }
  if (head === 'lobby') {
    const { rest, confirm, allIn } = flags(tail)
    const capacity = /^[2-8]$/.test(rest[0] ?? '') ? Number(rest[0]) : null
    const durationSeconds = DURATIONS[rest[1]]
    const amount = rest[2] === undefined ? null : wager(rest[2])
    if (!capacity || !durationSeconds || amount === null || rest.length !== 3) return usage('Use /duel lobby <2-8 players> <1h|6h|1d|3d|7d> <wager>, for example /duel lobby 4 1d 10.')
    return { kind: 'lobby', capacity, durationSeconds, wager: amount, confirm, allIn, raw: ['lobby', ...rest].join(' ') }
  }
  // Otherwise: one or more handles, then an optional duration and wager.
  const { rest, confirm, allIn } = flags(lower)
  const handles = []
  let index = 0
  for (; index < rest.length; index++) {
    const word = rest[index]
    if (DURATIONS[word] || wager(word) !== null && !word.startsWith('@')) break
    if (/^\d+[mhdw]$/.test(word)) return usage('Durations are 1h, 6h, 1d, 3d and 7d.')
    if (!HANDLE.test(word)) return usage(`"${words[lower.indexOf(word)] ?? word}" is not a Guildbyte handle or /duel command.\n${DUEL_USAGE}`)
    const handle = word.replace(/^@/, '')
    if (!handles.includes(handle)) handles.push(handle)
  }
  if (!handles.length) return usage(`Name a player first, for example /duel @alice 6h 25.\n${DUEL_USAGE}`)
  if (handles.length > MAX_OPPONENTS) return usage(`A free-for-all holds at most 8 players: invite up to ${MAX_OPPONENTS} handles.`)
  const options = rest.slice(index)
  if (!options.length && !confirm && !allIn) return { kind: 'setup', handles }
  const durationSeconds = DURATIONS[options[0]]
  const amount = options[1] === undefined ? null : wager(options[1])
  if (!durationSeconds || amount === null || options.length !== 2) {
    return usage(`Use /duel ${handles.map(handle => '@' + handle).join(' ')} <1h|6h|1d|3d|7d> <wager>, for example /duel @${handles[0]} 6h 25.`)
  }
  return { kind: 'challenge', handles, durationSeconds, wager: amount, confirm, allIn, raw: [...handles.map(handle => '@' + handle), ...options].join(' ') }
}

const GUILD_ACTIONS = { view: 'guildView', accept: 'guildAccept', decline: 'guildDecline', cancel: 'guildCancel', ready: 'guildReady', unready: 'guildUnready', 'decline-selection': 'guildDeclineSelection' }
export const GUILD_SIZES = [2, 3, 4, 5, 6, 7, 8, 9, 10]

// `/duel guild …`. Subcommand names win over guild slugs; prefix a slug with @
// (`/duel guild @view`) to challenge a guild named like a subcommand.
function parseGuildCommand(words, lower) {
  const [head, ...tail] = lower
  if (!head) return { kind: 'guildDashboard' }
  if (GUILD_ACTIONS[head]) {
    const { rest, confirm, allIn } = flags(tail)
    const id = duelId(words[1])
    if (!id || rest.length !== 1) return usage(`Use /duel guild ${head} <code>, for example /duel guild ${head} Q7KM2P.`)
    if ((confirm || allIn) && head !== 'ready') return usage(`/duel guild ${head} takes no confirmation.`)
    return { kind: GUILD_ACTIONS[head], id, ...(head === 'ready' ? { confirm, allIn } : {}) }
  }
  if (head === 'roster') {
    const id = duelId(words[1])
    const action = tail[1]
    if (id && tail.length === 1) return { kind: 'guildRosterView', id }
    if (!id || !['add', 'remove'].includes(action) || tail.length !== 3 || !HANDLE.test(tail[2])) return usage('Use /duel guild roster <code> add|remove @handle, for example /duel guild roster Q7KM2P add @alice.')
    return { kind: 'guildRoster', id, action, handle: tail[2].replace(/^@/, '') }
  }
  if (!GUILD_SLUG.test(head)) return usage(`"${words[0]}" is not a guild or /duel guild command.\n${DUEL_USAGE}`)
  const slug = head.replace(/^@/, '')
  const { rest, confirm, allIn } = flags(tail)
  if (allIn) return usage('Guild duels take a fixed stake per member: no allin.')
  if (!rest.length && !confirm) return { kind: 'guildSetup', slug }
  const teamSize = /^(?:[2-9]|10)$/.test(rest[0] ?? '') ? Number(rest[0]) : null
  const amount = rest[1] === undefined || rest[1] === 'all' ? null : wager(rest[1])
  if (!teamSize || amount === null || rest.length !== 2) return usage(`Use /duel guild @${slug} <team size 2-10> <stake per member>, for example /duel guild @${slug} 5 25.`)
  return { kind: 'guildChallenge', slug, teamSize, wager: amount, confirm, raw: ['guild', '@' + slug, ...rest].join(' ') }
}

// ---------- Rendering helpers ----------

const clean = (value, max = 80) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, max) : ''
const list = value => Array.isArray(value) ? value : []
const count = value => Number.isFinite(value) ? value : 0
export const commas = value => String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const gold = value => `${commas(count(value))} gold`

// Fair base points arrive as 4-decimal strings; one decimal is enough to tell close scores apart.
export function points(value) {
  const number = Number(value)
  if (value === null || value === undefined || value === '' || !Number.isFinite(number)) return '—'
  const tenths = Math.round(Math.abs(number) * 10)
  return `${number < 0 ? '-' : ''}${commas(Math.floor(tenths / 10))}${tenths % 10 ? '.' + (tenths % 10) : ''}`
}

// "4h", "2h 14m", "3d 2h", "<1m".
export function span(ms, round = Math.floor) {
  const minutes = round(Math.max(0, ms) / 60000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`
  return hours % 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${Math.floor(hours / 24)}d`
}
// Countdowns round up so an hour away never reads as 59m; elapsed times round down.
const until = (iso, now) => Number.isFinite(Date.parse(iso)) ? span(Date.parse(iso) - now, Math.ceil) : null
const since = (iso, now) => Number.isFinite(Date.parse(iso)) ? span(now - Date.parse(iso)) : null

export function durationLabel(seconds) {
  return Object.keys(DURATIONS).find(key => DURATIONS[key] === seconds) ?? span(count(seconds) * 1000)
}

// Server links: same-origin paths become absolute; absolute http(s) links pass when printable.
export function webLink(origin, value, fallback = '/duels') {
  if (typeof value === 'string' && value.length <= 500 && !/[\x00-\x20\x7f-\x9f]/.test(value)) {
    if (/^\/(?![/\\])/.test(value)) return origin + value
    try {
      const url = new URL(value)
      if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url.href
    } catch { /* Falls back below. */ }
  }
  return fallback === null ? null : origin + fallback
}

const handle = value => `@${clean(value, 40)}`
const name = participant => participant?.isYou ? 'You' : handle(participant?.handle)
const ref = duel => clean(duel?.code ?? duel?.id ?? '', 40)
const tag = duel => `[${ref(duel)}]`
const seated = duel => list(duel?.participants).filter(p => !['declined', 'left'].includes(p.state))
const you = duel => list(duel?.participants).find(p => p.isYou)
const others = duel => list(duel?.participants).filter(p => !p.isYou)
const isFreeForAll = duel => count(duel?.capacity) > 2 || list(duel?.participants).length > 2
const modeText = duel => duel?.mode === 'competitive' ? `wager ${gold(duel.wagerGold)}` : duel?.mode === 'legacy' ? 'legacy' : 'exhibition'

function title(duel) {
  if (isFreeForAll(duel)) return `FFA · ${count(duel.capacity) || list(duel.participants).length} players`
  const rivals = others(duel)
  return rivals.length ? `vs ${rivals.map(p => handle(p.handle)).join(', ')}` : '1v1 · open seat'
}

const ranked = duel => list(duel?.participants).filter(p => p.state !== 'declined' && p.state !== 'left')
  .slice().sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || Number(b.score ?? 0) - Number(a.score ?? 0))

// One score line: 1v1 "You 1,240 · @bob 980 · synced 1m ago", FFA "#1 @alice 1,540 · #2 You 720".
function scoreLine(duel, now) {
  if (isFreeForAll(duel)) {
    return ranked(duel).slice(0, 4).map((p, i) => `#${p.rank ?? i + 1} ${name(p)} ${points(p.score)}${p.state === 'forfeited' ? ' (forfeited)' : ''}`).join(' · ')
  }
  const me = you(duel)
  const line = [me, ...others(duel)].filter(Boolean).map(p => `${name(p)} ${points(p.score)}`).join(' · ')
  const synced = since(me?.lastSyncedAt, now)
  return synced ? `${line} · synced ${synced} ago` : line
}

// Your result for history rows: "Won vs @chris · +20 gold · 1,820–1,440".
function resultLine(duel) {
  const me = you(duel)
  const versus = title(duel)
  const wagerGold = count(duel.wagerGold)
  if (duel.status === 'invalidated') return `Void ${versus} · gold and energy refunded`
  if (['cancelled', 'expired'].includes(duel.status)) return `${duel.status === 'expired' ? 'Expired' : 'Cancelled'} ${versus}${wagerGold ? ' · gold refunded' : ''}`
  let scores = ''
  if (isFreeForAll(duel)) scores = me?.rank ? `#${me.rank} of ${seated(duel).length} · ${points(me.score)}` : ''
  else scores = [me, ...others(duel)].filter(Boolean).map(p => points(p.score)).join('–')
  const outcome = me?.outcome ?? (duel.status === 'draw' ? 'draw' : null)
  let label, money = ''
  if (duel.mode !== 'competitive') label = { won: 'Won', lost: 'Lost', draw: 'Draw', forfeited: 'Forfeited' }[outcome] ?? 'Ended'
  else if (outcome === 'won') { label = 'Won'; money = `+${gold(count(me.payoutGold) - wagerGold)}` }
  else if (outcome === 'draw') { label = 'Draw'; money = `${gold(wagerGold)} refunded` }
  else if (outcome === 'lost' || outcome === 'forfeited') { label = outcome === 'lost' ? 'Lost' : 'Forfeited'; money = `-${gold(wagerGold)}` }
  else label = 'Ended'
  const mode = duel.mode === 'exhibition' ? 'exhibition' : duel.mode === 'legacy' ? 'legacy' : money
  return [`${label} ${versus}`, mode, scores].filter(Boolean).join(' · ')
}

// Command hints from the server's allowed actions.
function actions(duel) {
  const allowed = duel?.you
  if (!allowed) return []
  const id = ref(duel)
  const confirm = allowed.confirm ?? {}
  const hints = []
  if (allowed.canAccept) hints.push(`/duel accept ${id}${confirm.lossGold ? ' confirm' : ''}${confirm.allIn ? ' allin' : ''}`)
  if (allowed.canDecline) hints.push(`/duel decline ${id}`)
  if (allowed.canLeave) hints.push(`/duel leave ${id}`)
  if (allowed.canCancel) hints.push(`/duel cancel ${id}`)
  if (allowed.canForfeit) hints.push(`/duel forfeit ${id}`)
  return hints
}

function energyLine(energy, now) {
  if (!energy) return 'Energy ?/3'
  const next = energy.nextAt ? until(energy.nextAt, now) : null
  return `Energy ${count(energy.available)}/${energy.max ?? 3}${count(energy.reserved) ? ` (${energy.reserved} reserved)` : ''}${next ? ` · next +1 in ${next}` : ''}`
}

// Two-line card used by the dashboard and mutation replies.
function card(duel, now) {
  const head = `${tag(duel)} ${title(duel)}`
  if (duel.status === 'active') {
    const left = until(duel.endsAt, now)
    return [`${head} · ${duel.mode === 'exhibition' ? 'exhibition · ' : ''}${left ? `${left} left` : 'settling'}`, `       ${scoreLine(duel, now)}`]
  }
  if (duel.status === 'proposed' || duel.status === 'pending_setup') {
    const joined = list(duel.participants).filter(p => p.state === 'joined').length
    const seats = isFreeForAll(duel) || duel.entry === 'open' ? ` · ${joined}/${count(duel.capacity)}` : ''
    const expires = until(duel.expiresAt, now)
    const status = duel.status === 'pending_setup' ? ' · pending setup' : ''
    return [`${head}${seats} · ${durationLabel(duel.durationSeconds)} · ${modeText(duel)}${status}${expires ? ` · expires in ${expires}` : ''}`]
  }
  return [`${tag(duel)} ${resultLine(duel)}`]
}

// ---------- Replies ----------

function dashboardText(dashboard, origin, now) {
  const lines = [`DUELS · ${energyLine(dashboard.energy, now)} · ${gold(dashboard.gold)}`]
  if (dashboard.wagersEnabled === false) lines.push('Wagered duels are not open yet: exhibitions only.')
  const section = (label, duels, render) => {
    if (!duels.length) return
    lines.push('', label)
    for (const duel of duels) lines.push(...render(duel))
  }
  section('REQUESTS', list(dashboard.requests), duel => {
    const from = list(duel.participants).find(p => p.role === 'creator')
    const what = isFreeForAll(duel) ? `FFA · ${count(duel.capacity)} players · from ${handle(from?.handle ?? duel.creator)}` : handle(from?.handle ?? duel.creator)
    return [`${tag(duel)} ${what} · ${durationLabel(duel.durationSeconds)} · ${modeText(duel)}`, `       ${actions(duel).filter(hint => /accept|decline/.test(hint)).join('   ') || `/duel view ${ref(duel)}`}`]
  })
  section('SENT', list(dashboard.sent), duel => [...card(duel, now), `       /duel cancel ${ref(duel)}`])
  section('LOBBIES', list(dashboard.lobbies), duel => [...card(duel, now), `       /duel view ${ref(duel)}`])
  section('ACTIVE', list(dashboard.active), duel => [...card(duel, now), ...(isFreeForAll(duel) ? [`       /duel view ${ref(duel)}`] : [])])
  const exhibitions = dashboard.exhibitions ?? {}
  if (count(exhibitions.activeCount) || list(exhibitions.items).length) {
    lines.push('', `LINK EXHIBITIONS (${count(exhibitions.activeCount)} active)`)
    for (const duel of list(exhibitions.items).slice(0, 3)) lines.push(...card(duel, now))
    if (count(exhibitions.activeCount) > 3) lines.push('       More on the web dashboard.')
  }
  section('RECENT', list(dashboard.recent).slice(0, 5), duel => [resultLine(duel)])
  const record = dashboard.record
  if (record && count(record.wins) + count(record.losses) + count(record.draws)) {
    lines.push('', `Record ${record.wins}W ${record.losses}L ${record.draws}D${record.winRate === null || record.winRate === undefined ? '' : ` · ${Math.round(record.winRate * 100)}%`}${record.currentStreak ? ` · streak ${record.currentStreak}` : ''}`)
  }
  if (!list(dashboard.requests).length && !list(dashboard.active).length && !list(dashboard.sent).length && !list(dashboard.lobbies).length) {
    lines.push('', 'No requests or active duels. Challenge someone: /duel @handle 6h 0')
  }
  lines.push('', `Open full dashboard: ${webLink(origin, dashboard.webUrl)}`)
  return lines.join('\n')
}

const STATUS = { proposed: 'Waiting for players', pending_setup: 'Pending setup', active: 'Active', completed: 'Completed', draw: 'Draw', cancelled: 'Cancelled', expired: 'Expired', invalidated: 'Invalidated' }
const STATE = { invited: '○ invited', joined: '✓ joined', declined: '✗ declined', left: 'left', forfeited: 'forfeited' }

function viewText(duel, origin, now) {
  const mode = { competitive: 'Competitive', exhibition: 'Exhibition', legacy: 'Legacy' }[duel.mode] ?? 'Duel'
  let timing = ''
  if (duel.status === 'active') timing = until(duel.endsAt, now) ? ` · ${until(duel.endsAt, now)} left` : ' · settling'
  else if (['proposed', 'pending_setup'].includes(duel.status) && until(duel.expiresAt, now)) timing = ` · expires in ${until(duel.expiresAt, now)}`
  else if (duel.settledAt && since(duel.settledAt, now)) timing = ` · settled ${since(duel.settledAt, now)} ago`
  const stake = duel.mode === 'competitive' ? ` · ${gold(duel.wagerGold)} each · pot ${gold(duel.potGold)}` : duel.mode === 'exhibition' ? ' · no gold, no records' : ''
  const lines = [`DUEL ${tag(duel)} · ${mode} · ${STATUS[duel.status] ?? clean(duel.status)}${timing}`,
    `${title(duel)} · ${durationLabel(duel.durationSeconds)}${stake}`]
  if (duel.invalidatedReason) lines.push(`Invalidated: ${clean(duel.invalidatedReason, 200)}. Gold and energy were refunded.`)
  lines.push('')
  const live = ['active', 'completed', 'draw', 'invalidated'].includes(duel.status)
  for (const [i, p] of (live ? ranked(duel) : list(duel.participants)).entries()) {
    const parts = [`${live ? `#${p.rank ?? i + 1} ` : '  '}${p.isYou ? `You (${handle(p.handle)})` : handle(p.handle)}`]
    if (live) parts.push(points(p.score))
    if (!live || p.state === 'forfeited') parts.push(STATE[p.state] ?? clean(p.state))
    if (p.outcome && !['active'].includes(duel.status)) parts.push(p.outcome + (p.payoutGold ? ` +${gold(p.payoutGold)}` : ''))
    if (duel.status === 'active' && since(p.lastSyncedAt, now)) parts.push(`synced ${since(p.lastSyncedAt, now)} ago`)
    if (p.hero?.archetype) parts.push([clean(p.hero.archetype, 30), clean(p.hero.rarity, 20)].filter(Boolean).join(' '))
    lines.push(parts.join(' · '))
  }
  if (duel.provisional) lines.push('', 'Provisional scores. Results settle 15 minutes after the timer ends (upload grace).')
  if (duel.winner) lines.push('', `Winner: ${handle(duel.winner)}`)
  const joinUrl = duel.joinUrl ? webLink(origin, duel.joinUrl, null) : null
  if (joinUrl) lines.push('', `Lobby link: ${joinUrl}`)
  const setupUrl = duel.setupUrl ? webLink(origin, duel.setupUrl, null) : null
  if (setupUrl) lines.push('', `Finish setup to start scoring: ${setupUrl}`)
  const hints = actions(duel)
  if (hints.length) lines.push('', hints.join('   '))
  lines.push('', webLink(origin, duel.url))
  return lines.join('\n')
}

function stakeLine(duel) {
  return duel.mode === 'competitive' ? `Competitive · 1 energy and ${gold(duel.wagerGold)} reserved until it starts.` : 'Exhibition: no gold, no energy, no records.'
}

function mutationText(result, origin, now) {
  const duel = result.duel ?? {}
  const id = ref(duel)
  const lines = []
  const active = duel.status === 'active'
  const waiting = list(duel.participants).filter(p => p.state === 'invited').length || Math.max(0, count(duel.capacity) - list(duel.participants).filter(p => p.state === 'joined').length)
  switch (result.kind) {
    case 'created': {
      const invited = list(duel.participants).filter(p => !p.isYou && p.role !== 'creator').map(p => handle(p.handle))
      lines.push(invited.length > 1 ? `Free-for-all invitation ${tag(duel)} sent to ${invited.join(', ')}.` : `Challenge ${tag(duel)} sent to ${invited[0] ?? 'your opponent'}.`)
      lines.push(`${durationLabel(duel.durationSeconds)} · ${modeText(duel)}. ${stakeLine(duel)}`)
      if (until(duel.expiresAt, now)) lines.push(`Expires in ${until(duel.expiresAt, now)} if not accepted. Withdraw: /duel cancel ${id}`)
      break
    }
    case 'lobby': {
      const joinUrl = webLink(origin, duel.joinUrl, null)
      lines.push(`Lobby ${tag(duel)} open · ${list(duel.participants).filter(p => p.state === 'joined').length}/${count(duel.capacity)} seats · ${durationLabel(duel.durationSeconds)} · ${modeText(duel)}.`)
      lines.push(stakeLine(duel))
      lines.push(joinUrl ? `Share this link: ${joinUrl}` : 'Share the lobby link from the web page.')
      lines.push(`Starts automatically when full${until(duel.expiresAt, now) ? `; expires in ${until(duel.expiresAt, now)}` : ''}. Close it: /duel cancel ${id}`)
      break
    }
    case 'accepted':
    case 'joined':
      if (active) lines.push(`Duel ${tag(duel)} started! ${title(duel)} · ends in ${until(duel.endsAt, now) ?? durationLabel(duel.durationSeconds)}.`)
      else lines.push(`${result.kind === 'joined' ? 'Joined' : 'Accepted'} ${tag(duel)} ${title(duel)}. Starts when ${waiting === 1 ? '1 more player joins' : `${waiting} more players join`}.`)
      if (duel.mode === 'competitive') lines.push(active ? `Energy spent · ${gold(duel.wagerGold)} staked · pot ${gold(duel.potGold)}.` : stakeLine(duel))
      break
    case 'declined':
      lines.push(`Declined ${tag(duel)}. ${duel.status === 'cancelled' ? 'The challenge is cancelled' : 'You are out'}${duel.mode === 'competitive' ? '; every stake is refunded.' : '.'}`)
      break
    case 'cancelled':
      lines.push(`Cancelled ${tag(duel)}.${duel.mode === 'competitive' ? ' Gold and energy are back for everyone.' : ''}`)
      break
    case 'left':
      lines.push(`Left ${tag(duel)}.${duel.mode === 'competitive' ? ' Your gold and energy are back.' : ''}`)
      break
    case 'forfeited':
      lines.push(`Forfeited ${tag(duel)}.${duel.mode === 'competitive' ? ' Your stake stays in the pot.' : ''}`)
      if (duel.winner) lines.push(`${handle(duel.winner)} wins${duel.mode === 'competitive' ? ` the ${gold(duel.potGold)} pot` : ''}.`)
      else if (active) lines.push('The duel continues for the remaining players.')
      break
  }
  lines.push('', webLink(origin, duel.url))
  return lines.join('\n')
}

function confirmText(result) {
  const lines = []
  if (result.action === 'forfeit') {
    lines.push('Forfeiting is a defeat: your stake stays in the pot and your energy stays spent.', `Confirm: /duel forfeit ${result.id} confirm`)
    return lines.join('\n')
  }
  if (result.message) lines.push(clean(result.message, 200))
  else {
    if (result.lossGold) lines.push(`You can lose ${gold(result.lossGold)}.`)
    if (result.allIn) lines.push(`All-in: ${gold(result.wagerGold ?? result.lossGold)} is your entire balance.`)
  }
  const tokens = `${result.lossGold ? ' confirm' : ''}${result.allIn ? ' allin' : ''}`
  lines.push(`Confirm: /duel ${result.command}${tokens}`)
  return lines.join('\n')
}

function previewText(result, origin, now) {
  const preview = result.preview ?? {}
  const command = `/duel join ${result.token}`
  if (preview.status && preview.status !== 'proposed') return `This lobby already ${preview.status === 'active' ? 'started' : 'closed'}.\n\n${webLink(origin, preview.duelUrl)}`
  const joined = list(preview.participants)
  const expires = until(preview.expiresAt, now)
  const lines = [`${count(preview.capacity) > 2 ? 'FREE-FOR-ALL LOBBY' : 'LOBBY'} ${tag(preview)} · ${joined.length}/${count(preview.capacity)} players${expires ? ` · expires in ${expires}` : ''}`,
    `${durationLabel(preview.durationSeconds)} · ${preview.mode === 'competitive' ? `${gold(preview.wagerGold)} each · ${gold(preview.potGold)} pot · ${count(preview.energyCost)} energy` : 'exhibition: no gold, no records'}`,
    `${joined.map(p => handle(p.handle)).join(', ') || handle(preview.creator)} joined · ${count(preview.openSeats)} open seat${preview.openSeats === 1 ? '' : 's'}`]
  const yours = preview.you
  if (yours?.seated) lines.push('', `You already hold a seat. Leave: /duel leave ${ref(preview)}`)
  else if (yours && !yours.canJoin) lines.push('', 'You cannot join this lobby.')
  else {
    const confirm = yours?.confirm ?? {}
    if (confirm.message) lines.push('', clean(confirm.message, 200))
    lines.push('', `Join: ${command} confirm${confirm.allIn ? ' allin' : ''}`)
  }
  lines.push('', webLink(origin, preview.duelUrl))
  return lines.join('\n')
}

function energyText(result, origin, now) {
  const energy = result.energy ?? result.result?.energy ?? {}
  const price = count(energy.price) || ENERGY_PRICE
  const lines = []
  if (result.kind === 'energyBought') lines.push(`Bought 1 Battle Energy for ${gold(price)}. ${gold(result.result?.gold)} left.`)
  lines.push(`Battle ${energyLine(energy, now)}`)
  if (result.kind === 'energyConfirm') {
    lines.push(energy.canPurchase ? `Buy 1 energy for ${gold(price)}? Confirm: /duel energy buy confirm` : 'You cannot buy energy now: purchases only fill missing capacity.')
  } else if (result.kind === 'energy') {
    lines.push('Wagered player duels use 1 energy per participant. One regenerates every 8 hours.')
    if (energy.canPurchase) lines.push(`Buy 1 for ${gold(price)}: /duel energy buy`)
  }
  lines.push('', `${origin}/duels`)
  return lines.join('\n')
}

function linkText(result, origin) {
  const link = result.link ?? {}
  const url = link.url ? webLink(origin, link.url, null) : null
  const lines = []
  if (result.regenerated) lines.push('New challenge link created. The previous link no longer works; running exhibitions continue.')
  lines.push(`Challenge link: ${link.enabled ? 'on' : 'off'} · ${durationLabel(link.durationSeconds)} exhibitions · ${count(link.activeCount)} active`)
  lines.push(url ? `Share: ${url}` : 'The link is shown only when it is created. /duel link regenerate makes a new one (the old one stops working).')
  lines.push('Anyone with the link starts a 1v1 exhibition against you: no gold, no energy, no records.')
  lines.push(`/duel link ${link.enabled ? 'off' : 'on'} · /duel link <1h|6h|1d|3d|7d> · /duel link regenerate`, '', `${origin}/duels`)
  return lines.join('\n')
}

function setupText(result, origin, now) {
  const dashboard = result.dashboard ?? {}
  const who = result.handles.map(h => '@' + h).join(' ')
  const lines = [result.handles.length > 1 ? `Free-for-all with ${who} · ${result.handles.length + 1} players` : `Challenge ${who}`,
    `${energyLine(dashboard.energy, now)} · ${gold(dashboard.gold)}`,
    'Duration  1h 6h 1d 3d 7d',
    `Wager     0 (exhibition)${dashboard.wagersEnabled === false ? '; wagers are not open yet' : ', 10, 25, 50 or any whole number; all = your balance'}`,
    `Send: /duel ${who} 6h ${dashboard.wagersEnabled === false ? 0 : 25}`, '', webLink(origin, dashboard.webUrl)]
  return lines.join('\n')
}

// ---------- Guild duels ----------

const GUILD_STATUS = { proposed: 'Waiting for a reply', rostering: 'Picking rosters', active: 'Active', completed: 'Completed', draw: 'Draw', cancelled: 'Cancelled', expired: 'Expired', invalidated: 'Invalidated' }
const ROSTER_STATE = { selected: '○ selected', ready: '✓ ready', declined: '✗ declined' }
const guildName = side => clean(side?.guild?.name, 40) || 'Unknown guild'
const roster = side => list(side?.roster).filter(member => member.state !== 'removed')
const teamLabel = duel => duel?.teamSize ? `${duel.teamSize}v${duel.teamSize}` : 'guild duel'
const guildStake = duel => duel?.mode === 'competitive' ? `${gold(duel.wagerGold)} each` : duel?.mode === 'legacy' ? 'legacy' : 'exhibition'

// [ours, theirs]: the caller's side first, by `you.side`, else by guild id.
function guildSides(duel, guildId) {
  const sides = list(duel?.sides)
  const mine = duel?.you?.side ?? sides.find(side => side?.guild?.id === guildId)?.side
  const ours = sides.find(side => side?.side === mine)
  return ours ? [ours, sides.find(side => side !== ours)] : [sides[0], sides[1]]
}

function guildActions(duel) {
  const allowed = duel?.you
  if (!allowed) return []
  const id = ref(duel)
  const confirm = allowed.confirm ?? {}
  const hints = []
  if (allowed.canAccept) hints.push(`/duel guild accept ${id}`)
  if (allowed.canDecline) hints.push(`/duel guild decline ${id}`)
  if (allowed.canEditRoster) hints.push(`/duel guild roster ${id} add @handle`)
  if (allowed.canReady) hints.push(`/duel guild ready ${id}${confirm.lossGold ? ' confirm' : ''}${confirm.allIn ? ' allin' : ''}`)
  if (allowed.canUnready) hints.push(`/duel guild unready ${id}`)
  if (allowed.canDeclineSelection) hints.push(`/duel guild decline-selection ${id}`)
  if (allowed.canCancel) hints.push(`/duel guild cancel ${id}`)
  return hints
}

const totals = (ours, theirs) => `${guildName(ours)} ${points(ours?.total)} · ${guildName(theirs)} ${points(theirs?.total)}`

function guildResultLine(duel, guildId) {
  const [ours, theirs] = guildSides(duel, guildId)
  const versus = `vs ${guildName(theirs)}`
  if (duel.status === 'invalidated') return `Void ${versus} · stakes refunded`
  if (['cancelled', 'expired'].includes(duel.status)) return `${duel.status === 'expired' ? 'Expired' : 'Cancelled'} ${versus}${count(duel.wagerGold) ? ' · stakes refunded' : ''}`
  const outcome = ours?.outcome ?? (duel.status === 'draw' ? 'draw' : null)
  const label = { won: 'Won', lost: 'Lost', draw: 'Draw' }[outcome] ?? 'Ended'
  let money = ''
  if (duel.mode === 'competitive') money = outcome === 'won' ? `+${gold(duel.wagerGold)} each` : outcome === 'lost' ? `-${gold(duel.wagerGold)} each` : outcome === 'draw' ? 'stakes refunded' : ''
  return [`${label} ${versus}`, duel.mode === 'exhibition' ? 'exhibition' : money, `${points(ours?.total)}–${points(theirs?.total)}`].filter(Boolean).join(' · ')
}

function guildCard(duel, guildId, now) {
  const [ours, theirs] = guildSides(duel, guildId)
  const head = `${tag(duel)} vs ${guildName(theirs)} · ${teamLabel(duel)}`
  if (duel.status === 'active') {
    const left = until(duel.endsAt, now)
    return [`${head} · ${left ? `${left} left` : 'settling'}`, `       ${totals(ours, theirs)}`]
  }
  if (duel.status === 'proposed' || duel.status === 'rostering') {
    const expires = until(duel.expiresAt, now)
    const ready = duel.status === 'rostering' && duel.teamSize ? ` · ready ${count(ours?.readyCount)}/${duel.teamSize} — ${count(theirs?.readyCount)}/${duel.teamSize}` : ''
    return [`${head} · ${guildStake(duel)}${ready}${expires ? ` · expires in ${expires}` : ''}`]
  }
  return [`${tag(duel)} ${guildResultLine(duel, guildId)}`]
}

function guildDashboardText(dashboard, origin, now) {
  const guildId = dashboard.guild?.id
  const record = dashboard.record ?? {}
  const lines = [`GUILD DUELS · ${clean(dashboard.guild?.name, 40) || 'Your guild'} · Record ${count(record.wins)}W ${count(record.losses)}L ${count(record.draws)}D`]
  const section = (label, duels, extra = () => []) => {
    if (!duels.length) return
    lines.push('', label)
    for (const duel of duels) {
      lines.push(...guildCard(duel, guildId, now))
      const hints = extra(duel)
      if (hints.length) lines.push(`       ${hints.join('   ')}`)
    }
  }
  const hints = keep => duel => guildActions(duel).filter(hint => keep.some(word => hint.includes(` ${word} `)))
  section('INCOMING', list(dashboard.incoming), hints(['accept', 'decline']))
  section('SENT', list(dashboard.outgoing), hints(['cancel']))
  section('ROSTER LOBBIES', list(dashboard.rostering), duel => {
    const actions = hints(['ready', 'unready', 'decline-selection', 'cancel'])(duel)
    return [...(duel.you?.canEditRoster ? [`/duel guild roster ${ref(duel)}`] : []), ...actions]
  })
  section('ACTIVE', list(dashboard.active), duel => [`/duel guild view ${ref(duel)}`])
  const history = list(dashboard.history).slice(0, 5)
  if (history.length) lines.push('', 'HISTORY', ...history.map(duel => guildResultLine(duel, guildId)))
  if (!list(dashboard.incoming).length && !list(dashboard.outgoing).length && !list(dashboard.rostering).length && !list(dashboard.active).length) lines.push('', 'No open guild duels.')
  if (dashboard.canDeclare) lines.push('', 'Declare one: /duel guild @guild-slug 5 25')
  lines.push('', `Open guild duels: ${origin}/duels?tab=guild`)
  return lines.join('\n')
}

function guildViewText(duel, origin, now) {
  const mode = { competitive: 'Competitive', exhibition: 'Exhibition', legacy: 'Legacy' }[duel.mode] ?? 'Guild duel'
  let timing = ''
  if (duel.status === 'active') timing = until(duel.endsAt, now) ? ` · ${until(duel.endsAt, now)} left` : ' · settling'
  else if (['proposed', 'rostering'].includes(duel.status) && until(duel.expiresAt, now)) timing = ` · expires in ${until(duel.expiresAt, now)}`
  else if (duel.settledAt && since(duel.settledAt, now)) timing = ` · settled ${since(duel.settledAt, now)} ago`
  const [ours, theirs] = guildSides(duel)
  const stake = duel.mode === 'competitive' ? ` · ${gold(duel.wagerGold)} each · pot ${gold(duel.potGold)}` : duel.mode === 'exhibition' ? ' · no gold' : ''
  const lines = [`GUILD DUEL ${tag(duel)} · ${mode} · ${GUILD_STATUS[duel.status] ?? clean(duel.status)}${timing}`,
    `${guildName(ours)} vs ${guildName(theirs)} · ${teamLabel(duel)} · ${durationLabel(duel.durationSeconds)}${stake}`]
  if (duel.invalidatedReason) lines.push(`Invalidated: ${clean(duel.invalidatedReason, 200)}. Every stake was refunded.`)
  const live = ['active', 'completed', 'draw', 'invalidated'].includes(duel.status)
  for (const side of [ours, theirs].filter(Boolean)) {
    const members = roster(side)
    lines.push('', [guildName(side), duel.teamSize && !live ? `ready ${count(side.readyCount)}/${duel.teamSize}` : null, live ? `total ${points(side.total)}` : null, live ? side.outcome : null].filter(Boolean).join(' · '))
    if (!members.length) lines.push('  No members selected yet.')
    for (const member of members) {
      const parts = [`  ${member.isYou ? `You (${handle(member.handle)})` : handle(member.handle)}`]
      if (live) parts.push(points(member.contribution))
      else parts.push(ROSTER_STATE[member.state] ?? clean(member.state))
      if (member.payoutGold) parts.push(`+${gold(member.payoutGold)}`)
      if (duel.status === 'active' && since(member.lastSyncedAt, now)) parts.push(`synced ${since(member.lastSyncedAt, now)} ago`)
      lines.push(parts.join(' · '))
    }
  }
  if (duel.status === 'rostering') lines.push('', 'Starts automatically once both full rosters are ready; then rosters lock.')
  if (duel.provisional) lines.push('', 'Provisional totals. Results settle 15 minutes after the timer ends (upload grace).')
  const winner = list(duel.sides).find(side => side.side === duel.winner)
  if (winner) lines.push('', `Winner: ${guildName(winner)}`)
  const actions = guildActions(duel)
  if (actions.length) lines.push('', actions.join('   '))
  lines.push('', webLink(origin, duel.url, '/duels?tab=guild'))
  return lines.join('\n')
}

function guildUpdatedText(result, origin, now) {
  const duel = result.duel ?? {}
  const id = ref(duel)
  const [ours, theirs] = guildSides(duel)
  const filled = roster(ours).length
  const size = duel.teamSize ? `/${duel.teamSize}` : ''
  const lines = []
  switch (result.action) {
    case 'declare':
      lines.push(`Guild duel ${tag(duel)} declared against ${guildName(theirs)} · ${teamLabel(duel)} · 7 days · ${guildStake(duel)}.`)
      lines.push(`Their owner or a responder has ${until(duel.expiresAt, now) ?? '7 days'} to accept. Pick your roster: /duel guild roster ${id} add @handle`)
      break
    case 'accept':
      lines.push(`Accepted ${tag(duel)} against ${guildName(theirs)}. Both guilds now pick ${duel.teamSize ?? 'their'} members; it starts when every selected member is ready.`)
      lines.push(`Pick your roster: /duel guild roster ${id} add @handle`)
      break
    case 'decline': lines.push(`Declined guild duel ${tag(duel)} from ${guildName(theirs)}.`); break
    case 'cancel': lines.push(`Cancelled guild duel ${tag(duel)}.${count(duel.wagerGold) ? ' Every reserved stake is refunded.' : ''}`); break
    case 'add': lines.push(`Added @${clean(result.handle, 40)} to the ${tag(duel)} roster (${filled}${size}). They confirm with /duel guild ready ${id}`); break
    case 'remove': lines.push(`Removed @${clean(result.handle, 40)} from the ${tag(duel)} roster (${filled}${size}).`); break
    case 'ready':
      if (duel.status === 'active') lines.push(`Guild duel ${tag(duel)} started! ${guildName(ours)} vs ${guildName(theirs)} · ends in ${until(duel.endsAt, now) ?? '7d'}.`)
      else lines.push(`Ready for ${tag(duel)}${duel.mode === 'competitive' ? ` · ${gold(duel.wagerGold)} staked` : ''}. Ready ${count(ours?.readyCount)}${size} — ${count(theirs?.readyCount)}${size}.`)
      break
    case 'unready': lines.push(`Not ready for ${tag(duel)}.${duel.mode === 'competitive' ? ' Your stake is released.' : ''}`); break
    case 'decline-selection': lines.push(`You left the ${tag(duel)} roster.`); break
  }
  lines.push('', webLink(origin, duel.url, '/duels?tab=guild'))
  return lines.join('\n')
}

function guildSetupText(result, origin) {
  const dashboard = result.dashboard ?? {}
  const lines = [`Guild duel: ${clean(dashboard.guild?.name, 40) || 'your guild'} vs @${clean(result.slug, 40)} · 7 days`]
  if (dashboard.canDeclare === false) lines.push('Only your guild owner or the Declare duels role can declare guild duels.')
  else lines.push('Team size  2 to 10 members per side', 'Stake      gold per member, 0 for an exhibition; winners receive twice their stake', `Send: /duel guild @${clean(result.slug, 40)} 5 25`)
  lines.push('', `${origin}/duels?tab=guild`)
  return lines.join('\n')
}

// One toast per new duel request from the heartbeat (rule 50).
export function duelNoticeText(notice, now = Date.now()) {
  const request = notice?.request ?? {}
  const id = clean(request.code ?? request.id, 40)
  const expires = until(request.expiresAt, now)
  const stake = count(request.wagerGold) ? `${gold(request.wagerGold)}${request.kind?.startsWith('guild') ? ' each' : ' wager'}` : 'exhibition'
  const tail = `${expires ? ` · expires in ${expires}` : ''}`
  const link = request.webUrl ? ` · ${request.webUrl}` : ''
  switch (request.kind) {
    case 'guild_challenge': return `⚔ ${clean(request.from, 40)} challenges your guild · 7 days · ${stake}${tail}. /duel guild accept ${id} · /duel guild decline ${id}${link}`
    case 'guild_roster': return `⚔ You were picked for the guild duel against ${clean(request.from, 40)} · ${stake}${tail}. /duel guild ready ${id} · /duel guild decline-selection ${id}${link}`
    case 'lobby': return `⚔ ${handle(request.from)} invites you to a free-for-all · ${durationLabel(request.durationSeconds)} · ${stake}${tail}. /duel accept ${id} · /duel decline ${id}${link}`
    default: return `⚔ ${handle(request.from)} challenges you · ${durationLabel(request.durationSeconds)} · ${stake}${tail}. /duel accept ${id} · /duel decline ${id}${link}`
  }
}

// Renders a worker result ({kind, ..., origin}) as command text.
export function formatDuelReply(result, now = Date.now()) {
  const origin = result?.origin ?? ''
  switch (result?.kind) {
    case 'dashboard': return dashboardText(result.dashboard ?? {}, origin, now)
    case 'view': return viewText(result.duel ?? {}, origin, now)
    case 'setup': return setupText(result, origin, now)
    case 'confirm': return confirmText(result)
    case 'preview': return previewText(result, origin, now)
    case 'energy': case 'energyConfirm': case 'energyBought': return energyText(result, origin, now)
    case 'link': return linkText(result, origin)
    case 'guildDashboard': return guildDashboardText(result.dashboard ?? {}, origin, now)
    case 'guildSetup': return guildSetupText(result, origin)
    case 'guildView': case 'guildRoster': return guildViewText(result.duel ?? {}, origin, now)
    case 'guildUpdated': return guildUpdatedText(result, origin, now)
    case 'error': {
      const setup = result.setupUrl ? webLink(origin, result.setupUrl, null) : null
      return `${clean(result.error, 240) || 'Guildbyte could not complete that duel action.'}${setup ? `\nFinish setup: ${setup}` : ''}`
    }
    case 'created': case 'lobby': case 'accepted': case 'joined': case 'declined': case 'cancelled': case 'left': case 'forfeited':
      return mutationText(result, origin, now)
    default: return 'Guildbyte returned an unexpected duel response.'
  }
}

export function formatUsage(command) {
  return command?.error ?? DUEL_USAGE
}
