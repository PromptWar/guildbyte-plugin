import assert from 'node:assert/strict'
import { COMPANION_STATES, validateAnimation, companionFrame, visitPose, validateLevelUp, levelUpFrame } from '../scripts/companion-animation.mjs'

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
const valid={version:1,frames:Array(20).fill(png),clips:Object.fromEntries(COMPANION_STATES.map(state=>[state,{frames:[0,1,2],durations:[100,200,100]}]))}
assert(validateAnimation(valid))
const extended={...valid,frames:Array(28).fill(png),clips:{...valid.clips,walk:{frames:[20,21,22,23,24,25,26,27],durations:Array(8).fill(100)}},mirroredFrames:{27:png}}
assert(validateAnimation(extended),'Dedicated eight-frame walks are accepted')
assert.equal(validateAnimation({...extended,frames:Array(29).fill(png)}),null)
assert.equal(validateAnimation({...valid,mirroredFrames:{27:png}}),null)
assert.deepEqual(validateAnimation({...valid,mirroredFrames:{2:png}})?.mirroredFrames,{2:png})
assert.equal(validateAnimation({...valid,mirroredFrames:{2:'bad'}}),null)
assert.equal(validateAnimation({...valid,mirroredFrames:{20:png}}),null)
assert.equal(validateAnimation({...valid,mirroredFrames:[]}),null)
assert.equal(validateAnimation({...valid,mirroredFrames:{other:png}}),null)
assert.equal(companionFrame(valid,'walk',0),0)
assert.equal(companionFrame(valid,'walk',100),1)
assert.equal(companionFrame(valid,'walk',300),2)
assert.equal(companionFrame(valid,'walk',400),0)
assert.equal(validateAnimation({...valid,frames:['bad']}),null)
assert.equal(validateAnimation({...valid,clips:{...valid.clips,walk:{frames:[20],durations:[100]}}}),null)
assert.equal(companionFrame(extended,'walk',700),27)
assert.deepEqual(validateAnimation({...extended,mirroredFrames:{27:png}})?.mirroredFrames,{27:png})
assert.equal(validateAnimation({...extended,clips:{...extended.clips,walk:{frames:[28],durations:[100]}}}),null)
assert.equal(validateAnimation({...valid,clips:{...valid.clips,talk:{frames:[1],durations:[0]}}}),null)
assert.equal(validateAnimation({...valid,clips:{...valid.clips,sit:{frames:[1,2],durations:[100]}}}),null)
for (const state of ['sleep','kiss']) {
  assert.equal(companionFrame(valid,state,300),2)
  assert.equal(companionFrame(valid,state,400),2,`${state} must hold its final frame instead of looping`)
  assert.equal(companionFrame(valid,state,100000),2)
  assert.equal(companionFrame(valid,state,0),0,'A new action starts at its first frame')
}
assert.equal(visitPose(valid,1500,9,24).frame,0,'Visitor kiss starts after arrival, at the first frame')
assert.equal(visitPose(valid,1600,9,24).frame,1)
assert.equal(visitPose(valid,1900,9,24).frame,2)
assert.equal(visitPose(valid,6000,9,24).frame,2,'Visitor kiss plays only once before departure')
console.log('Companion animation validation and playback checks passed.')

const production={...valid,frames:Array(24).fill(png),clips:{...valid.clips,walk:{frames:[16,17,18,19,20,21,22,23],durations:Array(8).fill(100)}}}
assert(validateAnimation(production))
const carrying={...production,frames:Array(28).fill(png),clips:{...production.clips,walk:{frames:Array.from({length:12},(_,i)=>16+i),durations:Array(12).fill(100)}}}
assert(validateAnimation(carrying),'Twelve fitted carrying-walk phases are accepted')
assert.equal(companionFrame(carrying,'walk',1100),27);assert.equal(companionFrame(carrying,'walk',1200),16)
const aura={id:'preview',heroId:'cash_cow_solopreneur',version:1,fromLevel:1,toLevel:5,frames:Array(18).fill(png),durations:[80,...Array(16).fill(90),120],durationMs:1640}
assert(validateLevelUp(aura));assert.equal(levelUpFrame(aura,0),0);assert.equal(levelUpFrame(aura,80),1);assert.equal(levelUpFrame(aura,100000),17)
assert.equal(validateLevelUp({...aura,toLevel:6}),null);assert.equal(validateLevelUp({...aura,frames:Array(17).fill(png)}),null);assert.equal(validateLevelUp({...aura,durationMs:1200}),null)

const detailedPng=Buffer.concat([Buffer.from(png,'base64'),Buffer.alloc(21000)]).toString('base64')
assert(validateAnimation({...production,frames:Array(24).fill(detailedPng)}),'Detailed level-5 art must pass the real total-payload limit')
assert(validateAnimation({...production,frames:Array(32).fill(png)}),'Sixteen authored walk in-betweens are accepted')
assert.equal(validateAnimation({...production,frames:Array(32).fill(detailedPng.repeat(2))}),null,'Payloads remain bounded')

assert.equal(validateLevelUp({...aura,renderScale:1.5}).renderScale,1.5)
assert.equal(validateLevelUp({...aura,renderScale:2}),null,'Untrusted effects cannot request arbitrary display sizes')

const largerFxPng=Buffer.concat([Buffer.from(png,'base64'),Buffer.alloc(59000)]).toString('base64')
const expanded={...aura,renderScale:1.5,frames:[largerFxPng,...Array(17).fill(png)]}
assert(validateLevelUp(expanded),'The larger canvas accepts its bounded larger PNG')
assert.equal(validateLevelUp({...expanded,renderScale:1}),null,'Normal effects keep the 64KiB limit')
assert.equal(validateLevelUp({...expanded,frames:Array(18).fill(largerFxPng)}),null,'Expanded effects keep the 1MiB total budget')

const {parseLevelUpArguments}=await import('../scripts/companion-animation.mjs')
assert.deepEqual(parseLevelUpArguments(''),{})
assert.deepEqual(parseLevelUpArguments('5 iris_archon'),{toLevel:5,heroId:'iris_archon'})
assert.deepEqual(parseLevelUpArguments('quiet_sage'),{heroId:'quiet_sage'})
for(const invalid of ['6','5 bad-id','5 iris_archon extra'])assert.equal(parseLevelUpArguments(invalid),null)
