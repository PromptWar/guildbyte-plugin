// Fill and repeat; this is a loading animation, not a download percentage.
export const LOADER_INTERVAL=80
const spots=[[0,0],[1,0],[2,0],[2,1],[2,2],[1,2],[0,2],[0,1]]
export const LOADER_FRAMES=spots.map((_,frame)=>{
 const pixels=new Uint8Array(24*24*4),glyphs=Array.from({length:3},()=>Array(3).fill(' '))
 for(const [i,[x,y]]of spots.entries()){
  const color=i===frame?[255,228,148,255]:i<frame?[208,161,81,255]:[76,65,47,255]
  glyphs[y][x]=i<=frame?'█':'░'
  for(let py=3+y*7;py<7+y*7;py++)for(let px=3+x*7;px<7+x*7;px++)pixels.set(color,(py*24+px)*4)
 }
 return {image:{width:24,height:24,rgba:btoa(String.fromCharCode(...pixels))},text:glyphs.map((row,i)=>row.join('')+(i===1?' Loading Guildbyte':'')).join('\n')}
})
