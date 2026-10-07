// Hooks can import only local files. The Node worker decodes PNGs; hooks only copy pixels.
// Keep one composed image per artwork object; host redraws reuse it without encoding.
const spriteCache=new WeakMap(),effectCache=new WeakMap()
let xpCache
export function pixelCanvas(pixels,frame,facing,columns,travel,offset=0,pixelHeight=pixels?.height,padded=false) {
  if(!pixels || columns<=0)return null
  const rgba=(facing==='left' ? pixels.mirroredFrames?.[frame] : null) ?? pixels.frames[frame]
  if(!rgba)return null
  const gutter=padded?32:0
  const width=Math.round((columns+travel)*pixels.width/columns)+gutter*2
  const height=padded?Math.max(pixels.height+12,Math.round(pixelHeight)):pixels.height
  const x=Math.round((travel-Math.max(0,Math.min(travel,offset)))*pixels.width/columns)+gutter
  const key=[frame,facing,width,height,x,padded].join(':')
  if(spriteCache.get(pixels)?.key===key)return spriteCache.get(pixels).value
  const source=atob(rgba)
  const left='\0'.repeat(x*4),right='\0'.repeat((width-x-pixels.width)*4),rows=[]
  for(let y=0;y<pixels.height;y++)rows.push(left+source.slice(y*pixels.width*4,(y+1)*pixels.width*4)+right)
  const top=padded?height-pixels.height-12:0,bottom=padded?12:0
  const value={rgba:btoa('\0'.repeat(top*width*4)+rows.join('')+'\0'.repeat(bottom*width*4)),width,height}
  spriteCache.set(pixels,{key,value});return value
}

// The shared aura contains the 128px hero at (32,52). Keep both 32px side
// gutters and the full height; the UI reserves its 12px margin below the hero.
export function levelUpCanvas(pixels,frame,facing,columns,travel,offset=0,pixelHeight=pixels?.height) {
  if(!pixels?.frames[frame] || columns<=0)return null
  if(pixels.width!==192 || pixels.height!==192)return pixelCanvas(pixels,frame,facing,columns,travel,offset)
  const size=pixels.width,base=128
  const width=Math.round((columns+travel)*base/columns)+64
  const height=Math.max(size,Math.round(pixelHeight))
  const x=Math.round((travel-Math.max(0,Math.min(travel,offset)))*base/columns)
  const key=[frame,facing,width,height,x].join(':')
  if(effectCache.get(pixels)?.key===key)return effectCache.get(pixels).value
  const source=atob(pixels.frames[frame]),rows=[]
  for(let y=0;y<size;y++){
    let line=source.slice(y*size*4,(y+1)*size*4)
    if(facing==='left'){const chunks=[];for(let i=line.length-4;i>=0;i-=4)chunks.push(line.slice(i,i+4));line=chunks.join('')}
    rows.push('\0'.repeat(x*4)+line+'\0'.repeat((width-x-size)*4))
  }
  const value={rgba:btoa('\0'.repeat((height-size)*width*4)+rows.join('')),width,height}
  effectCache.set(pixels,{key,value});return value
}

const XP_GLYPHS={
 'X':['10001','01010','00100','00100','00100','01010','10001'],
 'P':['11110','10001','10001','11110','10000','10000','10000'],
 ':':['00000','00100','00100','00000','00100','00100','00000'],
 '+':['00000','00100','00100','11111','00100','00100','00000'],
 '0':['01110','10001','10011','10101','11001','10001','01110'],
 '1':['00100','01100','00100','00100','00100','00100','01110'],
 '2':['01110','10001','00001','00010','00100','01000','11111'],
 '3':['11110','00001','00001','01110','00001','00001','11110'],
 '4':['00010','00110','01010','10010','11111','00010','00010'],
 '5':['11111','10000','10000','11110','00001','00001','11110'],
 '6':['01110','10000','10000','11110','10001','10001','01110'],
 '7':['11111','00001','00010','00100','01000','01000','01000'],
 '8':['01110','10001','10001','01110','10001','10001','01110'],
 '9':['01110','10001','10001','01111','00001','00001','01110'],
}
// A tiny native overlay moves in pixels, so XP doesn't jump between terminal rows.
export function xpCanvas(amount,elapsed,columns,travel,offset,height) {
 const width=Math.max(1,Math.round((columns+travel)*128/columns)+64)
 const text=`XP: +${amount}`,scale=height>=16?2:1
 const left=32+Math.round((travel-offset+columns/2)*128/columns-text.length*6*scale/2)
 const top=Math.round(Math.max(0,height-7*scale)*(1-Math.min(1,elapsed/1800)))
 const alpha=Math.round(255*Math.min(1,Math.max(0,(1800-elapsed)/350)))
 const key=[amount,width,height,left,top,alpha,scale].join(':')
 if(xpCache?.key===key)return xpCache.value
 const data=new Uint8Array(width*height*4)
 for(let i=0;i<text.length;i++)for(let y=0;y<7;y++)for(let x=0;x<5;x++)if(XP_GLYPHS[text[i]]?.[y][x]==='1'){
  for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){
   const px=left+(i*6+x)*scale+dx,py=top+y*scale+dy
   if(px>=0&&px<width&&py>=0&&py<height)data.set([207,99,255,alpha],(py*width+px)*4)
  }
 }
 let raw='';for(let i=0;i<data.length;i+=8192)raw+=String.fromCharCode(...data.subarray(i,i+8192))
 const value={width,height,rgba:btoa(raw)}
 xpCache={key,value};return value
}
