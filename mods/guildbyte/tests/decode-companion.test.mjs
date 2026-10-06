import assert from 'node:assert/strict'
import {pixelCanvas} from '../scripts/companion-pixels.mjs'
import {decodePng,animationPixels} from '../scripts/decode-companion.mjs'
// A genuine PNG containing all five scanline filters, partial colors and transparent pixels.
const png='iVBORw0KGgoAAAANSUhEUgAAAAMAAAAFCAYAAACAcVaiAAAANklEQVR4nGNgYPjPoMz44b8b08P/jIySIM7H/0DMwMQoycAAw8xMRg0MQrw/G4CYgQUsygjBADRIDVedkOCyAAAAAElFTkSuQmCC'
const decoded=decodePng(png),expected=Buffer.from('AAD/ACMB8P9GAuH/ARn/ACQa8P9HG+H/AjL/ACUz8P9INOH/A0v/ACZM8P9JTeH/BGT/ACdl8P9KZuH/','base64')
assert.equal(decoded.width,3);assert.equal(decoded.height,5)
assert(Buffer.from(decoded.rgba,'base64').equals(expected),'Decoding preserves every color and alpha channel')
assert.throws(()=>decodePng(Buffer.from(png,'base64').subarray(0,45).toString('base64')))
const huge=Buffer.from(png,'base64');huge.writeUInt32BE(100000,16)
assert.throws(()=>decodePng(huge.toString('base64')),'Untrusted dimensions are bounded before inflate/allocation')
assert.equal(animationPixels({frames:['not PNG']}),null,'Unsupported old artwork retains static playback')
const packed=animationPixels({frames:[png],mirroredFrames:{0:png}})
assert.deepEqual(packed,{width:3,height:5,frames:[decoded.rgba],mirroredFrames:{0:decoded.rgba}})
assert.deepEqual(pixelCanvas(packed,0,'left',3,0),{width:3,height:5,rgba:decoded.rgba})
console.log('Sprite decode checks passed: all PNG filters, colors, alpha, mirrors and bounded malformed input.')
