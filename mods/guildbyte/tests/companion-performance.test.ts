import {test,expect} from 'claude-code/testing'
import {pixelCanvas} from '../scripts/companion-pixels.mjs'

test('measure native canvas work',async()=>{
 const size=128*128*4,bytes=new Uint8Array(size)
 for(let i=0;i<size;i+=4){bytes[i]=i%255;bytes[i+1]=180;bytes[i+2]=50;bytes[i+3]=255}
 const pixels={width:128,height:128,frames:[btoa(String.fromCharCode(...bytes))]}
 let source:any
 const started=Date.now()
 for(let i=0;i<200;i++)source=pixelCanvas(pixels,0,'right',8,12,(i*.08)%12)
 const elapsed=Date.now()-started
 console.log(JSON.stringify({canvasCalls:200,totalMs:elapsed,msPerCall:elapsed/200,bytesPerFrame:source.rgba.length,bytesPerSecondAt20FPS:source.rgba.length*20}))
 expect(source.width).toBe(320)
})
