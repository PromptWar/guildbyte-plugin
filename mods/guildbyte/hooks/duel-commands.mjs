import { formatDuelReply, formatUsage, parseDuelCommand } from '../scripts/duel-format.mjs'

export const DUEL_COMMAND = {
  name: 'duel',
  argumentHint: '[@handle <duration> <wager> | view|accept|decline|cancel|leave|forfeit <code> | lobby | join | energy | link]',
  description: 'Challenge Guildbyte players and manage your duels',
  immediate: true,
}

// Typed /duel commands. Usage errors answer locally; everything else runs in the
// worker, which re-parses the raw arguments before calling the app.
export function registerDuelCommands(on, worker) {
  on('command.run', { command: 'duel' }, async ($, e) => {
    const args = String(e.args ?? '').trim()
    const command = parseDuelCommand(args)
    if (command.kind === 'usage') return { text: formatUsage(command) }
    const status = await worker($, 'duel', undefined, args)
    return { text: status?.duel ? formatDuelReply(status.duel) : status?.error ?? 'Guildbyte is syncing. Try /duel again in a moment.' }
  })
}
