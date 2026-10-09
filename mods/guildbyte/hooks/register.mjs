import {pixelCanvas,levelUpCanvas,xpCanvas} from '../scripts/companion-pixels.mjs'
import {LOADER_FRAMES,LOADER_INTERVAL} from '../scripts/companion-loader.mjs'
import { COMPANION_STATES, companionFrame, companionActivity,visitPose,levelUpFrame,parseLevelUpArguments } from '../scripts/companion-animation.mjs'

const statusKey = { plugin: 'guildbyte', key: 'status' }
const motionKey = { plugin: 'guildbyte', key: 'motion' }

let options = {}
let failures = []
let running = false
let sessionId
let timer
let motionTimer,motionInterval
let loading=true,loadingStarted=Date.now(),ending=false
let companion,companionPng,pixels,guestCompanion,visitorPixels,artRevision,visitorArtRevision,observedCharacter,levelUp,levelUpStarted=0,levelUpPixels,xpGain,xpGainStarted=0,baseColumns=10
let activity = companionActivity()
let travelLimit = 12
let imageSite,currentPose
let lastPose
let visitor,visitStarted=0,completedVisits=[]
let visitorTarget=9,visitorLimit=24

let painting,lastInputAt=-Infinity
const FRAME_INTERVAL=80
function animate($,immediate=false) {
  if(painting)return painting
  // The clock owns continuous playback. Stream events only change activity;
  // a second elapsed-time guard would discard slightly early clock ticks.
  if(!immediate && motionTimer)return
  return painting=(async()=>{
    try {await paint($)}
    finally {painting=undefined}
  })()
}

async function paint($) {
  const now=Date.now()
  // Give prompt editing priority and pause patrol time so resuming cannot jump.
  if(now-lastInputAt<250){activity.snapshot(now,travelLimit,true,true);return}
  if(loading) {
    const frame=Math.floor(Math.max(0,now-loadingStarted)/LOADER_INTERVAL)%LOADER_FRAMES.length
    if(currentPose?.state==='loading' && currentPose.frame===frame)return
    currentPose={state:'loading',frame,offset:0,facing:'right'};lastPose=undefined
    if(imageSite?.loader) {
      try {if(!(await $.ui.blit({requestId:imageSite.id,key:'loader',source:LOADER_FRAMES[frame].image})).deny)return}
      catch { /* Older surfaces repaint through the normal render path. */ }
    }
    imageSite=undefined
    await $.state.set(motionKey,currentPose)
    return
  }
  if(!companionPng)return
  if(visitor && (now-visitStarted>=8000 || Date.parse(visitor.expiresAt)<=now)) {
    completedVisits.push(visitor.id);completedVisits=completedVisits.slice(-20);visitor=undefined
  }
  const canMirror=Boolean(pixels) && (companion?.clips.walk.frames.every(frame=>companion.mirroredFrames?.[frame]) ?? false)
  if(levelUp && now-levelUpStarted>=levelUp.durationMs)levelUp=levelUpPixels=undefined
  if(xpGain && now-xpGainStarted>=1800)xpGain=undefined
  const pose=activity.snapshot(now,travelLimit,canMirror,Boolean(levelUp || visitor))
  const value={state:pose.state,frame:companionFrame(companion,pose.state,pose.elapsed),offset:pose.offset,facing:pose.facing}
  if(visitor) {
    const elapsed=now-visitStarted,visit=visitPose(visitor.character.animation,elapsed,visitorTarget,visitorLimit)
    value.visit={id:visitor.id,...visit}
    value.state=visit.state==='kiss' ? 'kiss' : 'idle'
    value.frame=companionFrame(companion,value.state,Math.max(0,elapsed-1500))
    value.facing='left'
  }
  if(levelUp){
    if(now-levelUpStarted>=levelUp.durationMs)levelUp=undefined
    else if(!visitor){value.state='levelup';value.frame=levelUpFrame(levelUp,now-levelUpStarted);value.effect=levelUp.id}
  }
  if(xpGain)value.xp={amount:xpGain,elapsed:Math.max(0,now-xpGainStarted)}
  const signature=JSON.stringify(value)
  if(signature!==lastPose) {
    const previous=currentPose
    currentPose=value
    const moving=value.state==='walk' && Boolean(pixels) && travelLimit>0
    const guestMoving=value.visit?.state==='walk' && Boolean(visitorPixels) && visitorLimit>0
    const geometry=JSON.stringify([value.state==='levelup',moving,value.visit?.id,guestMoving,value.xp?.amount])
    if(imageSite?.geometry===geometry) {
      const png=value.state==='levelup' ? levelUp?.frames[value.frame] : (value.facing==='left' ? companion?.mirroredFrames?.[value.frame] : null) ?? companion?.frames[value.frame]
      try {
        const changed=previous?.frame!==value.frame || previous?.state!==value.state || previous?.facing!==value.facing || previous?.offset!==value.offset || previous?.effect!==value.effect
        const updates=changed && png ? [$.ui.blit({requestId:imageSite.id,key:'companion',source:(value.state==='levelup' ? levelUpCanvas(levelUpPixels,value.frame,value.facing,imageSite.baseColumns,travelLimit,value.offset,imageSite.pixelHeight) : pixelCanvas(pixels,value.frame,value.facing,imageSite.columns,imageSite.travel,value.offset,imageSite.pixelHeight,true)) ?? {png}})] : []
        if(value.xp && imageSite.xpHeight)updates.push($.ui.blit({requestId:imageSite.id,key:'xp-gain',source:xpCanvas(value.xp.amount,value.xp.elapsed,imageSite.baseColumns,travelLimit,value.offset,imageSite.xpHeight)}))
        if(value.visit && visitor && (previous?.visit?.frame!==value.visit.frame || previous?.visit?.facing!==value.visit.facing || previous?.visit?.offset!==value.visit.offset)) {
          const guest=visitor.character.animation,pose=value.visit
          const png=(pose.facing==='left' ? guest.mirroredFrames?.[pose.frame] : null) ?? guest.frames[pose.frame]
          updates.push($.ui.blit({requestId:imageSite.id,key:'visitor',source:pixelCanvas(visitorPixels,pose.frame,pose.facing,imageSite.columns,guestMoving?imageSite.visitorTravel:0,pose.offset,imageSite.pixelHeight,true) ?? {png}}))
        }
        if((await Promise.all(updates)).every(result=>!result.deny)) {lastPose=signature;return}
      } catch { /* Older surfaces repaint through the normal render path. */ }
      imageSite=undefined
    }
    lastPose=signature;await $.state.set(motionKey,value)
  }
}

function stopTimers() {
  for(const handle of [timer,motionTimer]) {
    if(typeof handle==='function')handle();else handle?.cancel()
  }
  timer=motionTimer=motionInterval=undefined
}

async function updateMotionTimer($) {
  const interval=loading ? LOADER_INTERVAL : companionPng && await showsPictures($) ? FRAME_INTERVAL : undefined
  if(ending || interval===motionInterval)return
  if(typeof motionTimer==='function')motionTimer();else motionTimer?.cancel()
  motionTimer=undefined;motionInterval=interval
  if(interval)motionTimer=$.clock.every(interval,()=>{void animate($,true)})
}

async function worker($, action = 'sync', usage,target) {
  if(action==='evolve' && (visitor || levelUp))return {error:'Wait for the current companion animation to finish before evolving.'}
  if (running) return
  running = true
  try {
    sessionId ??= await $.session.id()
    const sentFailures = failures.slice()
    const sentVisits=completedVisits.slice()
    const stream = $.process.spawn({argv:['node', '--no-warnings', `${$.plugin.root}/scripts/worker.mjs`],
      input: JSON.stringify({ action, sessionId,includeArt:await showsPictures($),artRevision,visitorArtRevision, appUrl: options.appUrl ?? 'http://localhost:3000', importHistory: options.importHistory !== false, usage, failures: sentFailures,completedVisits:sentVisits,...(target ? action==='levelup' ? parseLevelUpArguments(target) : action==='evolve' ? target : {target} : {}) }),
    })
    let stdout='',step
    do {step=await stream.next();if(!step.done && step.value.stream==='stdout')stdout+=step.value.text}while(!step.done)
    if (step.value?.code !== 0) throw new Error('Guildbyte needs Node 22.13+ and access to its local sync database.')
    const response=JSON.parse(stdout)
    const {pixels:decoded,levelUpPixels:effectPixels,visitorPixels:guestPixels,artRevision:revision,visitorArtRevision:guestRevision,...status}=response
    if(!status.connected || !status.character){companion=companionPng=pixels=artRevision=undefined}
    else {
      if(status.character.png!==undefined){companion=status.character.animation;companionPng=status.character.png;pixels=decoded}
      if(revision!==undefined)artRevision=revision
      const {png,animation,...metadata}=status.character;status.character=metadata
    }
    if(status.visit?.character.png!==undefined){guestCompanion=status.visit.character.animation;visitorPixels=guestPixels}
    if(guestRevision!==undefined)visitorArtRevision=guestRevision
    const incoming=status.visit && {...status.visit,character:{...status.visit.character,animation:guestCompanion}}
    if(status.visit){const {png,animation,...metadata}=status.visit.character;status.visit={...status.visit,character:metadata}}
    const previousCharacter=observedCharacter,nextCharacter=status.connected ? status.character : null
    if(previousCharacter && previousCharacter.id!==nextCharacter?.id)xpGain=levelUp=levelUpPixels=undefined
    if(!status.error && previousCharacter && previousCharacter.id===nextCharacter?.id && Number.isSafeInteger(previousCharacter.xp) && Number.isSafeInteger(nextCharacter?.xp) && nextCharacter.xp>previousCharacter.xp){
      xpGain=(xpGain ?? 0)+nextCharacter.xp-previousCharacter.xp;xpGainStarted=Date.now();imageSite=undefined;lastPose=undefined
    }
    observedCharacter=status.connected && status.character ? {id:status.character.id,level:status.character.level??1,xp:status.character.xp} : undefined
    if(status.levelUp){levelUpPixels=effectPixels;levelUp=status.levelUp;levelUpStarted=Date.now();lastPose=undefined;imageSite=undefined;const {frames,durations,...metadata}=status.levelUp;status.levelUp=metadata}
    if(!status.connected)levelUp=levelUpPixels=xpGain=undefined
    if(!status.connected)visitor=undefined
    if(!status.visit && !visitor){guestCompanion=visitorPixels=visitorArtRevision=undefined}
    else if(status.visit && status.visit.id!==visitor?.id && !completedVisits.includes(status.visit.id) && Date.parse(status.visit.expiresAt)>Date.now()) {
      visitor=incoming;visitStarted=Date.now();lastPose=undefined;imageSite=undefined
    }
    if(incoming?.id===visitor?.id)visitor=incoming
    if (!status.error) {failures.splice(0,sentFailures.length);completedVisits=completedVisits.filter(id=>!sentVisits.includes(id))}
    loading=false
    await $.state.set(statusKey, status)
    return status
  } catch (error) {
    const { value = {} } = await $.state.get(statusKey)
    loading=false
    await $.state.set(statusKey, { ...value, error: String(error.message ?? error) })
  } finally {
    running = false
    await updateMotionTimer($)
    if(!ending)void animate($,lastPose===undefined)
  }
}

let pictures
// Claude Code draws an Image with the kitty graphics protocol only (kitty, Ghostty, not through tmux);
// any other terminal (Orca, VS Code, Terminal.app) gets the alt text, so those get a status line instead.
async function showsPictures($) {
  pictures ??= !(await $.env.get('TMUX')) && ((await $.env.get('TERM'))==='xterm-kitty' || Boolean(await $.env.get('KITTY_WINDOW_ID')) || (await $.env.get('TERM_PROGRAM'))==='ghostty')
  return pictures
}

function statusLine(status) {
  const who=status.player ? `@${status.player.handle} · ${String(status.player.points).replace(/\B(?=(\d{3})+(?!\d))/g,',')} pts` : 'Guildbyte'
  return `● ${who} · ${status.pending ? `${status.pending} waiting to sync` : 'capturing'}`
}

async function sync($) {
  let usage
  try { usage = await $.session.usage() } catch { /* A fresh session may have no usage yet. */ }
  return worker($, 'sync', usage)
}

export function register(on, configuration = {}) {
  options = configuration
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    ending=false;lastInputAt=-Infinity;loading=true;loadingStarted=Date.now();companion=companionPng=pixels=visitor=guestCompanion=visitorPixels=undefined
    activity=companionActivity();lastPose=undefined;currentPose=imageSite=undefined;levelUp=levelUpPixels=xpGain=observedCharacter=undefined;artRevision=visitorArtRevision=undefined
    await $.command.register({ name: 'guildbyte-connect', description: 'Link this Claude account to Guildbyte' })
    await $.command.register({name:'guildbyte-evolve',description:'Evolve the pinned hero when its XP bar is full',immediate:true})
    await $.command.register({name:'guildbyte-levelup',argumentHint:'[1-5] [hero_id]',description:'Preview a gold level-up evolution without changing earned XP',immediate:true})
    await $.command.register({ name: 'guildbyte-sync', description: 'Retry pending activity uploads' })
    await $.command.register({name:'kiss',argumentHint:'<user_name>',description:'Send your character to kiss a player in their active Guildbyte session',immediate:true})
    for (const state of COMPANION_STATES) await $.command.register({ name: `guildbyte-${state}`, description: `Show your companion's ${state} pose` })
    await animate($)
    await updateMotionTimer($)
    timer ??= $.clock.every(10000, () => { if(Date.now()-lastInputAt>=250)void sync($) })
    void worker($,'status')
    return result
  })
  on('session.end', async ($, e, next) => {
    ending=true;stopTimers();await painting;currentPose=imageSite=levelUp=undefined
    await sync($)
    return next(e)
  })
  on('prompt.edit', async ($, e, next) => {
    lastInputAt=Date.now();activity.activity(lastInputAt)
    return next(e)
  })
  on('prompt.submit', async ($, e, next) => {
    lastInputAt=-Infinity;activity.activity(Date.now())
    void animate($)
    const result = await next(e)
    void sync($)
    return result
  })
  on('turn.start', async ($, e, next) => {
    activity.start(e.turnId,Date.now())
    void animate($)
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) { activity.finish(e.turnId,Date.now());void animate($,true);void sync($) }
    return result
  })
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {activity.start(e.turnId,Date.now());void animate($)}
    const stream=next(e)
    let result,ended=false
    try {
      while(true) {
        const item=await stream.next()
        if(item.done) {result=item.value;ended=true;break}
        if(!e.agentId) {
          const mode=item.value.kind==='text' ? 'talk' : ['thinking','tool','input'].includes(item.value.kind) ? 'walk' : null
          if(mode && activity.mode(mode,e.turnId))void animate($)
        }
        yield item.value
      }
    } finally {
      if(!ended)await stream.return?.()
      if(!e.agentId) {
        // Final steps also fire on desktop builds that omit turn.complete.
        if(ended && result?.stopReason==='tool_use')activity.mode('walk',e.turnId)
        else activity.finish(e.turnId,Date.now())
        void animate($,!ended || result?.stopReason!=='tool_use')
      }
    }
    if (result?.stopReason === 'model_context_window_exceeded') {
      failures.push({ kind: 'context', id: `${e.turnId}:${e.index}`, at: new Date().toISOString() })
      void sync($)
    }
    return result
  })
  on('classic.StopFailure', async ($, e, next) => {
    if (e.error === 'rate_limit') {
      failures.push({ kind: 'rate_limit', at: new Date().toISOString() })
      void sync($)
    }
    return next(e)
  })
  // Tokens come from persisted assistant message IDs, not both step and turn totals.
  // The periodic scanner also works on desktop builds that omit turn.complete.
  on('command.run', { command: 'guildbyte-connect' }, async $ => {
    const status = await worker($, 'connect')
    return { text: status?.linkUrl ? `Connect your Claude account: ${status.linkUrl}` : status?.error ?? 'Guildbyte is busy. Try /guildbyte-connect again.' }
  })
  on('command.run', { command: 'guildbyte-sync' }, async $ => {
    const status = await sync($)
    return { text: status?.error ?? `Guildbyte: ${status?.pending ?? 0} records waiting to sync.` }
  })
  on('command.run',{command:'guildbyte-evolve'},async $=>{
    const {value:status={}}=await $.state.get(statusKey)
    if(!status.character?.canLevelUp)return {text:'Earn the required XP before leveling up.'}
    const result=await worker($,'evolve',undefined,{characterId:status.character.id,level:status.character.level})
    return {text:result?.error ?? (result?.levelUp ? `Hero evolved to level ${result.levelUp.toLevel}.` : 'Guildbyte is syncing. Try again in a moment.')}
  })
  on('command.run',{command:'guildbyte-levelup'},async ($,e)=>{
    const target=e.args?.trim()??''
    if(!parseLevelUpArguments(target))return {text:'Use /guildbyte-levelup [1-5] [hero_id].'}
    if(visitor)return {text:'Wait for the current kiss visit to finish, then preview level-up.'}
    const status=await worker($,'levelup',undefined,target)
    await animate($,true)
    return {text:status?.levelUp ? `Gold evolution preview: level ${status.levelUp.fromLevel} → ${status.levelUp.toLevel}. Earned XP is unchanged.` : status?.error??'Guildbyte is syncing. Try again in a moment.'}
  })
  on('command.run',{command:'kiss'},async ($,e)=>{
    const target=e.args?.trim()
    if(!/^@?[a-z0-9_]{3,24}$/i.test(target ?? ''))return {text:'Use /kiss <Guildbyte handle>, for example /kiss @ayla.'}
    const status=await worker($,'kiss',undefined,target)
    return {text:status?.kiss ? `Kiss queued for @${status.kiss.target}. Your character, name and guild will appear in their terminal.` : status?.error ?? 'Guildbyte is syncing. Try /kiss again in a moment.'}
  })
  for (const state of COMPANION_STATES) on('command.run', { command: `guildbyte-${state}` }, async $ => {
    activity.preview(state,Date.now())
    await animate($,true)
    return { text: state==='idle' ? 'Guildbyte companion: automatic activity resumed.' : `Guildbyte companion: ${state}. Typing or /guildbyte-idle resumes automatic activity.` }
  })
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.maxRows===0) return next(e)
    const { Box, Image, Button,Text } = $.ui.resolve(e)
    const { value: status = {} } = await $.state.get(statusKey)
    if(loading) {
      const frame=LOADER_FRAMES[currentPose?.state==='loading' ? currentPose.frame : 0]
      const rows=Math.max(1,Math.min(3,e.props.maxRows ?? 3)),columns=Math.max(1,Math.min(6,e.props.bodyColumns))
      const pictures=await showsPictures($) && Image
      imageSite=pictures && typeof e.requestId==='string' ? {id:e.requestId,loader:true} : undefined
      const image=pictures ? Image({key:'loader',source:frame.image,columns,rows,alt:'Loading Guildbyte'}) : Text?.({children:rows<3?['▖','▘','▝','▗'][Math.floor(Math.max(0,Date.now()-loadingStarted)/LOADER_INTERVAL)%4]+' Loading Guildbyte':frame.text,dimColor:true,wrap:'truncate-end'})
      return image ? Box({width:e.props.bodyColumns,height:rows,flexDirection:'row',justifyContent:'flex-end',paddingRight:1,children:[image]}) : next(e)
    }
    const width=Math.max(1,e.props.bodyColumns),ornate=(e.props.maxRows ?? 5)>=7 && width>=24,actionRows=ornate ? 3 : 1
    const actions=[]
    if(status.error && status.connected!==false && Button)actions.push(Button({label:'Retry sync',onPress:()=>{void sync($)}}))
    if(!status.connected && (!status.error || status.connected===false) && Button)actions.push(Button({label:status.error ? 'Reconnect account' : 'Connect account',onPress:()=>{void worker($,'connect')}}))
    if(status.connected && status.character?.canLevelUp && status.character.level<5 && !levelUp && !visitor && Button)actions.push(Button({label:'Level up',variant:'primary',onPress:()=>{void worker($,'evolve',undefined,{characterId:status.character.id,level:status.character.level})}}))
    const progress=actions.length && ornate && status.connected && status.character && Text ? Text({children:status.character.level===5 ? 'Lv 5 · MAX' : `Lv ${status.character.level ?? 1} · ${status.character.xp ?? 0}/${status.character.nextLevelAt ?? 100} XP`,color:'#d7ad64',wrap:'truncate-end'}) : null
    const actionBar=actions.length ? Box({key:'actions',height:actionRows,flexDirection:'row',justifyContent:'center',alignItems:'center',gap:1,...(ornate?{borderStyle:'double',borderColor:'#d7ad64',paddingLeft:1,paddingRight:1}:{}),children:actions}) : null
    const centeredActions=actionBar ? Box({key:'action-section',width,height:actionRows+(progress?1:0),flexDirection:'column',alignItems:'center',justifyContent:'center',children:[...(progress?[progress]:[]),actionBar]}) : null
    if(!companionPng && (status.error || !status.connected || !status.character)) {
      const message=status.error ? Text?.({children:'Guildbyte unavailable · /guildbyte-sync to retry',dimColor:true,wrap:'truncate-end'}) : status.connected ? Text?.({children:'Open a chest in Guildbyte to get your hero',dimColor:true,wrap:'truncate-end'}) : null
      return centeredActions ?? (message ? Box({width,height:1,children:[message]}) : next(e))
    }
    if (!(await showsPictures($))) {
      const line=status.connected ? Text?.({ children: statusLine(status), dimColor: true, wrap: 'truncate-end' }) : Button?.({ label: 'Connect account', onPress: () => { void worker($, 'connect') } })
      return centeredActions ?? (line ? Box({width,height:1,children:[line]}) : next(e))
    }
    const { value: savedPose = { frame: 0, offset: 0, facing: 'right', state: 'idle' } } = await $.state.get(motionKey)
    const pose=currentPose ?? savedPose
    const visit=pose.visit?.id===status.visit?.id ? visitor : null
    const compact=width<60,sectionWidth=Math.max(1,Math.floor(width/(compact?2:3)))
    const available=Math.max(1,(e.props.maxRows ?? 7)-(compact && actionBar ? actionRows : 0))
    const labelRows=visit && available>1 ? 1 : 0
    const scale=pose.state==='levelup' ? levelUp?.renderScale??1 : 1
    // Keep the hero scale stable when the action row appears or disappears.
    const baseRows=Math.max(1,Math.min(5,(e.props.maxRows ?? 7)-actionRows-(pixels?1:0)))
    const rows=pose.state==='levelup' ? Math.max(1,Math.min(Math.ceil(baseColumns/2*scale),available-labelRows)) : baseRows+(pixels?1:0)
    const maxColumns=Math.min(10*scale,(pose.state==='levelup'?rows:baseRows)*2,Math.max(1,Math.floor(sectionWidth/1.5)))
    const columns=Math.max(1,pose.state==='levelup'?Math.floor(maxColumns):Math.floor(maxColumns/2)*2)
    if(pose.state!=='levelup')baseColumns=columns
    const home=Math.min(1,Math.floor(Math.max(0,sectionWidth-baseColumns*1.5)))
    travelLimit=Math.min(12,Math.floor(Math.max(0,sectionWidth-baseColumns*1.5-home)))
    visitorTarget=0
    visitorLimit=Math.min(12,Math.floor(Math.max(0,sectionWidth-columns*1.5-home)))
    const children = []
    const png = pose.state==='levelup' ? levelUp?.frames[pose.frame] : (pose.facing==='left' ? companion?.mirroredFrames?.[pose.frame] : null) ?? companion?.frames[pose.frame] ?? companionPng
    if (Image && png) {
      const moving=pose.state==='walk' && Boolean(pixels) && travelLimit>0
      const travel=moving ? travelLimit : 0
      const source=pose.state==='levelup' ? levelUpCanvas(levelUpPixels,pose.frame,pose.facing,baseColumns,travelLimit,pose.offset,Math.round(rows*256/baseColumns)) : pixelCanvas(pixels,pose.frame,pose.facing,columns,travel,pose.offset,Math.round(rows*256/columns),true)
      const drawColumns=source ? Math.ceil(pose.state==='levelup'?baseColumns*1.5+travelLimit:columns*1.5+travel) : columns
      const image=Image({ key:'companion', source: source ?? { png }, columns:drawColumns, rows, alt: `Your Guildbyte character: ${pose.state ?? 'idle'}` })
      children.push(status.connected ? Box({key:'player',position:'absolute',right:pose.state==='levelup' && !source ? Math.round(home+pose.offset-(columns-baseColumns)/2) : home,bottom:0,width:drawColumns,height:rows,children:[image]}) : image)
      if(visit) {
        const arrival=pose.visit,animation=visit.character.animation,guestMoving=arrival.state==='walk' && Boolean(visitorPixels) && visitorLimit>0
        const guestPng=(arrival.facing==='left' ? animation.mirroredFrames?.[arrival.frame] : null) ?? animation.frames[arrival.frame]
        children.push(Box({key:'visitors',position:'absolute',left:0,bottom:0,width:sectionWidth,height:rows,children:[Box({position:'absolute',right:home+(guestMoving ? 0 : arrival.offset),bottom:0,width:Math.ceil(columns*(visitorPixels?1.5:1)+(guestMoving ? visitorLimit : 0)),height:rows,
          children:[Image({key:'visitor',source:pixelCanvas(visitorPixels,arrival.frame,arrival.facing,columns,guestMoving?visitorLimit:0,arrival.offset,Math.round(rows*256/columns),true) ?? {png:guestPng},columns:Math.ceil(columns*(visitorPixels?1.5:1)+(guestMoving ? visitorLimit : 0)),rows,alt:`${visit.name}${visit.guild ? ' from '+visit.guild : ''}: ${arrival.state}`})]})]}))
        if(Text && labelRows)children.push(Box({position:'absolute',top:0,left:0,width:sectionWidth,height:1,children:[Text({children:`${visit.name} · ${visit.guild ? '<'+visit.guild+'>' : 'No guild'}`,wrap:'truncate-end'})]}))
      }
    }
    const popupRows=pose.xp ? Math.min(2,Math.max(1,available-rows-labelRows)) : 0
    const xpHeight=Math.max(1,Math.round(popupRows*256/baseColumns))
    imageSite=status.connected && typeof e.requestId==='string' ? {id:e.requestId,columns,baseColumns,xpHeight:pose.xp ? xpHeight : 0,pixelHeight:Math.round(rows*256/baseColumns),travel:pose.state==='walk' && pixels ? travelLimit : 0,visitorTravel:visitorPixels ? visitorLimit : 0,geometry:JSON.stringify([pose.state==='levelup',pose.state==='walk' && Boolean(pixels) && travelLimit>0,pose.visit?.id,pose.visit?.state==='walk' && Boolean(visitorPixels) && visitorLimit>0,pose.xp?.amount])} : undefined
    const canvasHeight=Math.min(available,rows+labelRows+popupRows)
    if(pose.xp && Image)children.push(Box({position:'absolute',right:home,bottom:Math.min(rows,available-popupRows),width:baseColumns*1.5+travelLimit,height:popupRows,children:[Image({key:'xp-gain',source:xpCanvas(pose.xp.amount,pose.xp.elapsed,baseColumns,travelLimit,pose.offset,xpHeight),columns:baseColumns*1.5+travelLimit,rows:popupRows,alt:`XP: +${pose.xp.amount}`})]}))
    if(actionBar && !compact)children.push(Box({key:'action-section',position:'absolute',left:sectionWidth,bottom:0,width:width-sectionWidth*2,height:Math.min(available,actionRows+(progress?1:0)),flexDirection:'column',alignItems:'center',justifyContent:'center',children:[...(progress?[progress]:[]),actionBar]}))
    const canvas=Box({key:'companion-sections',width,height:Math.min(available,canvasHeight),position:'relative',flexDirection:'row',justifyContent:'flex-end',alignItems:'flex-end',children})
    if(!actionBar || !compact)return canvas
    return Box({ width: e.props.bodyColumns, height:Math.min(e.props.maxRows ?? 10,canvasHeight+(actionBar ? actionRows : 0)), justifyContent:'flex-end',alignItems:'flex-end',flexDirection:'column',children:[centeredActions,canvas] })
  })
}
