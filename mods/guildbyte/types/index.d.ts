export type GuildbyteStatus = {
  connected: boolean
  accountCount: number
  plan: string
  pending: number
  tokens: number
  prompts: number
  historyComplete: boolean
  character?: { id: string; png: string; heroId?:string; level?:number; animation?: { version: 1; frames: string[]; mirroredFrames?: Record<string,string>; clips: Record<string, {frames:number[]; durations:number[]}> } } | null
  player?: {handle:string;points:number} | null
  levelUp?: {id:string;heroId:string;version:1;fromLevel:number;toLevel:number;renderScale?:1|1.5;frames:string[];durations:number[];durationMs:number}
  linkUrl?: string
  error?: string
  kiss?: {id:string;target:string;expiresAt:string}
  visit?: {id:string;name:string;guild:string|null;expiresAt:string;character:NonNullable<GuildbyteStatus['character']>} | null
}

declare module 'claude-code' {
  interface PluginState {
    guildbyte: { status: GuildbyteStatus; motion: { frame: number; state: string; offset: number; facing: 'left'|'right';visit?:{id:string;frame:number;state:string;offset:number;facing:string} } }
  }
}
