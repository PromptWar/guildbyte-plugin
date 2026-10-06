import { describe, expect, test, mock } from 'claude-code/testing'

const claimUrl = 'http://localhost:3000/leaderboard'
const progression = (overrides: Record<string, unknown> = {}) => ({
  localDay: '2026-10-05', timeZone: 'Europe/Paris', effectiveTokens: 8200000, nextThreshold: 15000000,
  streak: { current: 4, longest: 9, multiplier: '1.020' },
  rewards: { gold: { unlocked: true, claimed: false }, chest: { unlocked: true, claimed: false } },
  expiresAt: new Date(Date.now() + 3600000).toISOString(), claimUrl, ...overrides,
})
const props = { hasSurvey: false, bodyColumns: 140, maxRows: 5 }
const start = { surface: 'terminal', isInteractive: true, cwd: '/work' } as any

function harness(on: any, env: Record<string, string>, settings: Record<string, unknown> = {}) {
  const clock = mock.clock(on)
  mock.env(on, env)
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'a5928de2-75f4-4e84-bfff-18c392dbaf89' }))
  on('session.usage', () => ({ value: { context: { window: 200000 }, rateLimits: [] } }))
  on('command.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: settings }))
  const toasts: string[] = []
  on('ui.toast', ($: any, e: any) => { toasts.push(e.text); return { value: undefined } })
  const world = { status: { connected: true, pending: 0, player: { handle: 'paul_1a2b3c4d', points: 12345 } } as Record<string, unknown>, actions: [] as string[], inputs: [] as any[] }
  on('process.run', ($: any, e: any) => {
    const input = JSON.parse(e.init?.stdin ?? '{}')
    world.actions.push(input.action);world.inputs.push(input)
    return { value: { exitCode: 0, stdout: JSON.stringify(world.status), stderr: '' } }
  })
  return { clock, toasts, world }
}

describe('Guildbyte daily gauge', () => {
  test('renders the cached gauge at session start, links to the app, and notifies once', async ($, on) => {
    const { clock, toasts, world } = harness(on, { TERM_PROGRAM: 'Orca', TERM: 'xterm-256color' })
    world.status = { ...world.status, progression: progression(), progressionCached: true,
      notices: [{ id: '2026-10-05:gold', kind: 'reward', reward: 'gold', claimUrl }] }
    await $.session.start(start)
    const ui = await $.ui.mount({ plugin: 'guildbyte', surface: 'terminal', component: 'AbovePrompt', props } as any)
    expect(await ui.find({ type: 'Text', text: /Daily ▰▰▰▰▰▱▱▱▱▱ 8\.2M\/15M · streak 4 ×1\.020/ })).toBeDefined()
    // A claimable chest replaces the coin rather than sitting beside it.
    expect(await ui.find({ type: 'Text', text: '◉ gold' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '▄▄' })).toBeDefined()
    expect((await ui.find({ type: 'Link' }))?.props).toMatchObject({ href: claimUrl, label: 'Claim in Guildbyte ↗' })
    expect(await ui.find({ type: 'Text', text: '● @paul_1a2b3c4d · 12,345 pts · capturing' })).toBeDefined()
    expect((await ui.find({ type: 'Box' }))?.props).toMatchObject({ height: 2 })
    expect(toasts).toEqual([`Daily gold unlocked. Claim it in Guildbyte before local midnight: ${claimUrl}`])

    // The chest hops while claimable.
    await clock.advance(500)
    expect(await ui.find({ type: 'Text', text: '▀▀' })).toBeDefined()
    await clock.advance(500)
    expect(await ui.find({ type: 'Text', text: '▄▄' })).toBeDefined()

    // Unchanged visible state: later syncs bring no notice and no new toast.
    world.status = { ...world.status, notices: undefined, progression: progression({ effectiveTokens: 8200001 }) }
    await clock.advance(10000)
    expect(toasts.length).toBe(1)
    expect(await ui.find({ type: 'Text', text: /8\.2M\/15M/ })).toBeDefined()

    // A visible change redraws; a claimed reward disappears, the other stays until claimed.
    world.status = { ...world.status, progression: progression({ effectiveTokens: 9100000, rewards: { gold: { unlocked: true, claimed: true }, chest: { unlocked: true, claimed: false } } }) }
    await clock.advance(10000)
    expect(await ui.find({ type: 'Text', text: /9\.1M\/15M/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '◉ gold' })).toBeUndefined()
    expect(await ui.find({ type: 'Link' })).toBeDefined()

    // Local-day expiry: the worker returns no snapshot, every icon and the link clear.
    world.status = { ...world.status, progression: null }
    await clock.advance(10000)
    expect(await ui.find({ type: 'Text', text: /Daily/ })).toBeUndefined()
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
    expect((await ui.find({ type: 'Box' }))?.props).toMatchObject({ height: 1 })
    await ui.unmount()
  })

  test('celebrates promotions, keeps demotions subdued, and reports status from the cache', async ($, on) => {
    const { clock, toasts, world } = harness(on, { TERM_PROGRAM: 'Orca', TERM: 'xterm-256color' })
    world.status = { ...world.status, progression: progression({ league: { division: 'Gold II' } }), progressionCached: true,
      notices: [{ id: 'league:a', kind: 'promotion', from: 'Silver I', to: 'Gold II', claimUrl }] }
    await $.session.start(start)
    expect(toasts).toEqual([`★ Promoted to Gold II! ★ See your league in Guildbyte: ${claimUrl}`])
    // Only the session-start sync asks the worker for queued demotions; later syncs and status do not.
    expect(world.inputs.map(input => input.sessionStart ?? false)).toEqual([true])
    world.status = { ...world.status, notices: undefined }
    await clock.advance(10000)
    expect(world.inputs.at(-1).sessionStart).toBeUndefined()

    // The next session start delivers the queued demotion quietly.
    world.status = { ...world.status, notices: [{ id: 'league:b', kind: 'demotion', from: 'Gold II', to: 'Silver I', claimUrl }] }
    await $.session.start(start)
    expect(world.inputs.at(-1)).toMatchObject({ action: 'sync', sessionStart: true })
    expect(toasts[1]).toBe('League update: now Silver I.')

    world.status = { ...world.status, notices: undefined }
    const { text } = await $.command.run({ command: 'guildbyte-status' } as any)
    expect(world.actions.at(-1)).toBe('status')
    expect(world.inputs.at(-1).sessionStart).toBeUndefined()
    expect(text).toContain('Daily gauge: 8,200,000 effective tokens · next 15,000,000')
    expect(text).toContain('Streak: 4 days (best 9) · ×1.020')
    expect(text).toContain('League: Gold II')
    expect(text).toContain('Rewards: gold ready to claim · chest ready to claim')
    expect(text).toContain(claimUrl)
    world.status = { connected: true, pending: 0, progression: null, progressionCached: true }
    expect((await $.command.run({ command: 'guildbyte-status' } as any)).text).toMatch(/has not synced yet/)
  })

  test('keeps the chest still with reduced motion and hides the gauge until paired', async ($, on) => {
    const { clock, world } = harness(on, { TERM_PROGRAM: 'ghostty' }, { prefersReducedMotion: true })
    world.status = { ...world.status, character: null, progression: progression(), progressionCached: true }
    await $.session.start(start)
    const ui = await $.ui.mount({ plugin: 'guildbyte', surface: 'terminal', component: 'AbovePrompt', props } as any)
    expect(await ui.find({ type: 'Image' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Daily ▰/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '▄▄' })).toBeDefined()
    await clock.advance(500)
    expect(await ui.find({ type: 'Text', text: '▀▀' })).toBeUndefined()
    await ui.unmount()

    world.status = { connected: false, pending: 0, progression: progression() }
    await $.session.start(start)
    const unpaired = await $.ui.mount({ plugin: 'guildbyte', surface: 'terminal', component: 'AbovePrompt', props } as any)
    expect(await unpaired.find({ type: 'Text', text: /Daily/ })).toBeUndefined()
    expect(await unpaired.find({ type: 'Button', text: /Connect account/ })).toBeDefined()
    await unpaired.unmount()
  })

  test('shows the coin until the chest unlocks, then the chest replaces it', async ($, on) => {
    const { clock, world } = harness(on, { TERM_PROGRAM: 'Orca', TERM: 'xterm-256color' })
    world.status = { ...world.status, progression: progression({ rewards: { gold: { unlocked: true, claimed: false }, chest: { unlocked: false, claimed: false } } }), progressionCached: true }
    await $.session.start(start)
    const ui = await $.ui.mount({ plugin: 'guildbyte', surface: 'terminal', component: 'AbovePrompt', props } as any)
    expect(await ui.find({ type: 'Text', text: '◉ gold' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▄▄|▀▀/ })).toBeUndefined()
    expect(await ui.find({ type: 'Link' })).toBeDefined()

    world.status = { ...world.status, progression: progression() }
    await clock.advance(10000)
    expect(await ui.find({ type: 'Text', text: '◉ gold' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /▄▄|▀▀/ })).toBeDefined()

    // Claiming the chest first brings the still-unclaimed coin back.
    world.status = { ...world.status, progression: progression({ rewards: { gold: { unlocked: true, claimed: false }, chest: { unlocked: true, claimed: true } } }) }
    await clock.advance(10000)
    expect(await ui.find({ type: 'Text', text: '◉ gold' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▄▄|▀▀/ })).toBeUndefined()
    await ui.unmount()
  })
})
