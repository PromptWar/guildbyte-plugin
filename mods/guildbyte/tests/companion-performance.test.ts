import {test,expect} from 'claude-code/testing'
import {pixelCanvas,levelUpCanvas,xpCanvas} from '../scripts/companion-pixels.mjs'

test('measure native canvas work',async()=>{
 const size=128*128*4,bytes=new Uint8Array(size)
 for(let i=0;i<size;i+=4){bytes[i]=i%255;bytes[i+1]=180;bytes[i+2]=50;bytes[i+3]=255}
 const pixels={width:128,height:128,frames:[btoa(String.fromCharCode(...bytes))]}
 let source:any
 const started=Date.now()
 for(let i=0;i<200;i++)source=pixelCanvas(pixels,0,'right',8,12,(i*.08)%12,160,true)
 const elapsed=Date.now()-started
 console.log(JSON.stringify({canvasCalls:200,totalMs:elapsed,msPerCall:elapsed/200,bytesPerFrame:source.rgba.length,bytesPerSecondAt20FPS:source.rgba.length*20}))
 expect(source.width).toBe(384);expect(source.height).toBe(160)
})

test('measure short-lived XP and aura overlays',async()=>{
 const pixels={width:192,height:192,frames:[btoa('\0'.repeat(192*192*4))]}
 const started=Date.now()
 let xp:any,aura:any
 for(let i=0;i<100;i++){
  xp=xpCanvas(100,(i*50)%1800,8,12,(i*.08)%12,64)
  aura=levelUpCanvas(pixels,0,'left',8,12,(i*.08)%12,192)
 }
 const elapsed=Date.now()-started
 console.log(JSON.stringify({overlayPairs:100,totalMs:elapsed,msPerPair:elapsed/100,xpBytes:xp.rgba.length,auraBytes:aura.rgba.length}))
 expect(xp.width).toBe(384);expect(xp.height).toBe(64)
 expect(aura.width).toBe(384);expect(aura.height).toBe(192)
})
