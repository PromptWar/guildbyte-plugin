// The app's progression snapshot is authoritative: thresholds, multiplier,
// timezone, rewards and expiry all come from the server. This module only
// validates, sanitizes and formats it. Pure JavaScript: the worker (Node) and
// the mod (no Node) both import it.

export const REWARDS = ['gold', 'chest']
export const DEFAULT_CLAIM_PATH = '/leaderboard'
const MAX_AHEAD = 48 * 3600000
const isUuid = value => typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value)
const count = value => Number.isSafeInteger(value) && value >= 0
const label = value => typeof value === 'string' && value.length <= 40 && !/[\x00-\x1f\x7f-\x9f]/.test(value) && value.trim() ? value.trim() : null

function localDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null
}

// Same-origin relative paths only; anything else falls back to the default.
export function claimPath(value) {
  if (typeof value !== 'string' || value.length > 200 || !/^\/(?![/\\])[\x21-\x7e]*$/.test(value) || value.includes('\\')) return DEFAULT_CLAIM_PATH
  try {
    const url = new URL(value, 'https://guildbyte.invalid')
    return url.origin === 'https://guildbyte.invalid' ? url.pathname + url.search + url.hash : DEFAULT_CLAIM_PATH
  } catch { return DEFAULT_CLAIM_PATH }
}

// Returns a sanitized snapshot or null. localDay, effectiveTokens and a
// near-future expiresAt are required; every other field degrades silently.
export function validateProgression(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const day = localDay(value.localDay)
  const expires = typeof value.expiresAt === 'string' ? Date.parse(value.expiresAt) : NaN
  if (!day || !count(value.effectiveTokens) || !Number.isFinite(expires) || expires <= now || expires > now + MAX_AHEAD) return null
  const rewards = {}
  for (const reward of REWARDS) {
    const state = value.rewards?.[reward]
    rewards[reward] = state && typeof state.unlocked === 'boolean' && typeof state.claimed === 'boolean'
      ? { unlocked: state.unlocked, claimed: state.claimed } : { unlocked: false, claimed: false }
  }
  const snapshot = {
    localDay: day,
    timeZone: typeof value.timeZone === 'string' && value.timeZone.length <= 64 && /^[A-Za-z][A-Za-z0-9_+\-]*(?:\/[A-Za-z0-9_+\-]+)*$/.test(value.timeZone) ? value.timeZone : null,
    effectiveTokens: value.effectiveTokens,
    nextThreshold: count(value.nextThreshold) && value.nextThreshold > 0 ? value.nextThreshold : null,
    rewards,
    expiresAt: new Date(expires).toISOString(),
    claimPath: claimPath(value.claimUrl),
  }
  const streak = value.streak
  if (streak && count(streak.current) && count(streak.longest) && typeof streak.multiplier === 'string' && /^\d{1,2}\.\d{3}$/.test(streak.multiplier))
    snapshot.streak = { current: streak.current, longest: streak.longest, multiplier: streak.multiplier }
  const division = label(value.league?.division)
  if (division) snapshot.league = { division }
  const change = value.leagueChange
  if (change && isUuid(change.id) && ['promotion', 'demotion'].includes(change.kind) && label(change.from) && label(change.to))
    snapshot.leagueChange = { id: change.id.toLowerCase(), kind: change.kind, from: label(change.from), to: label(change.to) }
  return snapshot
}

// The newest local day wins; within a day the later expiry wins and the most
// recent response replaces an equal one.
export function isNewer(next, cached, now = Date.now()) {
  if (!cached || Date.parse(cached.expiresAt) <= now) return true
  if (next.localDay !== cached.localDay) return next.localDay > cached.localDay
  return Date.parse(next.expiresAt) >= Date.parse(cached.expiresAt)
}

export const fresh = (snapshot, now = Date.now()) => snapshot && Date.parse(snapshot.expiresAt) > now ? snapshot : null
export const claimable = snapshot => snapshot ? REWARDS.filter(reward => snapshot.rewards[reward].unlocked && !snapshot.rewards[reward].claimed) : []
// The gauge shows one reward icon: a claimable chest replaces the gold coin.
export const rewardIcon = snapshot => {
  const rewards = claimable(snapshot)
  return rewards.includes('chest') ? 'chest' : rewards.includes('gold') ? 'gold' : null
}

// Only what the gauge draws: a change here is a visible change.
export function visibleSignature(snapshot) {
  if (!snapshot) return 'none'
  return JSON.stringify([snapshot.localDay, compactTokens(snapshot.effectiveTokens), snapshot.nextThreshold, gaugeBar(snapshot),
    snapshot.streak?.current, snapshot.streak?.multiplier, claimable(snapshot), snapshot.league?.division, snapshot.claimUrl])
}

export function compactTokens(value) {
  if (value >= 1e9) return `${Math.floor(value / 1e8) / 10}B`
  if (value >= 1e6) return `${Math.floor(value / 1e5) / 10}M`
  if (value >= 1e3) return `${Math.floor(value / 100) / 10}K`
  return String(value)
}

export function gaugeBar(snapshot, width = 10) {
  const filled = snapshot.nextThreshold ? Math.min(width, Math.floor(snapshot.effectiveTokens * width / snapshot.nextThreshold)) : width
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

export function gaugeText(snapshot) {
  const target = snapshot.nextThreshold ? `${compactTokens(snapshot.effectiveTokens)}/${compactTokens(snapshot.nextThreshold)}` : compactTokens(snapshot.effectiveTokens)
  return `Daily ${gaugeBar(snapshot)} ${target}${snapshot.streak ? ` · streak ${snapshot.streak.current} ×${snapshot.streak.multiplier}` : ''}`
}

const grouped = value => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

// Formats the worker's status output: `progression` is the cached snapshot
// (null once expired) and `progressionCached` says whether one ever arrived.
export function statusReport(status, now = Date.now()) {
  if (!status?.connected) return 'Guildbyte: not connected. Run /guildbyte-connect; activity counts from the moment this session is paired.'
  const current = fresh(status.progression, now)
  if (!current) return status.progressionCached
    ? 'Guildbyte: today\'s progression has not synced yet. It appears after your next synced activity.'
    : 'Guildbyte: no progression yet. It appears after your next synced activity.'
  const rewards = REWARDS.map(reward => {
    const state = current.rewards[reward]
    return `${reward} ${state.claimed ? 'claimed' : state.unlocked ? 'ready to claim' : 'locked'}`
  }).join(' · ')
  return [
    `Guildbyte · ${current.localDay}${current.timeZone ? ` (${current.timeZone})` : ''}`,
    `Daily gauge: ${grouped(current.effectiveTokens)} effective tokens${current.nextThreshold ? ` · next ${grouped(current.nextThreshold)}` : ' · every reward reached'}`,
    ...(current.streak ? [`Streak: ${current.streak.current} days (best ${current.streak.longest}) · ×${current.streak.multiplier}`] : []),
    ...(current.league ? [`League: ${current.league.division}`] : []),
    `Rewards: ${rewards}`,
    claimable(current).length
      ? `Claim in the web app before ${current.expiresAt}: ${current.claimUrl}`
      : `Resets at ${current.expiresAt}.`,
  ].join('\n')
}

export function noticeText(notice) {
  if (notice.kind === 'reward') return `Daily ${notice.reward} unlocked. Claim it in Guildbyte before local midnight: ${notice.claimUrl}`
  if (notice.kind === 'promotion') return `★ Promoted to ${notice.to}! ★ See your league in Guildbyte: ${notice.claimUrl}`
  return `League update: now ${notice.to}.`
}
