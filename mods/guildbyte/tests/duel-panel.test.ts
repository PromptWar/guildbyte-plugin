import { describe, expect, test, mock } from 'claude-code/testing'

const origin = 'http://localhost:3000'
const PANE = 'guildbyte-duel'
const start = { surface: 'terminal', isInteractive: true, cwd: '/work' } as any
const paneProps = { title: 'Duel', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} }
const noConfirm = { required: false, lossGold: null, allIn: false, message: null }
const later = (minutes: number) => new Date(Date.now() + minutes * 60000).toISOString()

const dashboard = { energy: { available: 2, reserved: 0, max: 3, nextAt: null, price: 1000, canPurchase: false }, gold: 340, wagersEnabled: true, requests: [], sent: [], lobbies: [], active: [],
  exhibitions: { activeCount: 0, items: [], nextCursor: null }, recent: [], guild: { pending: [], active: [] }, record: { wins: 0, losses: 0, draws: 0, winRate: null, currentStreak: 0 }, badge: 0, webUrl: '/duels' }
const created = { id: 'd1', code: 'Q7KM2P', url: '/duels/Q7KM2P', rulesVersion: 2, mode: 'competitive', entry: 'named', status: 'proposed', endedReason: null, invalidatedReason: null, capacity: 2,
  durationSeconds: 86400, wagerGold: 50, potGold: 100, createdAt: later(0), expiresAt: later(1440), startsAt: null, endsAt: null, settlesAt: null, settledAt: null, provisional: false, creator: 'me', winner: null,
  participants: [{ handle: 'me', role: 'creator', state: 'joined', isYou: true }, { handle: 'alice', role: 'invitee', state: 'invited', isYou: false }], you: null }
const member = (handle: string, state: string, isYou = false) => ({ handle, href: `/players/${handle}`, state, hero: null, contribution: null, payoutGold: 0, lastSyncedAt: null, isYou })
const guildDuel = (roster: any[], extra: Record<string, unknown> = {}) => ({ id: 'g1', code: 'G7KM2P', url: '/duels/guild/G7KM2P', rulesVersion: 2, mode: 'competitive', status: 'rostering', endedReason: null,
  invalidatedReason: null, teamSize: 3, durationSeconds: 604800, wagerGold: 25, potGold: 150, proposedAt: later(0), expiresAt: later(8640), startsAt: null, endsAt: null, settlesAt: null, settledAt: null,
  provisional: false, winner: null,
  sides: [{ side: 'challenger', guild: { id: 'a', name: 'Owls', slug: 'owls' }, total: null, outcome: null, readyCount: 1, roster },
    { side: 'defender', guild: { id: 'b', name: 'Rivals', slug: 'rivals' }, total: null, outcome: null, readyCount: 0, roster: [] }],
  you: { side: 'challenger', canAccept: false, canDecline: false, canCancel: true, canEditRoster: true, canReady: true, canUnready: false, canDeclineSelection: false, confirm: noConfirm }, ...extra })

function harness(on: any, answer: (target: string) => unknown, placed = true) {
  const clock = mock.clock(on)
  mock.env(on, { TERM_PROGRAM: 'Orca', TERM: 'xterm-256color' })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'a5928de2-75f4-4e84-bfff-18c392dbaf89' }))
  on('session.usage', () => ({ value: { context: { window: 200000 }, rateLimits: [] } }))
  on('command.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: {} }))
  const world = { clock, targets: [] as string[], status: { connected: true, pending: 0 } as Record<string, unknown>, toasts: [] as string[], opened: [] as string[], closed: [] as string[] }
  // The surface: places the pane, or (an older desktop) places none.
  on('ui.open', ($: any, e: any) => { world.opened.push(e.id); return { value: placed ? { isPlaced: true } : { isPlaced: false, reason: 'This surface places no panes.' } } })
  on('ui.close', ($: any, e: any) => { world.closed.push(e.id); return { value: undefined } })
  on('ui.toast', ($: any, e: any) => { world.toasts.push(e.text); return { value: undefined } })
  on('process.spawn', async function* ($: any, e: any) {
    const input = JSON.parse(e.input ?? e.init?.input ?? '{}')
    let status = world.status
    if (input.action === 'duel') {
      world.targets.push(input.target ?? '')
      const duel = answer(input.target ?? '')
      status = { ...world.status, ...(duel ? { duel: { origin, ...(duel as object) } } : {}) }
    }
    yield { stream: 'stdout', text: JSON.stringify(status) }
    return { value: { code: 0 } }
  })
  return world
}

const mountPane = ($: any, surface: string) => $.ui.mount({ plugin: 'guildbyte', surface, component: 'Pane', requestId: PANE, props: paneProps } as any)
const run = ($: any, args: string) => $.command.run({ command: 'duel', args } as any)

describe('Guildbyte duel panels', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`challenge panel picks duration and wager, confirms an all-in stake, then sends the typed command (${surface})`, async ($, on) => {
      const world = harness(on, target => target === '@alice' ? { kind: 'setup', handles: ['alice'], dashboard } : { kind: 'created', duel: created })
      await $.session.start(start)
      const { text } = await run($, '@alice')
      expect(text).toBe(`Duel panel open. Typed: /duel @alice 6h 25\n\n${origin}/duels`)
      const ui = await mountPane($, surface)
      expect(await ui.find({ type: 'Text', text: 'Challenge @alice' })).toBeDefined()
      expect((await ui.find({ key: 'duration:6h' }))?.props).toMatchObject({ variant: 'primary' })
      expect((await ui.find({ key: 'wager:25' }))?.props).toMatchObject({ variant: 'primary' })
      expect(await ui.find({ type: 'Text', text: 'Competitive · 1 energy' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'You can lose 25 gold' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Energy 2/3 · 340 gold' })).toBeDefined()

      await ui.press({ key: 'wager:0' })
      expect(await ui.find({ type: 'Text', text: 'Exhibition · no gold, no energy' })).toBeDefined()
      await ui.press({ key: 'duration:1d' })
      expect((await ui.find({ key: 'duration:1d' }))?.props).toMatchObject({ variant: 'primary' })
      expect((await ui.find({ key: 'duration:6h' }))?.props.variant).toBeUndefined()

      // Custom wager: the whole balance asks for the loss and all-in confirmation first.
      await ui.press({ key: 'wager:custom' })
      await ui.input({ key: 'wager', text: 'lots' })
      expect(await ui.find({ type: 'Text', text: 'Enter a whole number of gold.' })).toBeDefined()
      await ui.input({ key: 'wager', text: '340' })
      expect(await ui.find({ key: 'wager:custom', text: 'Custom · 340' })).toBeDefined()
      await ui.press({ key: 'send' })
      expect(world.targets).toEqual(['@alice'])
      expect(await ui.find({ type: 'Text', text: 'You can lose 340 gold.' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'All-in: 340 gold is your entire balance.' })).toBeDefined()
      await ui.press({ key: 'back' })
      expect(await ui.find({ key: 'duration:1d' })).toBeDefined()
      await ui.press({ key: 'send' })
      await ui.press({ key: 'send' })
      expect(world.targets).toEqual(['@alice', '@alice 1d 340 confirm allin'])
      expect(await ui.find({ type: 'Text', text: /^Challenge \[Q7KM2P\] sent to @alice\./ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: `${origin}/duels/Q7KM2P` })).toBeDefined()
      await ui.press({ key: 'close' })
      expect(world.closed).toEqual([PANE])
      expect(await ui.find({ type: 'Text', text: 'No duel in progress. Run /duel.' })).toBeDefined()
      await ui.unmount()
    })
  }

  test('falls back to the typed reply when the surface places no pane', async ($, on) => {
    const world = harness(on, target => target.includes('6h') ? { kind: 'created', duel: created } : { kind: 'setup', handles: ['alice', 'bob_2'], dashboard }, false)
    const { opened, closed } = world
    await $.session.start(start)
    const { text } = await run($, '@alice @bob_2')
    expect(world.targets).toEqual(['@alice @bob_2'])
    expect(opened).toEqual([PANE])
    expect(closed).toEqual([PANE])
    expect(text).toMatch(/^Free-for-all with @alice @bob_2 · 3 players\n[\s\S]*Send: \/duel @alice @bob_2 6h 25\n\nhttp:\/\/localhost:3000\/duels$/)
    // Results without a panel never open one.
    world.targets.length = 0
    const typed = await run($, '@alice 6h 25')
    expect(opened).toEqual([PANE])
    expect(typed.text).toMatch(/^Challenge \[Q7KM2P\] sent to @alice\./)
  })

  test('guild challenge panel picks team size and stake and confirms a large stake', async ($, on) => {
    const world = harness(on, target => target === 'guild @rivals'
      ? { kind: 'guildSetup', slug: 'rivals', dashboard: { guild: { id: 'a', name: 'Owls', slug: 'owls' }, canDeclare: true } }
      : { kind: 'guildUpdated', action: 'declare', duel: guildDuel([], { status: 'proposed' }) })
    await $.session.start(start)
    expect((await run($, 'guild @rivals')).text).toBe(`Duel panel open. Typed: /duel guild @rivals 5 25\n\n${origin}/duels?tab=guild`)
    const ui = await mountPane($, 'terminal')
    expect(await ui.find({ type: 'Text', text: 'Guild duel · Owls vs @rivals · 7 days' })).toBeDefined()
    for (const size of [2, 10]) expect(await ui.find({ key: `size:${size}` })).toBeDefined()
    expect(await ui.find({ key: 'size:11' })).toBeUndefined()
    await ui.press({ key: 'size:3' })
    await ui.press({ key: 'wager:custom' })
    await ui.input({ key: 'wager', text: '150' })
    expect(await ui.find({ type: 'Text', text: 'Competitive · each member stakes 150 gold · winners receive 300 gold' })).toBeDefined()
    await ui.press({ key: 'send' })
    expect(await ui.find({ type: 'Text', text: 'Each selected member stakes 150 gold when they press Ready.' })).toBeDefined()
    await ui.press({ key: 'send' })
    expect(world.targets).toEqual(['guild @rivals', 'guild @rivals 3 150 confirm'])
    expect(await ui.find({ type: 'Text', text: /^Guild duel \[G7KM2P\] declared against Rivals/ })).toBeDefined()
    await ui.unmount()
  })

  test('stake, forfeit, join and energy confirmations run the confirmed command', async ($, on) => {
    const world = harness(on, target => {
      if (target === 'accept Q7KM2P') return { kind: 'confirm', action: 'accept', command: 'accept Q7KM2P', lossGold: 150, allIn: false, message: 'You can lose 150 gold.' }
      if (target === 'forfeit Q7KM2P') return { kind: 'confirm', action: 'forfeit', id: 'Q7KM2P' }
      if (target === 'energy buy') return { kind: 'energyConfirm', energy: { ...dashboard.energy, available: 1, canPurchase: true } }
      if (target === 'accept Q7KM2P confirm') return { kind: 'error', error: 'Guildbyte: Not enough gold' }
      return { kind: 'energyBought', result: { energy: { ...dashboard.energy, available: 2 }, gold: 1340 } }
    })
    await $.session.start(start)
    expect((await run($, 'accept Q7KM2P')).text).toMatch(/^Duel panel open\. Typed: \/duel accept Q7KM2P confirm\n\nhttp:\/\/localhost:3000\/duels$/)
    const ui = await mountPane($, 'terminal')
    expect(await ui.find({ type: 'Text', text: 'Accept duel' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'You can lose 150 gold.' })).toBeDefined()
    await ui.press({ key: 'confirm' })
    expect(world.targets.at(-1)).toBe('accept Q7KM2P confirm')
    // A server refusal stays in the panel.
    expect(await ui.find({ type: 'Text', text: 'Guildbyte: Not enough gold' })).toBeDefined()
    expect(await ui.find({ key: 'confirm', text: 'Accept & stake 150' })).toBeDefined()

    await run($, 'forfeit Q7KM2P')
    expect(await ui.find({ type: 'Text', text: 'Forfeit [Q7KM2P]?' })).toBeDefined()
    await ui.press({ key: 'cancel' })
    expect(world.targets.at(-1)).toBe('forfeit Q7KM2P')
    expect(await ui.find({ type: 'Text', text: 'No duel in progress. Run /duel.' })).toBeDefined()

    await run($, 'energy buy')
    expect(await ui.find({ key: 'confirm', text: 'Buy 1 energy · 1,000 gold' })).toBeDefined()
    await ui.press({ key: 'confirm' })
    expect(world.targets.at(-1)).toBe('energy buy confirm')
    expect(await ui.find({ type: 'Text', text: 'Bought 1 Battle Energy for 1,000 gold. 1,340 gold left.' })).toBeDefined()
    await ui.unmount()
  })

  test('roster panel adds and removes members and readies through the stake confirmation', async ($, on) => {
    let roster = [member('me', 'ready', true), member('bob', 'selected')]
    const world = harness(on, target => {
      const add = target.match(/^guild roster G7KM2P add @(\w+)$/)
      if (add) { roster = [...roster, member(add[1], 'selected')]; return { kind: 'guildUpdated', action: 'add', handle: add[1], duel: guildDuel(roster) } }
      const remove = target.match(/^guild roster G7KM2P remove @(\w+)$/)
      if (remove) { roster = roster.filter(one => one.handle !== remove[1]); return { kind: 'guildUpdated', action: 'remove', handle: remove[1], duel: guildDuel(roster) } }
      if (target === 'guild ready G7KM2P') return { kind: 'confirm', action: 'guildReady', command: 'guild ready G7KM2P', lossGold: 150, allIn: false, message: null }
      if (target === 'guild ready G7KM2P confirm') return { kind: 'guildUpdated', action: 'ready', duel: guildDuel(roster, { status: 'active', endsAt: later(10080) }) }
      return { kind: 'guildRoster', duel: guildDuel(roster) }
    })
    await $.session.start(start)
    expect((await run($, 'guild roster G7KM2P')).text).toBe(`Duel panel open. Typed: /duel guild roster G7KM2P add @handle\n\n${origin}/duels/guild/G7KM2P`)
    const ui = await mountPane($, 'terminal')
    expect(await ui.find({ type: 'Text', text: 'Roster [G7KM2P] · Owls vs Rivals · 3v3 · 25 gold each' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^@bob\s+○ selected$/ })).toBeDefined()
    await ui.input({ key: 'add', text: 'not a handle!' })
    expect(await ui.find({ type: 'Text', text: 'Enter a Guildbyte handle, for example @alice.' })).toBeDefined()
    await ui.input({ key: 'add', text: '@carol' })
    expect(world.targets.at(-1)).toBe('guild roster G7KM2P add @carol')
    expect(await ui.find({ type: 'Text', text: /^Added @carol to the \[G7KM2P\] roster \(3\/3\)/ })).toBeDefined()
    expect(await ui.find({ key: 'add' })).toBeUndefined()
    await ui.press({ key: 'remove:bob' })
    expect(world.targets.at(-1)).toBe('guild roster G7KM2P remove @bob')
    expect(await ui.find({ type: 'Text', text: /^Removed @bob from the \[G7KM2P\] roster \(2\/3\)\.$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^@bob\s/ })).toBeUndefined()
    await ui.press({ key: 'ready' })
    expect(await ui.find({ key: 'confirm', text: 'Ready & stake 150' })).toBeDefined()
    await ui.press({ key: 'confirm' })
    expect(world.targets.at(-1)).toBe('guild ready G7KM2P confirm')
    expect(await ui.find({ type: 'Text', text: /^Guild duel \[G7KM2P\] started! Owls vs Rivals/ })).toBeDefined()
    await ui.unmount()

    // Mobile draws no Input: adding falls back to the typed command.
    await run($, 'guild roster G7KM2P')
    const phone = await mountPane($, 'mobile')
    expect(await phone.find({ type: 'Text', text: 'Add: /duel guild roster G7KM2P add @handle' })).toBeDefined()
    expect(await phone.find({ key: 'remove:me' })).toBeDefined()
    await phone.unmount()
  })

  test('a duel request from the heartbeat toasts with its accept and decline commands', async ($, on) => {
    const world = harness(on, () => null)
    world.status = { ...world.status, notices: [{ id: 'duel-request:duel:Q7KM2P', kind: 'duel-request',
      request: { id: 'r1', code: 'Q7KM2P', kind: 'duel', from: 'alice', durationSeconds: 21600, wagerGold: 25, expiresAt: null, webUrl: `${origin}/duels/Q7KM2P` } }] }
    await $.session.start(start)
    await world.clock.advance(0)
    expect(world.toasts).toEqual([`⚔ @alice challenges you · 6h · 25 gold wager. /duel accept Q7KM2P · /duel decline Q7KM2P · ${origin}/duels/Q7KM2P`])
  })
})
