import {expect,test,mock} from 'claude-code/testing'

test('pending startup uses a loader and never a character or connection button',async($,on)=>{
 const clock=mock.clock(on);mock.env(on,{TERM_PROGRAM:'ghostty'})
 on('session.start',(_,e)=>({cwd:e.cwd}))
 on('session.id',()=>({value:'a5928de2-75f4-4e84-bfff-18c392dbaf89'}))
 on('session.usage',()=>({value:{context:{window:200000},rateLimits:[]}}))
 on('command.register',()=>({value:undefined}))
 on('process.spawn',async function*(){await clock.sleep(1000);yield {stream:'stdout',text:JSON.stringify({connected:false})};return {value:{code:0}}})
 await $.session.start({surface:'terminal',isInteractive:true,cwd:'/work'} as any)
 const ui=await $.ui.mount({plugin:'guildbyte',surface:'terminal',component:'AbovePrompt',props:{bodyColumns:120,maxRows:10}} as any)
 expect((await ui.find({key:'loader'}))?.props.alt).toBe('Loading Guildbyte')
 expect(await ui.find({type:'Button'})).toBeUndefined()
 expect(await ui.find({key:'companion'})).toBeUndefined()
 await clock.advance(1000)
 expect(await ui.find({key:'loader'})).toBeUndefined()
 expect(await ui.find({type:'Button',text:/Connect account/})).toBeDefined()
 expect((await ui.find({key:'actions'}))?.props.borderStyle).toBe('double')
 await ui.unmount()
})

test('XP feedback and gold action frame use the native UI and manual evolve request',async($,on)=>{
 const clock=mock.clock(on);mock.env(on,{TERM_PROGRAM:'ghostty'})
 on('session.start',(_,e)=>({cwd:e.cwd}))
 on('session.id',()=>({value:'a5928de2-75f4-4e84-bfff-18c392dbaf89'}))
 on('session.usage',()=>({value:{context:{window:200000},rateLimits:[]}}))
 on('command.register',()=>({value:undefined}))
 const pixels=new Uint8Array(128*128*4);pixels.set([255,0,0,255],(64*128+64)*4)
 const rgba=btoa(String.fromCharCode(...pixels)),frames=Array(28).fill(rgba)
 const decoded={width:128,height:128,frames,mirroredFrames:Object.fromEntries(frames.map((f,i)=>[i,f]))}
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
 let character={id:'a5928de2-75f4-4e84-bfff-18c392dbaf89',level:1,xp:10,nextLevelAt:100,canLevelUp:false,png}
 let evolved=false
 on('process.spawn',async function*(_,e){
  const input=JSON.parse((e as any).input)
  if(input.action==='evolve'){
   expect(input.characterId).toBe(character.id);expect(input.level).toBe(1)
   evolved=true;character={...character,level:2,canLevelUp:false,nextLevelAt:400}
  }
  yield {stream:'stdout',text:JSON.stringify({connected:true,character,pixels:decoded,...(evolved?{levelUp:{id:'test',heroId:'cash_cow_solopreneur',fromLevel:1,toLevel:2,version:1,frames:Array(18).fill(png),durations:Array(18).fill(100),durationMs:1800,renderScale:1.5},levelUpPixels:{width:192,height:192,frames:Array(18).fill(btoa('\0'.repeat(192*192*4)))}}:{})})};return {value:{code:0}}
 })
 await $.session.start({surface:'terminal',isInteractive:true,cwd:'/work'} as any)
 const ui=await $.ui.mount({plugin:'guildbyte',surface:'terminal',component:'AbovePrompt',props:{bodyColumns:120,maxRows:10}} as any)
 expect(await ui.find({key:'xp-gain'})).toBeUndefined()
 expect(await ui.find({key:'actions'})).toBeUndefined()
 character={...character,xp:100,canLevelUp:true}
 await $.command.run({command:'guildbyte-sync',args:''} as any)
 expect((await ui.find({key:'xp-gain'}))?.props.alt).toBe('XP: +90')
 const source=(await ui.find({key:'xp-gain'}))?.props.source
 expect(source.width).toBeGreaterThan(0)
 expect(atob(source.rgba).includes(String.fromCharCode(207,99,255,255))).toBe(true)
 expect((await ui.find({key:'actions'}))?.props.borderColor).toBe('#d7ad64')
 expect((await ui.find({key:'actions'}))?.props.width).toBeUndefined()
 expect((await ui.find({key:'action-section'}))?.props).toMatchObject({left:40,width:40,alignItems:'center'})
 expect((await ui.find({key:'player'}))?.props.right).toBe(1)
 expect(await ui.find({type:'Button',text:/Level up/})).toBeDefined()
 await ui.unmount()
 const compact=await $.ui.mount({plugin:'guildbyte',surface:'terminal',component:'AbovePrompt',props:{bodyColumns:120,maxRows:4}} as any)
 expect((await compact.find({key:'companion'}))?.props.rows).toBe(3)
 await compact.press({key:'Level up'})
 expect(evolved).toBe(true)
 expect(await compact.find({type:'Button',text:/Level up/})).toBeUndefined()
 expect(await compact.find({key:'actions'})).toBeUndefined()
 expect((await compact.find({key:'companion'}))?.props.alt).toBe('Your Guildbyte character: levelup')
 expect((await compact.find({key:'companion'}))?.props.columns).toBe(18)
 expect((await compact.find({key:'companion'}))?.props.source.width).toBe(576)
 await compact.unmount()
})

test('Retry sync button clears an upload error after the app recovers',async($,on)=>{
 mock.clock(on);mock.env(on,{TERM_PROGRAM:'ghostty'})
 on('session.start',(_,e)=>({cwd:e.cwd}))
 on('session.id',()=>({value:'a5928de2-75f4-4e84-bfff-18c392dbaf89'}))
 on('session.usage',()=>({value:{context:{window:200000},rateLimits:[]}}))
 on('command.register',()=>({value:undefined}))
 let calls=0
 on('process.spawn',async function*(_,e){
  const action=JSON.parse((e as any).input).action
  expect(action).toBe(calls===0?'status':'sync')
  calls++
  yield{stream:'stdout',text:JSON.stringify({connected:true,pending:calls===1?12:0,...(calls===1?{error:'Guildbyte: Internal server error'}:{})})}
  return{value:{code:0}}
 })
 await $.session.start({surface:'terminal',isInteractive:true,cwd:'/work'}as any)
 const ui=await $.ui.mount({plugin:'guildbyte',surface:'terminal',component:'AbovePrompt',props:{bodyColumns:120,maxRows:10}}as any)
 expect(await ui.find({type:'Button',text:/Retry sync/})).toBeDefined()
 await ui.press({key:'Retry sync'})
 expect(calls).toBe(2)
 expect(await ui.find({type:'Button',text:/Retry sync/})).toBeUndefined()
 expect(await ui.find({key:'actions'})).toBeUndefined()
 await ui.unmount()
})

test('visitors occupy the left zone while actions are centered and the player stays right',async($,on)=>{
 const clock=mock.clock(on);mock.env(on,{TERM_PROGRAM:'ghostty'})
 on('session.start',(_,e)=>({cwd:e.cwd}))
 on('session.id',()=>({value:'a5928de2-75f4-4e84-bfff-18c392dbaf89'}))
 on('session.usage',()=>({value:{context:{window:200000},rateLimits:[]}}))
 on('command.register',()=>({value:undefined}))
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
 const frames=Array(28).fill(png),animation={frames,mirroredFrames:Object.fromEntries(frames.map((f,i)=>[i,f])),clips:Object.fromEntries(['idle','walk','sit','talk','kiss','wave','laugh','angry','victory','sleep'].map(state=>[state,{frames:[0,1],durations:[100,100]}]))}
 const decoded={width:128,height:128,frames:Array(28).fill(btoa('\0'.repeat(128*128*4)))}
 on('process.spawn',async function*(){yield{stream:'stdout',text:JSON.stringify({connected:true,error:'Guildbyte: sync pending',character:{id:'hero',level:1,xp:10,png,animation},pixels:decoded,visit:{id:'visit',name:'Guest',guild:'Guild',expiresAt:new Date(Date.now()+120000).toISOString(),character:{id:'guest',png,animation}},visitorPixels:decoded})};return{value:{code:0}}})
 await $.session.start({surface:'terminal',isInteractive:true,cwd:'/work'}as any)
 const ui=await $.ui.mount({plugin:'guildbyte',surface:'terminal',component:'AbovePrompt',props:{bodyColumns:120,maxRows:10}}as any)
 expect((await ui.find({key:'visitors'}))?.props).toMatchObject({left:0,width:40})
 expect((await ui.find({key:'action-section'}))?.props).toMatchObject({left:40,width:40,alignItems:'center'})
 expect((await ui.find({key:'actions'}))?.props.width).toBeUndefined()
 expect((await ui.find({key:'player'}))?.props.right).toBe(1)
 expect((await ui.find({key:'player'}))?.props.width).toBeLessThanOrEqual(39)
 await clock.advance(1600)
 expect(await ui.find({key:'visitor'})).toBeDefined()
 expect((await ui.find({key:'visitors'}))?.props.left).toBe(0)
 expect((await ui.find({key:'player'}))?.props.right).toBe(1)
 await ui.unmount()
})
