import {inflateSync} from 'node:zlib';
import type {HeadlessBrowser} from '../frame-render/index.ts';

/** Chrome emits non-interlaced RGBA PNGs. RGB/palette/unknown images are not presumed blank. */
export function transparentMotionPng(buffer: Buffer): boolean {
  if(buffer.length<33||buffer.readUInt32BE(0)!==0x89504e47||buffer.readUInt32BE(4)!==0x0d0a1a0a)return false;
  const width=buffer.readUInt32BE(16),height=buffer.readUInt32BE(20),bits=buffer[24],color=buffer[25];
  if(!width||!height||width>8192||height>8192||bits!==8||![4,6].includes(color)||buffer[28]!==0)return false;
  const channels=color===6?4:2,stride=width*channels+1,idat:Buffer[]=[];
  for(let offset=8;offset+12<=buffer.length;){
    const size=buffer.readUInt32BE(offset);if(size>buffer.length-offset-12)return false;
    if(buffer.toString('ascii',offset+4,offset+8)==='IDAT')idat.push(buffer.subarray(offset+8,offset+8+size));
    offset+=size+12;
  }
  if(!idat.length)return false;
  try{
    const pixels=inflateSync(Buffer.concat(idat),{maxOutputLength:stride*height});
    if(pixels.length!==stride*height)return false;
    // Until the first nonzero alpha, every alpha predictor (left/up/Paeth) is zero.
    // Thus testing filtered alpha bytes is sufficient; RGB need not be reconstructed.
    for(let y=0;y<height;y++){
      const row=y*stride;if(pixels[row]>4)return false;
      for(let x=0;x<width;x++)if(pixels[row+1+x*channels+channels-1]!==0)return false;
    }
    return true;
  }catch{return false;}
}

export function createMotionCaptureQueue(){
  let barrier:Promise<unknown>=Promise.resolve();
  const active=new Set<Promise<unknown>>();
  return async function capture<T>(task:()=>Promise<T>,paint:()=>Promise<unknown>,recovered?:()=>void):Promise<T>{
    // Keep normal captures parallel. A blank-frame recovery drains current captures
    // and blocks new target activations until its same-frame retry completes.
    for(;;){const gate=barrier;await gate;if(gate===barrier)break;}
    const first=Promise.resolve().then(task);active.add(first);
    let result:T;try{result=await first;}finally{active.delete(first);}
    if(!Buffer.isBuffer(result)||!transparentMotionPng(result))return result;
    const recovery=barrier.then(async()=>{
      await Promise.allSettled([...active]);
      for(let retry=0;retry<2&&Buffer.isBuffer(result)&&transparentMotionPng(result);retry++){
        await paint();result=await task();
        if(Buffer.isBuffer(result)&&!transparentMotionPng(result))recovered?.();
      }
      return result;
    });
    barrier=recovery.catch(()=>undefined);return recovery;
  };
}

/** Recovery is owned by the frame renderer's capture queue. */
export function stabilizeMotionCapture(browser:HeadlessBrowser,onRecovered?:()=>void){browser.onRecovered=onRecovered;}
