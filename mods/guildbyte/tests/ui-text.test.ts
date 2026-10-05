import { describe, expect, test, mock } from 'claude-code/testing'

describe('Guildbyte companion without kitty graphics', () => {
  test('shows handle, points and capture state instead of the picture', async ($, on) => {
    mock.clock(on)
    mock.env(on, { TERM_PROGRAM: 'Orca', TERM: 'xterm-256color' })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.id', () => ({ value: 'a5928de2-75f4-4e84-bfff-18c392dbaf89' }))
    on('session.usage', () => ({ value: { context: { window: 200000 }, rateLimits: [] } }))
    on('command.register', () => ({ value: undefined }))
    let status: Record<string, unknown> = { connected: false, pending: 0 }
    on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(status), stderr: '' } }))
    const props = { hasSurvey: false, bodyColumns: 120, maxRows: 5 }

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const disconnected = await $.ui.mount({ plugin: 'guildbyte', surface: 'terminal', component: 'AbovePrompt', props } as any)
    expect(await disconnected.find({ type: 'Button', text: /Connect account/ })).toBeDefined()
    expect(await disconnected.find({ type: 'Image' })).toBeUndefined()
    await disconnected.unmount()

    status = { connected: true, pending: 0, player: { handle: 'paul_1a2b3c4d', points: 12345 }, character: { id: 'a5928de2-75f4-4e84-bfff-18c392dbaf89', png: 'iVBORw0KGgo=' } }
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const connected = await $.ui.mount({ plugin: 'guildbyte', surface: 'terminal', component: 'AbovePrompt', props } as any)
    expect(await connected.find({ type: 'Image' })).toBeUndefined()
    expect(await connected.find({ type: 'Text', text: '● @paul_1a2b3c4d · 12,345 pts · capturing' })).toBeDefined()
    expect((await connected.find({ type: 'Box' }))?.props).toMatchObject({ width: 120, height: 1 })

    status = { ...status, pending: 3 }
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    expect(await connected.find({ type: 'Text', text: /3 waiting to sync/ })).toBeDefined()
    await connected.unmount()
  })
})
