import {inflateSync} from 'node:zlib'

// The app exports bounded, non-interlaced 8-bit RGBA PNGs. Other PNG formats retain static playback.
export function decodePng(png) {
  const data=Buffer.from(png,'base64'),chunks=[]
  if(data.length<33 || !data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Invalid PNG')
  const width=data.readUInt32BE(16),height=data.readUInt32BE(20)
  if(width<1 || height<1 || width>256 || height>256 || !data.subarray(24,29).equals(Buffer.from([8,6,0,0,0])))throw Error('Unsupported sprite PNG')
  for(let at=8;at<data.length;) {
    if(at+12>data.length)throw Error('Truncated PNG')
    const size=data.readUInt32BE(at),end=at+12+size
    if(end>data.length)throw Error('Truncated PNG chunk')
    if(data.toString('ascii',at+4,at+8)==='IDAT')chunks.push(data.subarray(at+8,end-4))
    at=end
  }
  const stride=width*4,raw=inflateSync(Buffer.concat(chunks),{maxOutputLength:(stride+1)*height})
  if(raw.length!==(stride+1)*height)throw Error('Invalid PNG rows')
  const pixels=Buffer.alloc(stride*height)
  for(let y=0;y<height;y++) {
    const filter=raw[y*(stride+1)]
    if(filter>4)throw Error('Invalid PNG filter')
    for(let x=0;x<stride;x++) {
      const at=y*stride+x,a=x>=4 ? pixels[at-4] : 0,b=y>0 ? pixels[at-stride] : 0,c=y>0 && x>=4 ? pixels[at-stride-4] : 0
      const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c)
      const prediction=filter===0 ? 0 : filter===1 ? a : filter===2 ? b : filter===3 ? Math.floor((a+b)/2) : pa<=pb && pa<=pc ? a : pb<=pc ? b : c
      pixels[at]=raw[y*(stride+1)+1+x]+prediction
    }
  }
  return {width,height,rgba:pixels.toString('base64')}
}

export function animationPixels(animation) {
  if(!animation)return null
  try {
    const frames=animation.frames.map(decodePng),first=frames[0]
    const mirrored=Object.entries(animation.mirroredFrames ?? {}).map(([i,png])=>[i,decodePng(png)])
    if(![...frames,...mirrored.map(([,p])=>p)].every(p=>p.width===first.width && p.height===first.height))return null
    return {width:first.width,height:first.height,frames:frames.map(p=>p.rgba),mirroredFrames:Object.fromEntries(mirrored.map(([i,p])=>[i,p.rgba]))}
  } catch {return null}
}
