import {expect,test} from 'bun:test';
import {serializeCube,type CubeRequest} from '../apps/desktop/src/lib/workbench/cube-task';
import {runReaderTask} from '../apps/desktop/src/lib/workbench/reader-task';
import type {ScalarGrid} from '../apps/desktop/src/lib/molecular-workbench/scientific-types';
const one:ScalarGrid={dimensions:[1,1,1],origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]],values:new Float32Array([1])};

test('independent: invalid atom coordinates cannot produce a successful Cube export that its canonical reader rejects',async()=>{
 for(const x of [NaN,Infinity,1000001]){
  await expect(serializeCube(one,[{element:'H',x,y:0,z:0}])).rejects.toThrow();
 }
});

test('independent: a tiny valid grid view cannot clone an oversized backing buffer into the worker',async()=>{
 const NativeWorker=globalThis.Worker,seen:number[]=[];
 class ObserveWorker extends NativeWorker {
  override postMessage(message:unknown,transferOrOptions?:Transferable[]|StructuredSerializeOptions){
   const request=message as CubeRequest;
   if ('grid' in request) seen.push(structuredClone(request).grid.values.buffer.byteLength);
   if(Array.isArray(transferOrOptions))super.postMessage(message,transferOrOptions);else super.postMessage(message,transferOrOptions);
  }
 }
 globalThis.Worker=ObserveWorker;
 try{
  const values=new Float32Array(new ArrayBuffer(8*1024*1024),0,1);values[0]=1;
  let text:string|undefined;
  try{text=await serializeCube({...one,values},[{element:'H',x:0,y:0,z:0}]);}catch(error){expect((error as Error).message).toMatch(/limit|bound|payload/i);}
  expect(seen.every(bytes=>bytes<=1000000*Float32Array.BYTES_PER_ELEMENT)).toBe(true);
  if(text!==undefined)expect(Array.from((await runReaderTask({action:'parse',name:'one.cube',text})).grid!.values)).toEqual([1]);
 }finally{globalThis.Worker=NativeWorker;}
});
