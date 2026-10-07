// One tiny pixel ring, sampled at 5 FPS; the same pattern works without image support.
const spots=[[0,0],[1,0],[2,0],[2,1],[2,2],[1,2],[0,2],[0,1]]
export const LOADER_FRAMES=spots.map((_,frame)=>{
 const pixels=new Uint8Array(24*24*4),glyphs=Array.from({length:3},()=>Array(3).fill(' '))
 for(const [i,[x,y]]of spots.entries()){
  const age=(frame-i+8)%8,color=age===0?[255,228,148,255]:age===1?[208,161,81,255]:[76,65,47,255]
  glyphs[y][x]=age===0?'█':age===1?'▓':'░'
  for(let py=3+y*7;py<7+y*7;py++)for(let px=3+x*7;px<7+x*7;px++)pixels.set(color,(py*24+px)*4)
 }
 return {image:{width:24,height:24,rgba:btoa(String.fromCharCode(...pixels))},text:glyphs.map((row,i)=>row.join('')+(i===1?' Loading Guildbyte':'')).join('\n')}
})
