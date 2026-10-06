export type GuildbyteProgression = {
  localDay: string
  timeZone: string | null
  effectiveTokens: number
  nextThreshold: number | null
  streak?: { current: number; longest: number; multiplier: string }
  rewards: Record<'gold' | 'chest', { unlocked: boolean; claimed: boolean }>
  expiresAt: string
  league?: { division: string }
  leagueChange?: { id: string; kind: 'promotion' | 'demotion'; from: string; to: string }
  claimUrl: string
}

export type GuildbyteNotice =
  | { id: string; kind: 'reward'; reward: 'gold' | 'chest'; claimUrl: string }
  | { id: string; kind: 'promotion' | 'demotion'; from: string; to: string; claimUrl: string }
  | { id: string; kind: 'duel-request'; request: DuelRequestNotice }

export type GuildbyteStatus = {
  connected: boolean
  accountCount: number
  plan: string
  pending: number
  tokens: number
  prompts: number
  historyComplete: boolean
  character?: { id: string; png: string; animation?: { version: 1; frames: string[]; mirroredFrames?: Record<string,string>; clips: Record<string, {frames:number[]; durations:number[]}> } } | null
  player?: {handle:string;points:number} | null
  progression?: GuildbyteProgression | null
  progressionCached?: boolean
  notices?: GuildbyteNotice[]
  linkUrl?: string
  error?: string
  kiss?: {id:string;target:string;expiresAt:string}
  visit?: {id:string;name:string;guild:string|null;expiresAt:string;character:NonNullable<GuildbyteStatus['character']>} | null
  duel?: DuelCommandResult
}

// ---------- Duels: hand-written mirror of the app's lib/duel-contract.ts (plan §11) ----------
// Keep in sync by hand; the plugin has no build step to import the app's file.

// ---------- Vocabulary ----------

export type DuelMode = 'legacy' | 'competitive' | 'exhibition'
export type DuelEntry = 'named' | 'open' | 'public_link'
export type DuelStatus = 'proposed' | 'pending_setup' | 'active' | 'completed' | 'draw' | 'cancelled' | 'expired' | 'invalidated'
export type DuelEndedReason = 'time' | 'forfeit' | 'declined' | 'cancelled' | 'creator_left' | 'expired' | 'invalidated'
export type ParticipantRole = 'creator' | 'invitee' | 'joiner' | 'visitor'
export type ParticipantState = 'invited' | 'joined' | 'declined' | 'left' | 'forfeited'
export type EnergyState = 'none' | 'reserved' | 'consumed' | 'restored'
export type DuelOutcome = 'won' | 'lost' | 'draw' | 'forfeited' | 'void'

export type GuildDuelStatus = 'proposed' | 'rostering' | 'active' | 'completed' | 'draw' | 'cancelled' | 'expired' | 'invalidated'
export type GuildDuelEndedReason = 'time' | 'declined' | 'cancelled' | 'expired' | 'invalidated'
export type GuildSide = 'challenger' | 'defender'
export type RosterState = 'selected' | 'ready' | 'declined' | 'removed'
export type GuildDuelOutcome = 'won' | 'lost' | 'draw' | 'void'

/** Every error body. `setupUrl` accompanies 409 "Pair Guildbyte first" (D2/D16). */
export type DuelErrorResponse = { error: string; setupUrl?: string }

// ---------- Shared pieces ----------

/** The hero captured when the participant took the seat; the snapshot keeps history renderable after salvage. */
export type DuelHero = { characterId: string | null; bustUrl: string | null; archetype: string | null; rarity: string | null }

/** What the actor must confirm before staking (rule 13). `lossGold` is the value to echo as `confirmLoss`. */
export type ConfirmRequirement = {
  required: boolean
  lossGold: number | null
  allIn: boolean
  message: string | null
}

export type DuelEnergy = {
  available: number
  reserved: number
  max: 3
  /** When the next charge regenerates, or null at full capacity. ISO string. */
  nextAt: string | null
  price: number
  canPurchase: boolean
}

export type DuelRecord = { wins: number; losses: number; draws: number; winRate: number | null; currentStreak: number }
export type GuildDuelRecord = { wins: number; losses: number; draws: number }

// ---------- Player duels ----------

export type DuelParticipantView = {
  handle: string
  href: string
  seat: number
  role: ParticipantRole
  state: ParticipantState
  hero: DuelHero | null
  /** Fair base points as a 4-decimal string: provisional while active, final once settled. Null when hidden. */
  score: string | null
  rank: number | null
  outcome: DuelOutcome | null
  payoutGold: number
  /** Latest heartbeat across the participant's installations (D18). Participants only. */
  lastSyncedAt: string | null
  isYou: boolean
}

export type DuelYou = {
  seated: boolean
  canAccept: boolean
  canDecline: boolean
  canJoin: boolean
  canLeave: boolean
  canCancel: boolean
  canForfeit: boolean
  /** Battle Energy this action would reserve: 1 for competitive player duels, otherwise 0. */
  energyCost: number
  confirm: ConfirmRequirement
}

export type DuelSummary = {
  id: string
  code: string | null
  url: string
  rulesVersion: 1 | 2
  mode: DuelMode
  entry: DuelEntry
  status: DuelStatus
  endedReason: DuelEndedReason | null
  invalidatedReason: string | null
  capacity: number
  durationSeconds: number
  wagerGold: number
  potGold: number
  createdAt: string
  expiresAt: string | null
  startsAt: string | null
  endsAt: string | null
  /** When results settle: `endsAt` plus the 15-minute upload grace. */
  settlesAt: string | null
  settledAt: string | null
  /** True while scores are provisional (active and not yet settled). */
  provisional: boolean
  creator: string
  winner: string | null
  participants: DuelParticipantView[]
  you: DuelYou | null
  /** Open lobbies only, shown to the creator right after create. */
  joinUrl?: string
  /** Pending setup only: where the visitor pairs, returning to this duel. */
  setupUrl?: string
}

export type LobbyPreview = {
  id: string
  code: string | null
  status: DuelStatus
  mode: DuelMode
  creator: string
  participants: { handle: string; hero: DuelHero | null }[]
  capacity: number
  openSeats: number
  durationSeconds: number
  wagerGold: number
  potGold: number
  energyCost: number
  expiresAt: string | null
  /** Where the link redirects once the lobby started. */
  duelUrl: string
  /** Null when signed out; joining requires sign-in. */
  you: Pick<DuelYou, 'seated' | 'canJoin' | 'canLeave' | 'confirm'> | null
}

export type ChallengePreview = {
  creator: string
  hero: DuelHero | null
  durationSeconds: number
  rules: string
  activeCount: number
}

/** The player's own influencer link. `url` is only returned right after create or regenerate (only the hash is stored). */
export type DuelLink = { url: string | null; enabled: boolean; durationSeconds: number; activeCount: number }

export type DuelDashboard = {
  energy: DuelEnergy
  gold: number
  wagersEnabled: boolean
  requests: DuelSummary[]
  sent: DuelSummary[]
  lobbies: DuelSummary[]
  active: DuelSummary[]
  exhibitions: { activeCount: number; items: DuelSummary[]; nextCursor: string | null }
  recent: DuelSummary[]
  guild: { pending: GuildDuelSummary[]; active: GuildDuelSummary[] }
  record: DuelRecord
  badge: number
  webUrl: string
}

export type EnergyPurchaseResult = { energy: DuelEnergy; gold: number }

export type PlayerSearchRow = {
  handle: string
  href: string
  heroBustUrl: string | null
  division: string | null
  record: DuelRecord
  challengeable: boolean
  reason: 'privacy' | 'blocked' | 'self' | null
}
export type PlayerSearchPage = { rows: PlayerSearchRow[]; nextCursor: string | null }

export type DuelPrivacy = 'everyone' | 'friends' | 'nobody'
export type BlockedPlayer = { handle: string; href: string; since: string }

// ---------- Guild duels ----------

export type GuildRosterMemberView = {
  handle: string
  href: string
  state: RosterState
  hero: DuelHero | null
  /** This member's fair base points; visible to both guilds while active, public once settled. */
  contribution: string | null
  payoutGold: number
  lastSyncedAt: string | null
  isYou: boolean
}

export type GuildDuelSideView = {
  side: GuildSide
  guild: { id: string; name: string; slug: string }
  total: string | null
  outcome: GuildDuelOutcome | null
  readyCount: number
  roster: GuildRosterMemberView[]
}

export type GuildDuelYou = {
  side: GuildSide | null
  canAccept: boolean
  canDecline: boolean
  canCancel: boolean
  canEditRoster: boolean
  canReady: boolean
  canUnready: boolean
  canDeclineSelection: boolean
  confirm: ConfirmRequirement
}

export type GuildDuelSummary = {
  id: string
  code: string | null
  url: string
  rulesVersion: 1 | 2
  mode: DuelMode
  status: GuildDuelStatus
  endedReason: GuildDuelEndedReason | null
  invalidatedReason: string | null
  teamSize: number | null
  durationSeconds: number
  wagerGold: number
  potGold: number
  proposedAt: string
  expiresAt: string | null
  startsAt: string | null
  endsAt: string | null
  settlesAt: string | null
  settledAt: string | null
  provisional: boolean
  winner: GuildSide | null
  sides: [GuildDuelSideView, GuildDuelSideView]
  you: GuildDuelYou | null
}

export type GuildDuelDashboard = {
  guild: { id: string; name: string; slug: string }
  incoming: GuildDuelSummary[]
  outgoing: GuildDuelSummary[]
  rostering: GuildDuelSummary[]
  active: GuildDuelSummary[]
  history: GuildDuelSummary[]
  record: GuildDuelRecord
  canDeclare: boolean
  canRespond: boolean
}

// ---------- Heartbeat (additive; older servers omit it) ----------

export type DuelRequestKind = 'duel' | 'lobby' | 'guild_challenge' | 'guild_roster'
/** One open request from the heartbeat's `duels.requests`; the worker stores `webUrl` absolute. */
export type DuelRequestNotice = {
  id: string
  code: string | null
  kind: DuelRequestKind
  from: string
  durationSeconds: number
  wagerGold: number
  expiresAt: string | null
  webUrl: string
}
export type HeartbeatDuels = { badge: number; energy: DuelEnergy; requests: DuelRequestNotice[] }

// ---------- /duel worker results (scripts/duel-client.mjs) ----------

export type DuelCommandResult = { origin: string } & (
  | { kind: 'dashboard'; dashboard: DuelDashboard }
  | { kind: 'setup'; handles: string[]; dashboard: DuelDashboard }
  | { kind: 'view'; duel: DuelSummary }
  | { kind: 'created' | 'lobby' | 'accepted' | 'joined' | 'declined' | 'cancelled' | 'left' | 'forfeited'; duel: DuelSummary }
  | { kind: 'confirm'; action: 'challenge' | 'lobby' | 'accept' | 'guildReady' | 'guildChallenge'; command: string; wagerGold?: number; lossGold: number | null; allIn: boolean; message?: string | null }
  | { kind: 'confirm'; action: 'forfeit'; id: string }
  | { kind: 'preview'; token: string; preview: LobbyPreview }
  | { kind: 'energy' | 'energyConfirm'; energy: DuelEnergy }
  | { kind: 'energyBought'; result: EnergyPurchaseResult }
  | { kind: 'link'; link: DuelLink; regenerated?: boolean }
  | { kind: 'guildDashboard'; dashboard: GuildDuelDashboard }
  | { kind: 'guildSetup'; slug: string; dashboard: GuildDuelDashboard }
  | { kind: 'guildView' | 'guildRoster'; duel: GuildDuelSummary }
  | { kind: 'guildUpdated'; action: 'declare' | 'accept' | 'decline' | 'cancel' | 'add' | 'remove' | 'ready' | 'unready' | 'decline-selection'; handle?: string; duel: GuildDuelSummary }
  | { kind: 'error'; error: string; status?: number; setupUrl?: string }
)

// ---------- /duel panel (hooks/duel-panel.mjs) ----------

/** Shared by every panel: busy while the worker runs, `message` for the last error. */
export type DuelPanelBase = { link?: string; busy?: boolean; message?: string }
export type DuelPanel = DuelPanelBase & (
  | { kind: 'challenge'; handles: string[]; duration: '1h' | '6h' | '1d' | '3d' | '7d'; wager: number; custom: boolean; step: 'edit' | 'confirm'
      gold: number; wagersEnabled: boolean; energy: { available: number; max: number } }
  | { kind: 'guildChallenge'; slug: string; guild: string | null; teamSize: number; wager: number; custom: boolean; step: 'edit' | 'confirm' }
  | { kind: 'confirm'; title: string; lines: string[]; cancelLabel: string; confirmLabel: string; args: string }
  | { kind: 'roster'; duel: GuildDuelSummary }
  | { kind: 'result'; title: string; text: string }
)

declare module 'claude-code' {
  interface PluginState {
    guildbyte: { status: GuildbyteStatus; progression: GuildbyteProgression | null; chest: number; duelPanel: DuelPanel | null; motion: { frame: number; state: string; offset: number; facing: 'left'|'right';visit?:{id:string;frame:number;state:string;offset:number;facing:string} } }
  }
}
