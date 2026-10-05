import { describe, expect, test, mock } from 'claude-code/testing'

describe('Guildbyte companion', () => {
  test('shows the companion, connection action, and respects surveys', async ($, on) => {
    mock.clock(on)
    mock.env(on, { TERM_PROGRAM: 'ghostty' })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.id', () => ({ value: 'a5928de2-75f4-4e84-bfff-18c392dbaf89' }))
    on('session.usage', () => ({ value: { context: { window: 200000 }, rateLimits: [] } }))
    on('command.register', () => ({ value: undefined }))
    let isConnected = false
    let character = { id: 'a5928de2-75f4-4e84-bfff-18c392dbaf89', png: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==' }
    on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify({ connected: isConnected, character, tokens: 123, prompts: 2, pending: 3, historyComplete: true }), stderr: '' } }))
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return Text({ children: 'Survey fallback' })
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const ui = await $.ui.mount({ plugin: 'guildbyte', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 120, maxRows: 10 } } as any)
    expect(await ui.find({ type: 'Text' })).toBeUndefined()
    expect(await ui.find({ type: 'Image' })).toBeDefined()
    expect((await ui.find({ type: 'Image' }))?.props).toMatchObject({rows:4,columns:8})
    expect(await ui.find({ type: 'Button', text: /Connect account/ })).toBeDefined()
    await ui.unmount()
    isConnected = true
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const connected = await $.ui.mount({ plugin: 'guildbyte', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 120, maxRows: 3 } } as any)
    expect((await connected.find({ type: 'Image' }))?.props.source).toEqual({ png: character.png })
    expect((await connected.find({ type: 'Image' }))?.props.rows).toBe(3)
    expect((await connected.find({ type: 'Image' }))?.props.columns).toBe(6)
    expect((await connected.find({ type: 'Box' }))?.props).toMatchObject({ width: 120, height: 3, justifyContent: 'flex-end', alignItems: 'flex-end' })
    expect(await connected.find({ type: 'Text' })).toBeUndefined()
    expect(await connected.find({ type: 'Button' })).toBeUndefined()
    character = { ...character, png: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNgYPj/HwADAgH/xCAAOgAAAABJRU5ErkJggg==' }
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    expect((await connected.find({ type: 'Image' }))?.props.source).toEqual({ png: character.png })
    await connected.unmount()
    isConnected = false
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const disconnected = await $.ui.mount({ plugin: 'guildbyte', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 120, maxRows: 3 } } as any)
    expect(await disconnected.find({ type: 'Text' })).toBeUndefined()
    expect(await disconnected.find({ type: 'Button', text: /Connect account/ })).toBeDefined()
    await disconnected.unmount()
    const survey = await $.ui.mount({ plugin: 'guildbyte', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: true, bodyColumns: 120, maxRows: 10 } } as any)
    expect(await survey.find({ type: 'Text', text: /Survey fallback/ })).toBeDefined()
    expect(await survey.find({ type: 'Image' })).toBeUndefined()
    await survey.unmount()
  })
})
