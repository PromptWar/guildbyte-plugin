// Hooks can import only local files. The Node worker decodes PNGs; hooks only copy pixels.
export function pixelCanvas(pixels,frame,facing,columns,travel,offset=0) {
  if(!pixels || columns<=0)return null
  const rgba=(facing==='left' ? pixels.mirroredFrames?.[frame] : null) ?? pixels.frames[frame]
  if(!rgba)return null
  const source=atob(rgba),height=pixels.height
  const width=Math.round((columns+travel)*pixels.width/columns)
  const x=Math.round((travel-Math.max(0,Math.min(travel,offset)))*pixels.width/columns)
  const left='\0'.repeat(x*4),right='\0'.repeat((width-x-pixels.width)*4),rows=[]
  for(let y=0;y<height;y++)rows.push(left+source.slice(y*pixels.width*4,(y+1)*pixels.width*4)+right)
  return {rgba:btoa(rows.join('')),width,height}
}
