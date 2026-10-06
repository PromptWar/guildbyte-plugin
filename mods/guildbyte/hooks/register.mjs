import {pixelCanvas} from '../scripts/companion-pixels.mjs'
import { COMPANION_STATES, companionFrame, companionActivity,visitPose,levelUpFrame,parseLevelUpArguments } from '../scripts/companion-animation.mjs'

const statusKey = { plugin: 'guildbyte', key: 'status' }
const motionKey = { plugin: 'guildbyte', key: 'motion' }

let options = {}
let failures = []
let running = false
let sessionId
let timer
let motionTimer
let companion,companionPng,pixels,guestCompanion,visitorPixels,artRevision,visitorArtRevision,observedCharacter,levelUp,levelUpStarted=0
let activity = companionActivity()
let travelLimit = 12
let imageSite,currentPose
let lastPose
let visitor,visitStarted=0,completedVisits=[]
let visitorTarget=9,visitorLimit=24

let painting,paintAgain=false
function animate($) {
  if(painting){paintAgain=true;return painting}
  return painting=(async()=>{
    try {await paint($)}
    finally {painting=undefined;if(paintAgain){paintAgain=false;void animate($)}}
  })()
}

async function paint($) {
  const now=Date.now()
  if(visitor && (now-visitStarted>=8000 || Date.parse(visitor.expiresAt)<=now)) {
    completedVisits.push(visitor.id);completedVisits=completedVisits.slice(-20);visitor=undefined
  }
  const canMirror=Boolean(pixels) && (companion?.clips.walk.frames.every(frame=>companion.mirroredFrames?.[frame]) ?? false)
  const pose=activity.snapshot(now,visitor || levelUp ? 0 : travelLimit,canMirror)
  const value={state:pose.state,frame:companionFrame(companion,pose.state,pose.elapsed),offset:pose.offset,facing:pose.facing}
  if(visitor) {
    const elapsed=now-visitStarted,visit=visitPose(visitor.character.animation,elapsed,visitorTarget,visitorLimit)
    value.visit={id:visitor.id,...visit}
    value.state=visit.state==='kiss' ? 'kiss' : 'idle'
    value.frame=companionFrame(companion,value.state,Math.max(0,elapsed-1500))
    value.offset=0;value.facing='left'
  }
  if(levelUp){
    if(now-levelUpStarted>=levelUp.durationMs)levelUp=undefined
    else if(!visitor){value.state='levelup';value.frame=levelUpFrame(levelUp,now-levelUpStarted);value.facing='right';value.offset=0;value.effect=levelUp.id}
  }
  const signature=JSON.stringify(value)
  if(signature!==lastPose) {
    currentPose=value
    const moving=value.state==='walk' && Boolean(pixels) && travelLimit>0
    const guestMoving=value.visit?.state==='walk' && Boolean(visitorPixels) && visitorLimit>0
    const geometry=JSON.stringify([value.state==='levelup',moving,value.visit?.id,guestMoving])
    if(imageSite?.geometry===geometry) {
      const png=value.state==='levelup' ? levelUp?.frames[value.frame] : (value.facing==='left' ? companion?.mirroredFrames?.[value.frame] : null) ?? companion?.frames[value.frame]
      try {
        const updates=png ? [$.ui.blit({requestId:imageSite.id,key:'companion',source:(!moving ? null : pixelCanvas(pixels,value.frame,value.facing,imageSite.columns,imageSite.travel,value.offset)) ?? {png}})] : []
        if(value.visit && visitor) {
          const guest=visitor.character.animation,pose=value.visit
          const png=(pose.facing==='left' ? guest.mirroredFrames?.[pose.frame] : null) ?? guest.frames[pose.frame]
          updates.push($.ui.blit({requestId:imageSite.id,key:'visitor',source:(guestMoving ? pixelCanvas(visitorPixels,pose.frame,pose.facing,imageSite.columns,imageSite.visitorTravel,pose.offset) : null) ?? {png}}))
        }
        if(updates.length && (await Promise.all(updates)).every(result=>!result.deny)) {lastPose=signature;return}
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
  timer=motionTimer=undefined;paintAgain=false
}

async function worker($, action = 'sync', usage,target) {
  if (running) return
  running = true
  try {
    sessionId ??= await $.session.id()
    const sentFailures = failures.slice()
    const sentVisits=completedVisits.slice()
    const stream = $.process.spawn({argv:['node', '--no-warnings', `${$.plugin.root}/scripts/worker.mjs`],
      input: JSON.stringify({ action, sessionId,includeArt:await showsPictures($),artRevision,visitorArtRevision, appUrl: options.appUrl ?? 'http://localhost:3000', importHistory: options.importHistory !== false, usage, failures: sentFailures,completedVisits:sentVisits,observedCharacter,...(target ? action==='levelup' ? parseLevelUpArguments(target) : {target} : {}) }),
    })
    let stdout='',step
    do {step=await stream.next();if(!step.done && step.value.stream==='stdout')stdout+=step.value.text}while(!step.done)
    if (step.value?.code !== 0) throw new Error('Guildbyte needs Node 22.13+ and access to its local sync database.')
    const response=JSON.parse(stdout)
    const {pixels:decoded,visitorPixels:guestPixels,artRevision:revision,visitorArtRevision:guestRevision,...status}=response
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
    observedCharacter=status.connected && status.character ? {id:status.character.id,level:status.character.level??1} : undefined
    if(status.levelUp){levelUp=status.levelUp;levelUpStarted=Date.now();lastPose=undefined;imageSite=undefined;const {frames,durations,...metadata}=status.levelUp;status.levelUp=metadata}
    if(!status.connected)levelUp=undefined
    if(!status.connected)visitor=undefined
    if(!status.visit && !visitor){guestCompanion=visitorPixels=visitorArtRevision=undefined}
    else if(status.visit && status.visit.id!==visitor?.id && !completedVisits.includes(status.visit.id) && Date.parse(status.visit.expiresAt)>Date.now()) {
      visitor=incoming;visitStarted=Date.now()
    }
    if(incoming?.id===visitor?.id)visitor=incoming
    if (!status.error) {failures.splice(0,sentFailures.length);completedVisits=completedVisits.filter(id=>!sentVisits.includes(id))}
    await $.state.set(statusKey, status)
    return status
  } catch (error) {
    const { value = {} } = await $.state.get(statusKey)
    await $.state.set(statusKey, { ...value, error: String(error.message ?? error) })
  } finally {
    running = false
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
    activity=companionActivity();lastPose=undefined;currentPose=imageSite=undefined;levelUp=observedCharacter=undefined;artRevision=visitorArtRevision=undefined
    await $.command.register({ name: 'guildbyte-connect', description: 'Link this Claude account to Guildbyte' })
    await $.command.register({name:'guildbyte-levelup',argumentHint:'[1-5] [hero_id]',description:'Preview a gold level-up evolution without changing earned XP',immediate:true})
    await $.command.register({ name: 'guildbyte-sync', description: 'Retry pending activity uploads' })
    await $.command.register({name:'kiss',argumentHint:'<user_name>',description:'Send your character to kiss a player in their active Guildbyte session',immediate:true})
    for (const state of COMPANION_STATES) await $.command.register({ name: `guildbyte-${state}`, description: `Show your companion's ${state} pose` })
    await sync($)
    await animate($)
    timer ??= $.clock.every(10000, () => { void sync($) })
    if(await showsPictures($))motionTimer ??= $.clock.every(50, () => { void animate($) })
    return result
  })
  on('session.end', async ($, e, next) => {
    stopTimers();await painting;currentPose=imageSite=levelUp=undefined
    await sync($)
    return next(e)
  })
  on('prompt.edit', async ($, e, next) => {
    activity.activity(Date.now())
    const result=await next(e)
    void animate($)
    return result
  })
  on('prompt.submit', async ($, e, next) => {
    activity.activity(Date.now())
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
    if (!e.agentId) { activity.finish(e.turnId,Date.now());void animate($);void sync($) }
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
        void animate($)
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
  on('command.run',{command:'guildbyte-levelup'},async ($,e)=>{
    const target=e.args?.trim()??''
    if(!parseLevelUpArguments(target))return {text:'Use /guildbyte-levelup [1-5] [hero_id].'}
    if(visitor)return {text:'Wait for the current kiss visit to finish, then preview level-up.'}
    const status=await worker($,'levelup',undefined,target)
    await animate($)
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
    await animate($)
    return { text: state==='idle' ? 'Guildbyte companion: automatic activity resumed.' : `Guildbyte companion: ${state}. Typing or /guildbyte-idle resumes automatic activity.` }
  })
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.maxRows===0) return next(e)
    const { Box, Image, Button,Text } = $.ui.resolve(e)
    const { value: status = {} } = await $.state.get(statusKey)
    if (!(await showsPictures($))) {
      const line=status.connected ? Text?.({ children: statusLine(status), dimColor: true, wrap: 'truncate-end' }) : Button?.({ label: 'Connect account', onPress: () => { void worker($, 'connect') } })
      if (!line) return next(e)
      return Box({ width: e.props.bodyColumns, height: 1, flexDirection: 'row', justifyContent: 'flex-end', paddingRight: 1, children: [line] })
    }
    const { value: savedPose = { frame: 0, offset: 0, facing: 'right', state: 'idle' } } = await $.state.get(motionKey)
    const pose=currentPose ?? savedPose
    const visit=pose.visit?.id===status.visit?.id ? visitor : null
    const labelRows=visit && (e.props.maxRows ?? 5)>1 ? 1 : 0
    const scale=pose.state==='levelup' ? levelUp?.renderScale??1 : 1
    const rows = Math.max(1, Math.min(4*scale, (e.props.maxRows ?? 5)-labelRows))
    const width=Math.max(1,e.props.bodyColumns),columns=Math.min(8*scale,rows*2,visit && width>=3 ? Math.floor((width-1)/2) : width),home=Math.min(1,width-columns)
    travelLimit=Math.min(12,Math.max(0,width-columns-home))
    visitorTarget=width>=columns*2+home+1 ? columns+1 : 0
    visitorLimit=Math.max(visitorTarget,Math.min(24,width-columns-home))
    const children = []
    if (!status.connected && Button) children.push(Button({ label: 'Connect account', onPress: () => { void worker($, 'connect') } }))
    const png = pose.state==='levelup' ? levelUp?.frames[pose.frame] : (pose.facing==='left' ? companion?.mirroredFrames?.[pose.frame] : null) ?? companion?.frames[pose.frame] ?? companionPng
    if (Image) {
      const moving=pose.state==='walk' && Boolean(pixels) && travelLimit>0
      const travel=moving ? travelLimit : 0
      const source=!moving ? null : pixelCanvas(pixels,pose.frame,pose.facing,columns,travel,pose.offset)
      const image=Image({ key:'companion', source: status.connected && png ? source ?? { png } : { file: `${$.plugin.root}/assets/cash-cow.png`, format: 'png' }, columns:columns+travel, rows, alt: status.connected && status.character ? `Your Guildbyte character: ${pose.state ?? 'idle'}` : 'The Cash Cow Solopreneur' })
      if(!visit || visitorTarget>0)children.push(status.connected ? Box({position:'absolute',right:home,bottom:0,width:columns+travel,height:rows,children:[image]}) : image)
      if(visit) {
        const arrival=pose.visit,animation=visit.character.animation,guestMoving=arrival.state==='walk' && Boolean(visitorPixels) && visitorLimit>0
        const guestPng=(arrival.facing==='left' ? animation.mirroredFrames?.[arrival.frame] : null) ?? animation.frames[arrival.frame]
        children.push(Box({position:'absolute',right:home+(guestMoving ? 0 : arrival.offset),bottom:0,width:columns+(guestMoving ? visitorLimit : 0),height:rows,
          children:[Image({key:'visitor',source:(guestMoving ? pixelCanvas(visitorPixels,arrival.frame,arrival.facing,columns,visitorLimit,arrival.offset) : null) ?? {png:guestPng},columns:columns+(guestMoving ? visitorLimit : 0),rows,alt:`${visit.name}${visit.guild ? ' from '+visit.guild : ''}: ${arrival.state}`})]}))
        if(Text && labelRows)children.push(Box({position:'absolute',top:0,right:0,width,height:1,children:[Text({children:`${visit.name} · ${visit.guild ? '<'+visit.guild+'>' : 'No guild'}`,wrap:'truncate-end'})]}))
      }
    }
    imageSite=status.connected && typeof e.requestId==='string' ? {id:e.requestId,columns,travel:pose.state==='walk' && pixels ? travelLimit : 0,visitorTravel:visitorPixels ? visitorLimit : 0,geometry:JSON.stringify([pose.state==='levelup',pose.state==='walk' && Boolean(pixels) && travelLimit>0,pose.visit?.id,pose.visit?.state==='walk' && Boolean(visitorPixels) && visitorLimit>0])} : undefined
    return Box({ width: e.props.bodyColumns, height: rows+labelRows, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'flex-end', gap: 1, paddingRight: 1, children })
  })
}
