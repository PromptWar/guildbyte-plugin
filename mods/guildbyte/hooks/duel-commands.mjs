import { formatUsage, parseDuelCommand } from '../scripts/duel-format.mjs'

export const DUEL_COMMAND = {
  name: 'duel',
  argumentHint: '[@handle <duration> <wager> | view|accept|decline|cancel|leave|forfeit <code> | lobby | join | energy | link | guild …]',
  description: 'Challenge Guildbyte players and guilds and manage your duels',
  immediate: true,
}

// /duel routing helpers. The command hook itself lives in register.mjs, next
// to the worker, because the engine follows `$` only within one file. Usage
// errors answer locally; everything else runs in the worker, which re-parses
// the raw arguments before calling the app.
export function duelUsage(args) {
  const command = parseDuelCommand(args)
  return command.kind === 'usage' ? formatUsage(command) : null
}

export const duelFailure = status => status?.error ?? 'Guildbyte is syncing. Try /duel again in a moment.'
