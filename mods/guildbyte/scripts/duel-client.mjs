// Worker-side /duel calls. `api` sends authenticated requests to the configured
// app ({get, post, put}); each command makes at most one read and one write.
// The server decides eligibility, confirmations and outcomes; reads before a
// write exist only to show the player what they are about to confirm.
import { CONFIRM_ABOVE, ENERGY_PRICE, parseDuelCommand } from './duel-format.mjs'

const path = id => `/api/duels/${encodeURIComponent(id)}`
const guildPath = id => `/api/guild-duels/${encodeURIComponent(id)}`

// Optional confirmation fields: sent only when the player typed the token.
function confirmations(command, lossGold) {
  return { ...(command.confirm && lossGold ? { confirmLoss: lossGold } : {}), ...(command.allIn ? { confirmAllIn: true } : {}) }
}

// Challenge or lobby creation. The balance comes from the dashboard so that
// `all` resolves to the server's figure and the loss prompt shows before staking.
async function create(command, api, requestId) {
  const dashboard = await api.get('/api/duels/me')
  const balance = Number.isSafeInteger(dashboard?.gold) ? dashboard.gold : 0
  const wagerGold = command.wager === 'all' ? balance : command.wager
  if (command.wager === 'all' && !wagerGold) return { kind: 'error', error: 'You have no gold to wager. Use 0 for an exhibition.' }
  const lossGold = wagerGold > CONFIRM_ABOVE ? wagerGold : null
  const allIn = wagerGold > 0 && wagerGold === balance
  if (lossGold && !command.confirm || allIn && !command.allIn) {
    const raw = command.wager === 'all' ? command.raw.replace(/ all$/, ` ${wagerGold}`) : command.raw
    return { kind: 'confirm', action: command.kind, command: raw, wagerGold, lossGold, allIn }
  }
  const body = { durationSeconds: command.durationSeconds, wagerGold, requestId, ...confirmations(command, lossGold) }
  if (command.kind === 'lobby') return { kind: 'lobby', duel: await api.post('/api/duels/lobbies', { capacity: command.capacity, ...body }) }
  return { kind: 'created', duel: await api.post('/api/duels', { opponents: command.handles, ...body }) }
}

// Accept and join read the server's own confirmation requirement first.
function missingConfirmation(command, confirm) {
  return confirm?.required && (confirm.lossGold && !command.confirm || confirm.allIn && !command.allIn)
}

async function dispatch(command, api, requestId) {
  switch (command.kind) {
    case 'dashboard': return { kind: 'dashboard', dashboard: await api.get('/api/duels/me') }
    case 'setup': return { kind: 'setup', handles: command.handles, dashboard: await api.get('/api/duels/me') }
    case 'view': return { kind: 'view', duel: await api.get(path(command.id)) }
    case 'challenge': case 'lobby': return create(command, api, requestId)
    case 'accept': {
      const duel = await api.get(path(command.id))
      const confirm = duel?.you?.confirm
      if (missingConfirmation(command, confirm)) {
        return { kind: 'confirm', action: 'accept', command: `accept ${command.id}`, lossGold: confirm.lossGold, allIn: confirm.allIn, message: confirm.message }
      }
      return { kind: 'accepted', duel: await api.post(`${path(command.id)}/accept`, confirmations(command, confirm?.lossGold)) }
    }
    case 'decline': case 'cancel': case 'leave': {
      const kind = { decline: 'declined', cancel: 'cancelled', leave: 'left' }[command.kind]
      return { kind, duel: await api.post(`${path(command.id)}/${command.kind}`, {}) }
    }
    case 'forfeit':
      if (!command.confirm) return { kind: 'confirm', action: 'forfeit', id: command.id }
      return { kind: 'forfeited', duel: await api.post(`${path(command.id)}/forfeit`, { confirm: true }) }
    case 'join': {
      const route = `/api/duels/join/${encodeURIComponent(command.token)}`
      const preview = await api.get(route)
      const confirm = preview?.you?.confirm
      if (!command.confirm || preview?.status !== 'proposed' || missingConfirmation(command, confirm)) return { kind: 'preview', token: command.token, preview }
      return { kind: 'joined', duel: await api.post(route, confirmations(command, confirm?.lossGold)) }
    }
    case 'energy': return { kind: 'energy', energy: await api.get('/api/duels/energy') }
    case 'energyBuy':
      if (!command.confirm) return { kind: 'energyConfirm', energy: await api.get('/api/duels/energy') }
      return { kind: 'energyBought', result: await api.post('/api/duels/energy/purchase', { requestId, expectedGold: ENERGY_PRICE }) }
    case 'link': return { kind: 'link', link: await api.get('/api/duels/link') }
    case 'linkUpdate': {
      const current = await api.get('/api/duels/link')
      const link = await api.put('/api/duels/link', { enabled: command.enabled ?? current?.enabled ?? true, durationSeconds: command.durationSeconds ?? current?.durationSeconds })
      return { kind: 'link', link }
    }
    case 'linkRegenerate': return { kind: 'link', link: await api.post('/api/duels/link/regenerate', {}), regenerated: true }
    case 'guildDashboard': return { kind: 'guildDashboard', dashboard: await api.get('/api/guild-duels/me') }
    case 'guildSetup': return { kind: 'guildSetup', slug: command.slug, dashboard: await api.get('/api/guild-duels/me') }
    case 'guildChallenge': {
      // Every selected member stakes this amount at Ready; the declarer confirms large stakes up front.
      if (command.wager > CONFIRM_ABOVE && !command.confirm) {
        return { kind: 'confirm', action: 'guildChallenge', command: command.raw, wagerGold: command.wager, lossGold: command.wager, allIn: false,
          message: `Each selected member stakes ${command.wager} gold when they press Ready.` }
      }
      const duel = await api.post('/api/guild-duels', { opponentGuild: command.slug, teamSize: command.teamSize, wagerGold: command.wager, requestId })
      return { kind: 'guildUpdated', action: 'declare', duel }
    }
    case 'guildView': return { kind: 'guildView', duel: await api.get(guildPath(command.id)) }
    case 'guildRosterView': return { kind: 'guildRoster', duel: await api.get(guildPath(command.id)) }
    case 'guildRoster':
      return { kind: 'guildUpdated', action: command.action, handle: command.handle, duel: await api.post(`${guildPath(command.id)}/roster`, { action: command.action, handle: command.handle }) }
    case 'guildReady': {
      const duel = await api.get(guildPath(command.id))
      const confirm = duel?.you?.confirm
      if (missingConfirmation(command, confirm)) {
        return { kind: 'confirm', action: 'guildReady', command: `guild ready ${command.id}`, lossGold: confirm.lossGold, allIn: confirm.allIn, message: confirm.message }
      }
      return { kind: 'guildUpdated', action: 'ready', duel: await api.post(`${guildPath(command.id)}/ready`, confirmations(command, confirm?.lossGold)) }
    }
    case 'guildAccept': case 'guildDecline': case 'guildCancel': case 'guildUnready': case 'guildDeclineSelection': {
      const action = { guildAccept: 'accept', guildDecline: 'decline', guildCancel: 'cancel', guildUnready: 'unready', guildDeclineSelection: 'decline-selection' }[command.kind]
      return { kind: 'guildUpdated', action, duel: await api.post(`${guildPath(command.id)}/${action}`, {}) }
    }
    default: return { kind: 'error', error: 'Unknown /duel command. Run /duel help.' }
  }
}

// Runs the raw `/duel` arguments. HTTP failures become an `error` result that
// keeps the server's message and setup link; network failures propagate.
export async function runDuelCommand(args, api, requestId) {
  const command = parseDuelCommand(args)
  if (command.kind === 'usage') return { kind: 'error', error: command.error ?? 'Run /duel help.' }
  try { return await dispatch(command, api, requestId) }
  catch (failure) {
    if (!Number.isInteger(failure?.status)) throw failure
    if (failure.status === 401) return { kind: 'error', error: 'Guildbyte: your connection expired. Run /guildbyte-connect, then try again.' }
    const missing = command.kind.startsWith('guild') ? ': guild duel not found, you have no guild, or this server has no guild duels yet' : ': duel not found, or this server has no Duels yet'
    const error = failure.detail ? failure.message : `Guildbyte returned ${failure.status}${failure.status === 404 ? missing : ''}.`
    return { kind: 'error', status: failure.status, error, ...(failure.setupUrl ? { setupUrl: failure.setupUrl } : {}) }
  }
}
