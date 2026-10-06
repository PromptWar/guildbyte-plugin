export const COMPANION_STATES = ['idle','walk','sit','talk','kiss','wave','laugh','angry','victory','sleep']

export function validPng(png,limit=64*1024) {
  return typeof png === 'string' && png.length <= limit &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(png) &&
    Buffer.from(png,'base64').subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
}

export function validateAnimation(value) {
  if(!value || value.version !== 1 || !Array.isArray(value.frames) || ![20,24,28,32].includes(value.frames.length) ||
     value.frames.some(png=>!validPng(png)) || value.frames.reduce((n,p)=>n+p.length,0)>1024*1024 || !value.clips) return null
  const clips={}
  for(const state of COMPANION_STATES) {
    const clip=value.clips[state]
    if(!clip || !Array.isArray(clip.frames) || !Array.isArray(clip.durations) || !clip.frames.length || clip.frames.length>24 ||
       clip.frames.length!==clip.durations.length || clip.frames.some(i=>!Number.isInteger(i)||i<0||i>=value.frames.length) ||
       clip.durations.some(ms=>!Number.isFinite(ms)||ms<60||ms>10000)) return null
    clips[state]={frames:clip.frames,durations:clip.durations}
  }
  let mirroredFrames
  if(value.mirroredFrames !== undefined) {
    if(!value.mirroredFrames || typeof value.mirroredFrames !== 'object' || Array.isArray(value.mirroredFrames)) return null
    const entries=Object.entries(value.mirroredFrames)
    if(entries.length>value.frames.length || entries.some(([frame,png])=>!/^\d+$/.test(frame) || String(Number(frame))!==frame || Number(frame)>=value.frames.length || !validPng(png)) ||
       entries.reduce((n,[,png])=>n+png.length,0)>1024*1024) return null
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
    preview(value,at) { manual=value==='idle' ? undefined : value;lastActivity=at;state=undefined },
    snapshot(at,limit=12,canMirror=true) {
      const desired=manual ?? (turn ? working : at-lastActivity>=90000 ? 'sleep' : at-lastActivity>=20000 ? 'sit' : 'idle')
      const distance=Math.max(0,Math.min(12,limit)),step=Math.max(0,Math.min(250,at-previous))*1.6/1000
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
  const duration=clip.durations.reduce((a,b)=>a+b,0)
  let time=state==='sleep' || state==='kiss' ? Math.min(Math.max(0,elapsed),duration-1) : Math.max(0,elapsed)%duration
  for(let i=0;i<clip.frames.length;i++) { if(time<clip.durations[i])return clip.frames[i];time-=clip.durations[i] }
  return clip.frames[0]
}

export function visitPose(animation,elapsed,target,limit) {
  const arriving=elapsed<1500,leaving=elapsed>=6500
  const state=arriving || leaving ? 'walk' : 'kiss'
  const far=Math.max(target,Math.min(limit,target+12))
  const progress=arriving ? Math.max(0,elapsed)/1500 : leaving ? Math.min(1,(elapsed-6500)/1500) : 0
  return {frame:companionFrame(animation,state,state==='kiss' ? elapsed-1500 : elapsed),state,facing:leaving ? 'left' : 'right',
    offset:Math.round(arriving ? far+(target-far)*progress : leaving ? target+(far-target)*progress : target)}
}


export function validateLevelUp(value){
 if(!value || value.version!==1 || typeof value.id!=='string' || value.id.length>80 ||
    typeof value.heroId!=='string' || value.heroId.length>80 ||
    ![value.fromLevel,value.toLevel].every(n=>Number.isInteger(n)&&n>=1&&n<=5) ||
    !Array.isArray(value.frames) || value.frames.length!==18 || value.frames.some(p=>!validPng(p,value.renderScale===1.5 ? 96*1024 : 64*1024)) ||
    value.frames.reduce((n,p)=>n+p.length,0)>1024*1024 ||
    !Array.isArray(value.durations) || value.durations.length!==18 ||
    value.durations.some(ms=>!Number.isInteger(ms)||ms<60||ms>1000) ||
    (value.renderScale!==undefined && ![1,1.5].includes(value.renderScale)) ||
    value.durationMs!==value.durations.reduce((a,b)=>a+b,0) || value.durationMs>10000)return null
 return {version:1,id:value.id,heroId:value.heroId,fromLevel:value.fromLevel,toLevel:value.toLevel,frames:value.frames,durations:value.durations,durationMs:value.durationMs,...(value.renderScale!==undefined ? {renderScale:value.renderScale} : {})}
}
export function levelUpFrame(effect,elapsed){
 let time=Math.max(0,elapsed),frame=0
 while(frame<effect.durations.length-1&&time>=effect.durations[frame])time-=effect.durations[frame++]
 return frame
}

// Preview arguments never change the pinned character or its earned XP.
export function parseLevelUpArguments(value='') {
 const parts=value.trim().split(/\s+/).filter(Boolean)
 if(!parts.length)return {}
 const level=/^[1-5]$/.test(parts[0])?Number(parts.shift()):undefined
 const heroId=parts.shift()
 if(parts.length || (heroId!==undefined&&!/^[a-z][a-z0-9_]{0,79}$/.test(heroId)))return null
 return {...(level!==undefined?{toLevel:level}:{}),...(heroId?{heroId}:{})}
}
