import assert from 'node:assert/strict'
import { COMPANION_STATES, validateAnimation, companionFrame, visitPose } from '../scripts/companion-animation.mjs'

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
