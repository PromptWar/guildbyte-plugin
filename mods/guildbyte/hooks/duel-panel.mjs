import { CONFIRM_ABOVE, DURATIONS, ENERGY_PRICE, GUILD_SIZES, commas, durationLabel, formatDuelReply, webLink } from '../scripts/duel-format.mjs'

// Interactive /duel panels (plan §12, Appendix A.3). Each panel only gathers
// choices and then runs the same typed command through the worker, so the
// server stays authoritative and a surface without panes gets the typed reply.
// Pure: register.mjs owns every `$` call (the engine follows `$` only within
// one file) and hands the drawing an `act` object: `act.press(step)` applies a
// step to the current panel ({patch}, {message} or {args} to run), `act.close()`.
export const DUEL_PANE = 'guildbyte-duel'
const WAGERS = [0, 10, 25, 50]
const gold = value => `${commas(value)} gold`
const at = handles => handles.map(handle => '@' + handle).join(' ')

// Where a typed reply would end: the server's link, or the duels page.
function linkFor(result) {
  const origin = result.origin ?? ''
  if (result.kind === 'setup') return webLink(origin, result.dashboard?.webUrl)
  if (result.kind === 'preview') return webLink(origin, result.preview?.duelUrl)
  if (result.kind === 'guildSetup') return `${origin}/duels?tab=guild`
  if (result.duel?.url) return webLink(origin, result.duel.url, '/duels?tab=guild')
  return `${origin}${String(result.action ?? '').startsWith('guild') ? '/duels?tab=guild' : '/duels'}`
}

function stakeLines(result) {
  if (result.message) return [result.message]
  return [...(result.lossGold ? [`You can lose ${gold(result.lossGold)}.`] : []), ...(result.allIn ? [`All-in: ${gold(result.wagerGold ?? result.lossGold)} is your entire balance.`] : [])]
}

function confirmPanel(result) {
  const link = linkFor(result)
  if (result.action === 'forfeit') {
    return { kind: 'confirm', title: `Forfeit [${result.id}]?`, lines: ['Forfeiting is a defeat: your stake stays in the pot and your energy stays spent.'],
      cancelLabel: 'Keep fighting', confirmLabel: 'Forfeit', args: `forfeit ${result.id} confirm`, link }
  }
  const stake = result.lossGold ? ` & stake ${commas(result.lossGold)}` : ''
  const labels = {
    challenge: ['Confirm challenge', `Send${stake}`], lobby: ['Confirm lobby', `Open lobby${stake}`], accept: ['Accept duel', `Accept${stake}`],
    guildReady: ['Ready for guild duel', `Ready${stake}`], guildChallenge: ['Declare guild duel', `Declare · ${commas(result.lossGold ?? 0)} each`],
  }
  const [title, confirmLabel] = labels[result.action] ?? ['Confirm', 'Confirm']
  return { kind: 'confirm', title, lines: stakeLines(result), cancelLabel: 'Cancel', confirmLabel,
    args: `${result.command}${result.lossGold ? ' confirm' : ''}${result.allIn ? ' allin' : ''}`, link }
}

// The panel a worker result opens, or null when its typed reply is the whole answer.
export function panelFor(result) {
  switch (result?.kind) {
    case 'setup': {
      const dashboard = result.dashboard ?? {}
      const balance = Number.isSafeInteger(dashboard.gold) ? dashboard.gold : 0
      const wagersEnabled = dashboard.wagersEnabled !== false
      return { kind: 'challenge', handles: result.handles, duration: '6h', wager: wagersEnabled && balance >= 25 ? 25 : 0, custom: false, step: 'edit',
        gold: balance, wagersEnabled, energy: { available: dashboard.energy?.available ?? 0, max: dashboard.energy?.max ?? 3 }, link: linkFor(result) }
    }
    case 'guildSetup':
      if (result.dashboard?.canDeclare === false) return null
      return { kind: 'guildChallenge', slug: result.slug, guild: result.dashboard?.guild?.name ?? null, teamSize: 5, wager: 25, custom: false, step: 'edit', link: linkFor(result) }
    case 'confirm': return confirmPanel(result)
    case 'preview': {
      const preview = result.preview ?? {}
      const confirm = preview.you?.confirm ?? {}
      if (preview.status !== 'proposed' || !preview.you?.canJoin) return null
      const stake = preview.mode === 'competitive' ? `${gold(preview.wagerGold)} each · ${preview.energyCost ?? 1} energy` : 'exhibition: no gold, no records'
      return { kind: 'confirm', title: `Join lobby [${preview.code ?? ''}]`, lines: [`${preview.participants?.length ?? 0}/${preview.capacity} players · ${durationLabel(preview.durationSeconds)} · ${stake}`, ...(confirm.message ? [confirm.message] : [])],
        cancelLabel: 'Cancel', confirmLabel: preview.mode === 'competitive' ? `Join & stake ${commas(preview.wagerGold)}` : 'Join',
        args: `join ${result.token} confirm${confirm.allIn ? ' allin' : ''}`, link: linkFor(result) }
    }
    case 'energyConfirm': {
      if (!result.energy?.canPurchase) return null
      const price = result.energy.price || ENERGY_PRICE
      return { kind: 'confirm', title: 'Battle Energy', lines: [`Energy ${result.energy.available}/${result.energy.max ?? 3}. Purchases only fill missing capacity.`],
        cancelLabel: 'Cancel', confirmLabel: `Buy 1 energy · ${gold(price)}`, args: 'energy buy confirm', link: linkFor(result) }
    }
    case 'guildRoster': return { kind: 'roster', duel: result.duel, link: linkFor(result) }
    default: return null
  }
}

export function typedHint(panel) {
  if (panel.kind === 'challenge') return `/duel ${at(panel.handles)} ${panel.duration} ${panel.wager}`
  if (panel.kind === 'guildChallenge') return `/duel guild @${panel.slug} ${panel.teamSize} ${panel.wager}`
  if (panel.kind === 'roster') return `/duel guild roster ${panel.duel?.code ?? panel.duel?.id} add @handle`
  return `/duel ${panel.args}`
}

export const paneTitle = panel => panel.kind === 'guildChallenge' || panel.kind === 'roster' ? 'Guild duel' : 'Duel'
// The transcript line for a command whose panel is drawn.
export const openedText = panel => `Duel panel open. Typed: ${typedHint(panel)}\n\n${panel.link}`

const firstLine = text => text.split('\n')[0]
// State values stay plain JSON: a cleared message is dropped, never stored as undefined.
const quiet = ({ message, ...panel }) => panel

// A choice ({patch}) clears the last message; a warning ({message}) sets it.
export function applyStep(panel, step) {
  return step.message ? { ...panel, message: step.message } : quiet({ ...panel, ...step.patch })
}

export const busyPanel = panel => ({ ...quiet(panel), busy: true })

// What the panel shows once the worker answered a command it ran: the next
// panel, the roster again while it is still open, or the reply text.
export function afterAction(from, status) {
  const result = status?.duel
  let next
  if (!result) next = { ...from, message: status?.error ?? 'Guildbyte is syncing. Try again in a moment.' }
  else if (result.kind === 'error') next = { ...from, ...(from.step ? { step: 'edit' } : {}), message: formatDuelReply(result) }
  else if (result.kind === 'guildUpdated' && ['proposed', 'rostering'].includes(result.duel?.status) && result.action !== 'declare') {
    next = { kind: 'roster', duel: result.duel, link: linkFor(result), message: firstLine(formatDuelReply(result)) }
  } else next = panelFor(result) ?? { kind: 'result', title: paneTitle(from), text: formatDuelReply(result) }
  return { ...next, busy: false }
}

// ---------- Steps ----------

const choose = patch => () => ({ patch })
const run = args => () => ({ args })

export function challengeStep(panel) {
  const wager = panel.wagersEnabled ? panel.wager : 0
  const confirm = wager > CONFIRM_ABOVE
  const allIn = wager > 0 && wager === panel.gold
  if ((confirm || allIn) && panel.step === 'edit') return { patch: { step: 'confirm' } }
  return { args: `${at(panel.handles)} ${panel.duration} ${wager}${confirm ? ' confirm' : ''}${allIn ? ' allin' : ''}` }
}

export function guildStep(panel) {
  const confirm = panel.wager > CONFIRM_ABOVE
  if (confirm && panel.step === 'edit') return { patch: { step: 'confirm' } }
  return { args: `guild @${panel.slug} ${panel.teamSize} ${panel.wager}${confirm ? ' confirm' : ''}` }
}

const customWager = value => () => {
  const text = String(value ?? '').trim()
  return /^\d{1,9}$/.test(text) ? { patch: { wager: Number(text), custom: true } } : { message: 'Enter a whole number of gold.' }
}

const addMember = id => value => () => {
  const handle = String(value ?? '').trim().replace(/^@/, '')
  return /^[a-z0-9_]{3,24}$/i.test(handle) ? { args: `guild roster ${id} add @${handle}` } : { message: 'Enter a Guildbyte handle, for example @alice.' }
}

// ---------- Drawing ----------

function row(ui, label, children) {
  return ui.Box({ flexDirection: 'row', gap: 1, flexWrap: 'wrap', children: [ui.Text({ children: label.padEnd(10), dimColor: true }), ...children] })
}

function choice(ui, key, label, selected, onPress) {
  return ui.Button({ key, label, onPress, ...(selected ? { variant: 'primary' } : {}) })
}

function wagerRow(ui, act, panel, label, presets, typedExample) {
  const buttons = presets.map(amount => choice(ui, `wager:${amount}`, String(amount), !panel.custom && panel.wager === amount, () => act.press(choose({ wager: amount, custom: false }))))
  if (ui.Input) buttons.push(choice(ui, 'wager:custom', panel.custom ? `Custom · ${commas(panel.wager)}` : 'Custom', panel.custom, () => act.press(choose({ custom: true }))))
  const rows = [row(ui, label, buttons)]
  if (panel.custom && ui.Input) rows.push(row(ui, '', [ui.Input({ key: 'wager', placeholder: 'gold', value: String(panel.wager), submitLabel: 'Set', onSubmit: value => act.press(customWager(value)) })]))
  if (!ui.Input) rows.push(ui.Text({ children: `Other amounts: ${typedExample}`, dimColor: true }))
  return rows
}

function buttonsRow(ui, children) {
  return ui.Box({ flexDirection: 'row', gap: 1, justifyContent: 'flex-end', marginTop: 1, children })
}

function footer(ui, panel) {
  const lines = []
  if (panel.busy) lines.push(ui.Text({ children: 'Sending…', dimColor: true }))
  if (panel.message) lines.push(ui.Text({ children: panel.message, color: 'red' }))
  return lines
}

function drawChallenge(ui, act, panel) {
  const wager = panel.wagersEnabled ? panel.wager : 0
  const heading = panel.handles.length > 1 ? `Free-for-all · ${panel.handles.length + 1} players: ${at(panel.handles)}` : `Challenge ${at(panel.handles)}`
  const cancel = ui.Button({ key: 'cancel', label: 'Cancel', onPress: () => act.close() })
  if (panel.step === 'confirm') {
    const lines = [`${heading} · ${panel.duration} · ${gold(wager)}`, ...(wager > CONFIRM_ABOVE ? [`You can lose ${gold(wager)}.`] : []), ...(wager === panel.gold ? [`All-in: ${gold(wager)} is your entire balance.`] : [])]
    return [...lines.map(line => ui.Text({ children: line })), ...footer(ui, panel),
      buttonsRow(ui, [ui.Button({ key: 'back', label: 'Back', onPress: () => act.press(choose({ step: 'edit' })) }), ui.Button({ key: 'send', label: `Send & stake ${commas(wager)}`, variant: 'primary', onPress: () => act.press(challengeStep) })])]
  }
  const durations = Object.keys(DURATIONS).map(key => choice(ui, `duration:${key}`, key, panel.duration === key, () => act.press(choose({ duration: key }))))
  const mode = wager > 0 ? ['Competitive · 1 energy', `You can lose ${gold(wager)}`] : ['Exhibition · no gold, no energy', 'Nothing at stake']
  return [ui.Text({ children: heading, bold: true }), row(ui, 'Duration', durations),
    ...(panel.wagersEnabled ? wagerRow(ui, act, panel, 'Wager', WAGERS, `/duel ${at(panel.handles)} ${panel.duration} <gold>`) : [row(ui, 'Wager', [ui.Text({ children: '0 · wagered duels are not open yet' })])]),
    row(ui, 'Mode', [ui.Text({ children: mode[0] })]), row(ui, '', [ui.Text({ children: mode[1], dimColor: true })]),
    ui.Text({ children: `Energy ${panel.energy.available}/${panel.energy.max} · ${gold(panel.gold)}`, dimColor: true }),
    ...footer(ui, panel), buttonsRow(ui, [cancel, ui.Button({ key: 'send', label: 'Send challenge', variant: 'primary', onPress: () => act.press(challengeStep) })])]
}

function drawGuildChallenge(ui, act, panel) {
  const heading = `Guild duel${panel.guild ? ` · ${panel.guild}` : ''} vs @${panel.slug} · 7 days`
  const cancel = ui.Button({ key: 'cancel', label: 'Cancel', onPress: () => act.close() })
  if (panel.step === 'confirm') {
    return [ui.Text({ children: `${heading} · ${panel.teamSize}v${panel.teamSize}` }), ui.Text({ children: `Each selected member stakes ${gold(panel.wager)} when they press Ready.` }), ...footer(ui, panel),
      buttonsRow(ui, [ui.Button({ key: 'back', label: 'Back', onPress: () => act.press(choose({ step: 'edit' })) }), ui.Button({ key: 'send', label: `Declare · ${commas(panel.wager)} each`, variant: 'primary', onPress: () => act.press(guildStep) })])]
  }
  const sizes = GUILD_SIZES.map(size => choice(ui, `size:${size}`, String(size), panel.teamSize === size, () => act.press(choose({ teamSize: size }))))
  const mode = panel.wager > 0 ? `Competitive · each member stakes ${gold(panel.wager)} · winners receive ${gold(panel.wager * 2)}` : 'Exhibition · no gold'
  return [ui.Text({ children: heading, bold: true }), row(ui, 'Team size', sizes), ...wagerRow(ui, act, panel, 'Stake', WAGERS, `/duel guild @${panel.slug} ${panel.teamSize} <gold>`),
    row(ui, 'Mode', [ui.Text({ children: mode })]), ...footer(ui, panel),
    buttonsRow(ui, [cancel, ui.Button({ key: 'send', label: 'Declare duel', variant: 'primary', onPress: () => act.press(guildStep) })])]
}

function drawConfirm(ui, act, panel) {
  return [ui.Text({ children: panel.title, bold: true }), ...panel.lines.map(line => ui.Text({ children: line })), ...footer(ui, panel),
    buttonsRow(ui, [ui.Button({ key: 'cancel', label: panel.cancelLabel, onPress: () => act.close() }),
      ui.Button({ key: 'confirm', label: panel.confirmLabel, variant: 'primary', onPress: () => act.press(current => ({ args: current.args })) })])]
}

const STATE = { selected: '○ selected', ready: '✓ ready', declined: '✗ declined' }

function drawRoster(ui, act, panel) {
  const duel = panel.duel ?? {}
  const id = duel.code ?? duel.id
  const you = duel.you ?? {}
  const sides = Array.isArray(duel.sides) ? duel.sides : []
  const ours = sides.find(side => side.side === you.side) ?? sides[0]
  const theirs = sides.find(side => side !== ours)
  const members = (ours?.roster ?? []).filter(member => member.state !== 'removed')
  const size = duel.teamSize ?? members.length
  const stake = duel.mode === 'competitive' ? `${gold(duel.wagerGold)} each` : 'exhibition'
  const send = args => () => act.press(run(args))
  const children = [ui.Text({ children: `Roster [${id}] · ${ours?.guild?.name ?? 'Your guild'} vs ${theirs?.guild?.name ?? 'rival'} · ${size}v${size} · ${stake}`, bold: true }),
    ui.Text({ children: `Ready ${ours?.readyCount ?? 0}/${size} — ${theirs?.readyCount ?? 0}/${size} · starts when both full rosters are ready`, dimColor: true })]
  if (!members.length) children.push(ui.Text({ children: 'No members selected yet.', dimColor: true }))
  for (const member of members) {
    const label = `${member.isYou ? 'You' : '@' + member.handle}`.padEnd(26) + (STATE[member.state] ?? member.state)
    children.push(ui.Box({ flexDirection: 'row', gap: 1, children: [ui.Text({ children: label }),
      ...(you.canEditRoster ? [ui.Button({ key: `remove:${member.handle}`, label: 'Remove', dimColor: true, onPress: send(`guild roster ${id} remove @${member.handle}`) })] : [])] }))
  }
  if (you.canEditRoster && members.length < size) {
    if (ui.Input) children.push(row(ui, 'Add', [ui.Input({ key: 'add', placeholder: '@handle', submitLabel: 'Add', onSubmit: value => act.press(addMember(id)(value)) })]))
    else children.push(ui.Text({ children: `Add: /duel guild roster ${id} add @handle`, dimColor: true }))
  }
  const confirm = you.confirm ?? {}
  const buttons = []
  if (you.canReady) buttons.push(ui.Button({ key: 'ready', label: confirm.lossGold || duel.wagerGold ? `Ready & stake ${commas(duel.wagerGold ?? 0)}` : 'Ready', variant: 'primary', onPress: send(`guild ready ${id}`) }))
  if (you.canUnready) buttons.push(ui.Button({ key: 'unready', label: 'Unready', onPress: send(`guild unready ${id}`) }))
  if (you.canDeclineSelection) buttons.push(ui.Button({ key: 'decline-selection', label: 'Decline selection', onPress: send(`guild decline-selection ${id}`) }))
  buttons.push(ui.Button({ key: 'close', label: 'Close', onPress: () => act.close() }))
  return [...children, ...footer(ui, panel), buttonsRow(ui, buttons)]
}

function drawResult(ui, act, panel) {
  return [...panel.text.split('\n').map(line => ui.Text({ children: line || ' ' })), buttonsRow(ui, [ui.Button({ key: 'close', label: 'Close', autoFocus: true, onPress: () => act.close() })])]
}

// `surface` is the render's: mobile draws no text field (its table maps Input
// to an empty box), so its panels offer the typed command instead.
export function drawDuelPanel(elements, panel, act, surface) {
  const ui = { Box: elements.Box, Text: elements.Text, Button: elements.Button, Input: surface === 'mobile' ? null : elements.Input }
  let children
  if (!panel) children = [ui.Text({ children: 'No duel in progress. Run /duel.', dimColor: true })]
  else if (panel.kind === 'challenge') children = drawChallenge(ui, act, panel)
  else if (panel.kind === 'guildChallenge') children = drawGuildChallenge(ui, act, panel)
  else if (panel.kind === 'confirm') children = drawConfirm(ui, act, panel)
  else if (panel.kind === 'roster') children = drawRoster(ui, act, panel)
  else children = drawResult(ui, act, panel)
  return ui.Box({ flexDirection: 'column', paddingX: 1, children })
}
