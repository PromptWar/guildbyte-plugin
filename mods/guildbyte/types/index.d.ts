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
}

declare module 'claude-code' {
  interface PluginState {
    guildbyte: { status: GuildbyteStatus; progression: GuildbyteProgression | null; chest: number; motion: { frame: number; state: string; offset: number; facing: 'left'|'right';visit?:{id:string;frame:number;state:string;offset:number;facing:string} } }
  }
}
