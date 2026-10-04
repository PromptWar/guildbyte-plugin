export const COMPANION_STATES = ['idle','walk','sit','talk','kiss','wave','laugh','angry','victory','sleep']

export function validPng(png) {
  return typeof png === 'string' && png.length <= 64 * 1024 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(png) &&
    Buffer.from(png,'base64').subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
}

export function validateAnimation(value) {
  if(!value || value.version !== 1 || !Array.isArray(value.frames) || value.frames.length !== 20 ||
     value.frames.some(png=>!validPng(png)) || value.frames.reduce((n,p)=>n+p.length,0)>512*1024 || !value.clips) return null
  const clips={}
  for(const state of COMPANION_STATES) {
    const clip=value.clips[state]
    if(!clip || !Array.isArray(clip.frames) || !Array.isArray(clip.durations) || !clip.frames.length || clip.frames.length>24 ||
       clip.frames.length!==clip.durations.length || clip.frames.some(i=>!Number.isInteger(i)||i<0||i>=20) ||
       clip.durations.some(ms=>!Number.isFinite(ms)||ms<60||ms>10000)) return null
    clips[state]={frames:clip.frames,durations:clip.durations}
  }
  let mirroredFrames
  if(value.mirroredFrames !== undefined) {
    if(!value.mirroredFrames || typeof value.mirroredFrames !== 'object' || Array.isArray(value.mirroredFrames)) return null
    const entries=Object.entries(value.mirroredFrames)
    if(entries.length>20 || entries.some(([frame,png])=>!/^\d+$/.test(frame) || String(Number(frame))!==frame || Number(frame)>=20 || !validPng(png)) ||
       entries.reduce((n,[,png])=>n+png.length,0)>512*1024) return null
    mirroredFrames=Object.fromEntries(entries)
  }
  return {version:1,frames:value.frames,clips,...(mirroredFrames ? {mirroredFrames} : {})}
}

// Only activity timestamps and phase names are retained, never keyboard text.
export function companionActivity(now = Date.now()) {
  let lastActivity=now, turn, working='walk', manual, state='idle', started=now
  let position=0, direction=1, previous=now
  return {
    activity(at) { lastActivity=at;manual=undefined },
    start(id,at) { turn=id;working='walk';lastActivity=at;manual=undefined },
    mode(value,id) { if(turn!==id)return false;const changed=working!==value;working=value;return changed },
    finish(id,at) { if(turn!==id)return;turn=undefined;lastActivity=at },
    preview(value,at) { manual=value==='idle' ? undefined : value;lastActivity=at },
    snapshot(at,limit=12,canMirror=true) {
      const desired=manual ?? (turn ? working : at-lastActivity>=90000 ? 'sleep' : at-lastActivity>=20000 ? 'sit' : 'idle')
      const distance=Math.max(0,Math.min(12,limit)),step=Math.max(0,Math.min(250,at-previous))*4/1000
      previous=at;position=Math.min(position,distance)
      let facing='right',pose=desired
      if(!canMirror) position=0
      else if(desired==='walk' && distance>0) {
        if(position===0)direction=1
        if(position===distance)direction=-1
        position=Math.max(0,Math.min(distance,position+direction*step))
        facing=direction>0 ? 'left' : 'right'
      } else if(position>0) {
        position=Math.max(0,position-step)
        if(position>0)pose='walk'
      }
      if(state!==pose) {state=pose;started=at}
      return {state,elapsed:Math.max(0,at-started),offset:Math.round(position),facing}
    },
  }
}

export function companionFrame(animation,state,elapsed) {
  const clip=animation?.clips[state] ?? animation?.clips.idle
  if(!clip) return 0
  let time=Math.max(0,elapsed)%clip.durations.reduce((a,b)=>a+b,0)
  for(let i=0;i<clip.frames.length;i++) { if(time<clip.durations[i])return clip.frames[i];time-=clip.durations[i] }
  return clip.frames[0]
}

export function visitPose(animation,elapsed,target,limit) {
  const arriving=elapsed<1500,leaving=elapsed>=6500
  const state=arriving || leaving ? 'walk' : 'kiss'
  const far=Math.max(target,Math.min(limit,target+12))
  const progress=arriving ? Math.max(0,elapsed)/1500 : leaving ? Math.min(1,(elapsed-6500)/1500) : 0
  return {frame:companionFrame(animation,state,elapsed),state,facing:leaving ? 'left' : 'right',
    offset:Math.round(arriving ? far+(target-far)*progress : leaving ? target+(far-target)*progress : target)}
}
