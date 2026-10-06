import { COMPANION_STATES, companionFrame, companionActivity,visitPose } from '../scripts/companion-animation.mjs'
import { gaugeText, noticeText, rewardIcon, statusReport, visibleSignature } from '../scripts/progression.mjs'
import { DUEL_COMMAND, registerDuelCommands } from './duel-commands.mjs'

const statusKey = { plugin: 'guildbyte', key: 'status' }
const motionKey = { plugin: 'guildbyte', key: 'motion' }
const progressionKey = { plugin: 'guildbyte', key: 'progression' }
const chestKey = { plugin: 'guildbyte', key: 'chest' }

let options = {}
let failures = []
let running = false
let sessionId
let timer
let motionTimer
let bounceTimer
let companion
let activity = companionActivity()
let travelLimit = 12
let imageSite,currentPose
let lastPose
let visitor,visitStarted=0,completedVisits=[]
let visitorTarget=9,visitorLimit=24
let shownProgression,reducedMotion=false,chestPhase=0
// Set at session start until a sync completes; queued demotions show only then.
let startPending=false

async function animate($) {
  const now=Date.now()
  if(visitor && (now-visitStarted>=8000 || Date.parse(visitor.expiresAt)<=now)) {
    completedVisits.push(visitor.id);completedVisits=completedVisits.slice(-20);visitor=undefined
  }
  const canMirror=companion?.clips.walk.frames.every(frame=>companion.mirroredFrames?.[frame]) ?? false
  const pose=activity.snapshot(now,visitor ? 0 : travelLimit,canMirror)
  const value={state:pose.state,frame:companionFrame(companion,pose.state,pose.elapsed),offset:pose.offset,facing:pose.facing}
  if(visitor) {
    const elapsed=now-visitStarted,visit=visitPose(visitor.character.animation,elapsed,visitorTarget,visitorLimit)
    value.visit={id:visitor.id,...visit}
    value.state=visit.state==='kiss' ? 'kiss' : 'idle'
    value.frame=companionFrame(companion,value.state,Math.max(0,elapsed-1500))
    value.offset=0;value.facing='left'
  }
  const signature=JSON.stringify(value)
  if(signature!==lastPose) {
    currentPose=value
    const geometry=JSON.stringify([value.state,value.offset,value.visit?.id,value.visit?.offset])
    if(imageSite?.geometry===geometry) {
      const png=(value.facing==='left' ? companion?.mirroredFrames?.[value.frame] : null) ?? companion?.frames[value.frame]
      try {
        const updates=png ? [$.ui.blit({requestId:imageSite.id,key:'companion',source:{png}})] : []
        if(value.visit && visitor) {
          const guest=visitor.character.animation,pose=value.visit
          const png=(pose.facing==='left' ? guest.mirroredFrames?.[pose.frame] : null) ?? guest.frames[pose.frame]
          updates.push($.ui.blit({requestId:imageSite.id,key:'visitor',source:{png}}))
        }
        if(updates.length && (await Promise.all(updates)).every(result=>!result.deny)) {lastPose=signature;return}
      } catch { /* Older surfaces repaint through the normal render path. */ }
      imageSite=undefined
    }
    lastPose=signature;await $.state.set(motionKey,value)
  }
}

// The chest hops between two half-block frames while a reward is claimable;
// with reduced motion it stays still.
async function bounce($) {
  const phase=!reducedMotion && rewardIcon(shownProgression?.value)==='chest' ? 1-chestPhase : 0
  if(phase!==chestPhase) {chestPhase=phase;await $.state.set(chestKey,phase)}
}

// The gauge redraws only when what it shows changes; notices arrive once.
async function showProgression($,status) {
  const progression=status.connected ? status.progression ?? null : null
  const signature=visibleSignature(progression)
  if(signature!==shownProgression?.signature) {
    shownProgression={signature,value:progression}
    await $.state.set(progressionKey,progression)
  }
  for(const notice of status.notices ?? []) {
    $.ui.toast(noticeText(notice),{timeoutMs:notice.kind==='demotion' ? 4000 : 8000})
    if(notice.kind==='promotion') {activity.preview('victory',Date.now());await animate($)}
  }
}

function stopTimers() {
  for(const handle of [timer,motionTimer,bounceTimer]) {
    if(typeof handle==='function')handle();else handle?.cancel()
  }
  timer=motionTimer=bounceTimer=undefined
}

async function worker($, action = 'sync', usage,target) {
  if (running) return
  running = true
  try {
    sessionId ??= await $.session.id()
    // The status action reads the cache only, so it neither sends nor clears queued reports.
    const sentFailures = action==='status' ? [] : failures.slice()
    const sentVisits=action==='status' ? [] : completedVisits.slice()
    const starting=action!=='status' && startPending
    const result = await $.process.run(['node', '--no-warnings', `${$.plugin.root}/scripts/worker.mjs`], {
      stdin: JSON.stringify({ action, sessionId, appUrl: options.appUrl ?? 'http://localhost:3000', usage, failures: sentFailures,completedVisits:sentVisits,...(starting ? {sessionStart:true} : {}),...(target ? {target} : {}) }),
      timeoutMs: 25000,
    })
    if (result.exitCode !== 0) throw new Error('Guildbyte needs Node 22.13+ and access to its local sync database.')
    const status = JSON.parse(result.stdout)
    if (starting) startPending=false
    companion = status.connected ? status.character?.animation : null
    if(!status.connected)visitor=undefined
    else if(status.visit && status.visit.id!==visitor?.id && !completedVisits.includes(status.visit.id) && Date.parse(status.visit.expiresAt)>Date.now()) {
      visitor=status.visit;visitStarted=Date.now()
    }
    if (!status.error) {failures.splice(0,sentFailures.length);completedVisits=completedVisits.filter(id=>!sentVisits.includes(id))}
    await $.state.set(statusKey, status)
    await showProgression($,status)
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

// One reward icon: the coin, replaced by the chest once the chest is claimable.
// It stays until every reward is claimed or the day expires.
function gaugeLine({Text,Link},progression,phase) {
  const icon=rewardIcon(progression)
  const children=[gaugeText(progression)]
  if(icon==='gold')children.push('  ',Text({children:'◉ gold',color:'yellow'}))
  if(icon==='chest')children.push('  ',Text({children:phase ? '▀▀' : '▄▄',color:'yellow'}),' chest')
  if(icon)children.push(' · ',Link ? Link({href:progression.claimUrl,label:'Claim in Guildbyte ↗'}) : `Claim in Guildbyte: ${progression.claimUrl}`)
  return Text({children,wrap:'truncate-end'})
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
    activity=companionActivity();lastPose=undefined;currentPose=imageSite=undefined;shownProgression=undefined;chestPhase=0;startPending=true
    await $.state.set(chestKey,0)
    try { reducedMotion=(await $.settings.read())?.prefersReducedMotion===true } catch { reducedMotion=false }
    await $.command.register({ name: 'guildbyte-connect', description: 'Link this Claude account to Guildbyte' })
    await $.command.register({ name: 'guildbyte-sync', description: 'Retry pending activity uploads' })
    await $.command.register({ name: 'guildbyte-status', description: 'Show your daily gauge, streak and unclaimed rewards' })
    await $.command.register({name:'kiss',argumentHint:'<user_name>',description:'Send your character to kiss a player in their active Guildbyte session',immediate:true})
    await $.command.register(DUEL_COMMAND)
    for (const state of COMPANION_STATES) await $.command.register({ name: `guildbyte-${state}`, description: `Show your companion's ${state} pose` })
    await sync($)
    await animate($)
    timer ??= $.clock.every(10000, () => { void sync($) })
    motionTimer ??= $.clock.every(50, () => { void animate($) })
    bounceTimer ??= $.clock.every(500, () => { void bounce($) })
    return result
  })
  on('session.end', async ($, e, next) => {
    stopTimers();currentPose=imageSite=undefined
    await sync($)
    return next(e)
  })
  on('prompt.edit', async ($, e, next) => {
    activity.activity(Date.now())
    const result=await next(e)
    await animate($)
    return result
  })
  on('prompt.submit', async ($, e, next) => {
    activity.activity(Date.now())
    await animate($)
    const result = await next(e)
    await sync($)
    return result
  })
  on('turn.start', async ($, e, next) => {
    activity.start(e.turnId,Date.now())
    await animate($)
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) { activity.finish(e.turnId,Date.now());await animate($);await sync($) }
    return result
  })
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {activity.start(e.turnId,Date.now());await animate($)}
    const stream=next(e)
    let result,ended=false
    try {
      while(true) {
        const item=await stream.next()
        if(item.done) {result=item.value;ended=true;break}
        if(!e.agentId) {
          const mode=item.value.kind==='text' ? 'talk' : ['thinking','tool','input'].includes(item.value.kind) ? 'walk' : null
          if(mode && activity.mode(mode,e.turnId))await animate($)
        }
        yield item.value
      }
    } finally {
      if(!ended)await stream.return?.()
      if(!e.agentId) {
        // Final steps also fire on desktop builds that omit turn.complete.
        if(ended && result?.stopReason==='tool_use')activity.mode('walk',e.turnId)
        else activity.finish(e.turnId,Date.now())
        await animate($)
      }
    }
    if (result?.stopReason === 'model_context_window_exceeded') {
      failures.push({ kind: 'context', id: `${e.turnId}:${e.index}`, at: new Date().toISOString() })
      await sync($)
    }
    return result
  })
  on('classic.StopFailure', async ($, e, next) => {
    if (e.error === 'rate_limit') {
      failures.push({ kind: 'rate_limit', at: new Date().toISOString() })
      await sync($)
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
  on('command.run', { command: 'guildbyte-status' }, async $ => {
    const status = await worker($, 'status') ?? (await $.state.get(statusKey)).value
    return { text: statusReport(status) }
  })
  on('command.run',{command:'kiss'},async ($,e)=>{
    const target=e.args?.trim()
    if(!/^@?[a-z0-9_]{3,24}$/i.test(target ?? ''))return {text:'Use /kiss <Guildbyte handle>, for example /kiss @ayla.'}
    const status=await worker($,'kiss',undefined,target)
    return {text:status?.kiss ? `Kiss queued for @${status.kiss.target}. Your character, name and guild will appear in their terminal.` : status?.error ?? 'Guildbyte is syncing. Try /kiss again in a moment.'}
  })
  registerDuelCommands(on,worker)
  for (const state of COMPANION_STATES) on('command.run', { command: `guildbyte-${state}` }, async $ => {
    activity.preview(state,Date.now())
    await animate($)
    return { text: state==='idle' ? 'Guildbyte companion: automatic activity resumed.' : `Guildbyte companion: ${state}. Typing or /guildbyte-idle resumes automatic activity.` }
  })
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.maxRows===0) return next(e)
    const { Box, Image, Button,Text,Link } = $.ui.resolve(e)
    const { value: status = {} } = await $.state.get(statusKey)
    const { value: progression = null } = await $.state.get(progressionKey)
    const { value: phase = 0 } = await $.state.get(chestKey)
    const gauge=status.connected && progression && Text ? gaugeLine({Text,Link},progression,phase) : null
    if (!(await showsPictures($))) {
      const line=status.connected ? Text?.({ children: statusLine(status), dimColor: true, wrap: 'truncate-end' }) : Button?.({ label: 'Connect account', onPress: () => { void worker($, 'connect') } })
      if (!line) return next(e)
      const lines=gauge && (e.props.maxRows ?? 5)>1 ? [gauge,line] : [line]
      return Box({ width: e.props.bodyColumns, height: lines.length, flexDirection: 'column', alignItems: 'flex-end', paddingRight: 1, children: lines })
    }
    const { value: savedPose = { frame: 0, offset: 0, facing: 'right', state: 'idle' } } = await $.state.get(motionKey)
    const pose=currentPose ?? savedPose
    const visit=pose.visit?.id===status.visit?.id ? status.visit : null
    const labelRows=visit && (e.props.maxRows ?? 5)>1 ? 1 : 0
    const rows = Math.max(1, Math.min(4, (e.props.maxRows ?? 5)-labelRows))
    const width=Math.max(1,e.props.bodyColumns),columns=Math.min(8,rows*2,visit && width>=3 ? Math.floor((width-1)/2) : width),home=Math.min(1,width-columns)
    travelLimit=Math.min(12,Math.max(0,width-columns-home))
    visitorTarget=width>=columns*2+home+1 ? columns+1 : 0
    visitorLimit=Math.max(visitorTarget,Math.min(24,width-columns-home))
    const children = []
    if (!status.connected && Button) children.push(Button({ label: 'Connect account', onPress: () => { void worker($, 'connect') } }))
    // The gauge sits left of the companion's walking range.
    const gaugeWidth=width-columns-travelLimit-home-2
    if (gauge && gaugeWidth>=12) children.push(Box({position:'absolute',left:0,bottom:0,width:gaugeWidth,height:1,flexDirection:'row',justifyContent:'flex-end',children:[gauge]}))
    const png = (pose.facing==='left' ? status.character?.animation?.mirroredFrames?.[pose.frame] : null) ?? status.character?.animation?.frames[pose.frame] ?? status.character?.png
    if (Image) {
      const image=Image({ key:'companion', source: status.connected && png ? { png } : { file: `${$.plugin.root}/assets/mage.png`, format: 'png' }, columns, rows, alt: status.connected && status.character ? `Your Guildbyte character: ${pose.state ?? 'idle'}` : 'Guildbyte pixel-art mage' })
      if(!visit || visitorTarget>0)children.push(status.connected ? Box({position:'absolute',right:home+Math.min(travelLimit,pose.offset ?? 0),bottom:0,width:columns,height:rows,children:[image]}) : image)
      if(visit) {
        const arrival=pose.visit,animation=visit.character.animation
        const guestPng=(arrival.facing==='left' ? animation.mirroredFrames?.[arrival.frame] : null) ?? animation.frames[arrival.frame]
        children.push(Box({position:'absolute',right:home+Math.min(visitorLimit,arrival.offset),bottom:0,width:columns,height:rows,
          children:[Image({key:'visitor',source:{png:guestPng},columns,rows,alt:`${visit.name}${visit.guild ? ' from '+visit.guild : ''}: ${arrival.state}`})]}))
        if(Text && labelRows)children.push(Box({position:'absolute',top:0,right:0,width,height:1,children:[Text({children:`${visit.name} · ${visit.guild ? '<'+visit.guild+'>' : 'No guild'}`,wrap:'truncate-end'})]}))
      }
    }
    imageSite=status.connected && typeof e.requestId==='string' ? {id:e.requestId,geometry:JSON.stringify([pose.state,pose.offset,pose.visit?.id,pose.visit?.offset])} : undefined
    return Box({ width: e.props.bodyColumns, height: rows+labelRows, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'flex-end', gap: 1, paddingRight: 1, children })
  })
}
