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
    let pixels: any = null
    let omitArt=false
    let character = { id: 'a5928de2-75f4-4e84-bfff-18c392dbaf89', png: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==' }
    on('state.set',($,e,next)=>{if((e as any).key==='status'){expect((e as any).value.error).toBeUndefined();expect((e as any).value.pixels).toBeUndefined();expect((e as any).value.visitorPixels).toBeUndefined();if((e as any).value.connected){expect((e as any).value.character?.animation).toBeUndefined();expect((e as any).value.character?.png).toBeUndefined()}};return next(e)})
    on('process.spawn', async function* () {yield {stream:'stdout',text:JSON.stringify({connected:isConnected,character:omitArt ? {id:character.id} : character,...(!omitArt ? {pixels} : {}),artRevision:"fixture-art",tokens:123,prompts:2,pending:3,historyComplete:true})};return {value:{code:0}}})
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return Text({ children: 'Survey fallback' })
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const ui = await $.ui.mount({ plugin: 'guildbyte', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 120, maxRows: 10 } } as any)
    expect(await ui.find({ type: 'Text' })).toBeUndefined()
    expect(await ui.find({ type: 'Image' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', text: /Connect account/ })).toBeDefined()
    await ui.unmount()
    isConnected = true
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const connected = await $.ui.mount({ plugin: 'guildbyte', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 120, maxRows: 3 } } as any)
    expect((await connected.find({ type: 'Image' }))?.props.source).toEqual({ png: character.png })
    expect((await connected.find({ type: 'Image' }))?.props.rows).toBe(2)
    expect((await connected.find({ type: 'Image' }))?.props.columns).toBe(4)
    expect((await connected.find({ type: 'Box' }))?.props).toMatchObject({ width: 120, height: 2, justifyContent: 'flex-end', alignItems: 'flex-end' })
    expect(await connected.find({ type: 'Text' })).toBeUndefined()
    expect(await connected.find({ type: 'Button' })).toBeUndefined()
    character = { ...character, png: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNgYPj/HwADAgH/xCAAOgAAAABJRU5ErkJggg==' }
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    expect((await connected.find({ type: 'Image' }))?.props.source).toEqual({ png: character.png })
    expect(typeof atob).toBe('function')
    expect(typeof btoa).toBe('function')
    const dot=new Uint8Array(128*128*4);dot.set([255,0,0,255],(64*128+64)*4)
    const rgba=btoa(String.fromCharCode(...dot))
    pixels={width:128,height:128,frames:Array(28).fill(rgba),mirroredFrames:Object.fromEntries(Array.from({length:28},(_,i)=>[i,rgba]))}
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    expect((await connected.find({type:'Image'}))?.props.source).toEqual({png:character.png})
    expect((await connected.find({type:'Image'}))?.props.columns).toBe(4)
    omitArt=true
    await $.command.run({command:'guildbyte-sync',args:''} as any)
    expect((await connected.find({type:'Image'}))?.props.source).toEqual({png:character.png})
    await $.command.run({command:'guildbyte-walk',args:''} as any)
    const canvas=(await connected.find({type:'Image'}))?.props
    expect(canvas.columns).toBe(16)
    expect(canvas.source.width).toBe(512)
    expect(canvas.source.height).toBe(128)
    expect(atob(canvas.source.rgba).length).toBe(512*128*4)
    await connected.unmount()
    const large=await $.ui.mount({plugin:'guildbyte',surface:'terminal',component:'AbovePrompt',props:{hasSurvey:false,bodyColumns:120,maxRows:10}} as any)
    await $.command.run({command:'guildbyte-idle',args:''} as any)
    expect((await large.find({type:'Image'}))?.props.rows).toBe(5)
    expect((await large.find({type:'Image'}))?.props.columns).toBe(10)
    await large.unmount()
    isConnected = false
    omitArt=false
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
