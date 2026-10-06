import assert from 'node:assert/strict'
import { validateProgression, isNewer, claimPath, claimable, rewardIcon, compactTokens, gaugeText, statusReport, noticeText, visibleSignature, DEFAULT_CLAIM_PATH } from '../scripts/progression.mjs'

const now = Date.parse('2026-10-05T12:00:00.000Z')
// The documented sync contract (plan section 2.4) plus the approved league fields.
const contract = {
  localDay: '2026-10-05',
  timeZone: 'Europe/Paris',
  effectiveTokens: 8200000,
  streak: { current: 4, longest: 9, multiplier: '1.020' },
  rewards: { gold: { unlocked: true, claimed: false }, chest: { unlocked: false, claimed: false } },
  nextThreshold: 15000000,
  expiresAt: '2026-10-05T22:00:00.000Z',
}

// Valid payloads keep exactly the known fields.
const parsed = validateProgression({ ...contract, unknownField: 'ignored', league: { division: 'Gold II' } }, now)
assert.deepEqual(parsed, { ...contract, claimPath: DEFAULT_CLAIM_PATH, league: { division: 'Gold II' } })
assert.equal(validateProgression({ ...contract, nextThreshold: null }, now).nextThreshold, null)

// Rejection: required fields, impossible dates, unsafe counts and stale or far-future expiry.
for (const broken of [null, 'progression', [], {}, { ...contract, localDay: undefined }, { ...contract, localDay: '2026-02-30' },
  { ...contract, localDay: '05/10/2026' }, { ...contract, effectiveTokens: -1 }, { ...contract, effectiveTokens: 1.5 },
  { ...contract, effectiveTokens: '8200000' }, { ...contract, effectiveTokens: Number.MAX_SAFE_INTEGER + 1 },
  { ...contract, expiresAt: 'tomorrow' }, { ...contract, expiresAt: '2026-10-05T11:59:59.000Z' }, { ...contract, expiresAt: '2026-10-08T00:00:00.000Z' }])
  assert.equal(validateProgression(broken, now), null, JSON.stringify(broken))

// Sanitization: optional fields that do not match degrade silently instead of rejecting the snapshot.
const degraded = validateProgression({ ...contract, timeZone: 'Europe/Paris\u001b[31m', streak: { current: 4, longest: 9, multiplier: 1.02 },
  rewards: { gold: { unlocked: 'yes', claimed: false } }, nextThreshold: -5,
  league: { division: '\u001b[2JGold II' }, leagueChange: { id: 'not-a-uuid', kind: 'promotion', from: 'Silver I', to: 'Gold II' } }, now)
assert.equal(degraded.timeZone, null)
assert.equal(degraded.streak, undefined)
assert.deepEqual(degraded.rewards, { gold: { unlocked: false, claimed: false }, chest: { unlocked: false, claimed: false } })
assert.equal(degraded.nextThreshold, null)
assert.equal(degraded.league, undefined)
assert.equal(degraded.leagueChange, undefined)
assert.equal(validateProgression({ ...contract, leagueChange: { id: 'A5928DE2-75F4-4E84-BFFF-18C392DBAF89', kind: 'sideways', from: 'a', to: 'b' } }, now).leagueChange, undefined)
assert.deepEqual(validateProgression({ ...contract, leagueChange: { id: 'A5928DE2-75F4-4E84-BFFF-18C392DBAF89', kind: 'demotion', from: 'Gold III', to: 'Silver I' } }, now).leagueChange,
  { id: 'a5928de2-75f4-4e84-bfff-18c392dbaf89', kind: 'demotion', from: 'Gold III', to: 'Silver I' })

// Claim links stay on the app's origin.
for (const unsafe of ['https://evil.example/claim', '//evil.example/claim', '/\\evil.example', 'javascript:alert(1)', '/claim\n', '/claim path', 42, '/' + 'a'.repeat(250)])
  assert.equal(claimPath(unsafe), DEFAULT_CLAIM_PATH, String(unsafe))
assert.equal(claimPath('/leaderboard?tab=me#gauge'), '/leaderboard?tab=me#gauge')
assert.equal(claimPath('/a/../chests'), '/chests')

// Newest local day wins; within a day the later expiry or the newest equal response wins.
const today = validateProgression(contract, now)
const tomorrow = { ...today, localDay: '2026-10-06', expiresAt: '2026-10-06T22:00:00.000Z' }
assert(isNewer(tomorrow, today, now))
assert(!isNewer(today, tomorrow, now))
assert(isNewer({ ...today, effectiveTokens: 9000000 }, today, now))
assert(isNewer(today, { ...today, expiresAt: '2026-10-05T11:00:00.000Z' }, now), 'An expired cache never blocks a fresh snapshot')

// Display: server thresholds only, floored compact numbers.
assert.equal(compactTokens(999), '999')
assert.equal(compactTokens(8299999), '8.2M')
assert.equal(compactTokens(1500), '1.5K')
assert.equal(gaugeText(today), 'Daily ▰▰▰▰▰▱▱▱▱▱ 8.2M/15M · streak 4 ×1.020')
assert.equal(gaugeText({ ...today, nextThreshold: null, streak: undefined }), 'Daily ▰▰▰▰▰▰▰▰▰▰ 8.2M')
assert.deepEqual(claimable(today), ['gold'])
assert.deepEqual(claimable({ ...today, rewards: { gold: { unlocked: true, claimed: true }, chest: { unlocked: true, claimed: false } } }), ['chest'])
// One gauge icon: the coin until the chest is claimable, then the chest replaces it.
assert.equal(rewardIcon(today), 'gold')
assert.equal(rewardIcon({ ...today, rewards: { gold: { unlocked: true, claimed: false }, chest: { unlocked: true, claimed: false } } }), 'chest')
assert.equal(rewardIcon({ ...today, rewards: { gold: { unlocked: true, claimed: true }, chest: { unlocked: true, claimed: false } } }), 'chest')
assert.equal(rewardIcon({ ...today, rewards: { gold: { unlocked: true, claimed: false }, chest: { unlocked: true, claimed: true } } }), 'gold')
assert.equal(rewardIcon({ ...today, rewards: { gold: { unlocked: true, claimed: true }, chest: { unlocked: true, claimed: true } } }), null)
assert.equal(rewardIcon(null), null)
assert.equal(visibleSignature({ ...today, effectiveTokens: 8200001 }), visibleSignature(today), 'Invisible token changes keep the signature')
assert.notEqual(visibleSignature({ ...today, effectiveTokens: 8300000 }), visibleSignature(today))
assert.equal(visibleSignature(null), 'none')

// Status output.
const status = { connected: true, progressionCached: true, progression: { ...today, league: { division: 'Gold II' }, claimUrl: 'http://localhost:3000/leaderboard' } }
assert.equal(statusReport(status, now), [
  'Guildbyte · 2026-10-05 (Europe/Paris)',
  'Daily gauge: 8,200,000 effective tokens · next 15,000,000',
  'Streak: 4 days (best 9) · ×1.020',
  'League: Gold II',
  'Rewards: gold ready to claim · chest locked',
  'Claim in the web app before 2026-10-05T22:00:00.000Z: http://localhost:3000/leaderboard',
].join('\n'))
assert.match(statusReport({ ...status, progression: { ...status.progression, rewards: { gold: { unlocked: true, claimed: true }, chest: { unlocked: false, claimed: false } } } }, now), /gold claimed · chest locked\nResets at /)
assert.match(statusReport(status, Date.parse('2026-10-05T22:00:00.000Z')), /has not synced yet/, 'An expired snapshot is not shown')
assert.match(statusReport({ connected: true, progression: null, progressionCached: false }, now), /no progression yet/)
assert.match(statusReport({ connected: false }, now), /guildbyte-connect/)

// Promotion is celebratory, demotion subdued; reward notices link to the app and never claim.
const promotion = noticeText({ kind: 'promotion', from: 'Silver I', to: 'Gold II', claimUrl: 'http://localhost:3000/leaderboard' })
const demotion = noticeText({ kind: 'demotion', from: 'Gold III', to: 'Silver I', claimUrl: 'http://localhost:3000/leaderboard' })
assert.match(promotion, /★ Promoted to Gold II! ★/)
assert.equal(demotion, 'League update: now Silver I.')
assert(!/[!★]/.test(demotion))
assert.equal(noticeText({ kind: 'reward', reward: 'chest', claimUrl: 'http://localhost:3000/leaderboard' }),
  'Daily chest unlocked. Claim it in Guildbyte before local midnight: http://localhost:3000/leaderboard')
console.log('Progression checks passed: validation, sanitization, claim links, ordering, display, reward icon, status and notice tone')
