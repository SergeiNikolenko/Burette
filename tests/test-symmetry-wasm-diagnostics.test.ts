import {expect,test} from 'bun:test';
import {instantiateStandaloneWasm} from '../apps/desktop/src/lib/molecular-workbench/symmetry/wasm-module';
const u32=(n:number):number[]=>{const out:number[]=[];do{const next=n&127;n>>>=7;out.push(next|(n?128:0));}while(n);return out;};
const vector=(items:number[][])=>[...u32(items.length),...items.flat()];
const text=(s:string)=>{const b=[...new TextEncoder().encode(s)];return [...u32(b.length),...b];};
const section=(id:number,data:number[])=>[id,...u32(data.length),...data];
function diagnosticModule(length:number){
 const iov=new Uint8Array(8);new DataView(iov.buffer).setUint32(0,64,true);new DataView(iov.buffer).setUint32(4,length,true);
 const body=[0,0x41,1,0x41,0,0x41,1,0x41,8,0x10,0,0x1a,0x0b];
 return Uint8Array.from([0,97,115,109,1,0,0,0,
  ...section(1,vector([[0x60,4,0x7f,0x7f,0x7f,0x7f,1,0x7f],[0x60,0,0]])),
  ...section(2,vector([[...text('wasi_snapshot_preview1'),...text('fd_write'),0,0]])),
  ...section(3,vector([[1]])),...section(5,vector([[0,1]])),
  ...section(7,vector([[...text('memory'),2,0],[...text('_initialize'),0,1]])),
  ...section(10,vector([[...u32(body.length),...body]])),
  ...section(11,vector([[0,0x41,0,0x0b,...u32(8),...iov],[0,0x41,0xc0,0,0x0b,...u32(length),...Array(length).fill(65)]])),
 ]);
}
test('independent: one valid WASI write cannot exceed the diagnostic retention bound',async()=>{
 const bytes=diagnosticModule(6000);expect(WebAssembly.validate(bytes)).toBe(true);
 const wasm=await instantiateStandaloneWasm(bytes);
 expect(new DataView(wasm.exports.memory.buffer).getUint32(8,true)).toBe(6000);
 expect(wasm.diagnostics().length).toBeLessThanOrEqual(4096);
});


test('later writes still report their full size after diagnostic capture is full', async () => {
 const wasm=await instantiateStandaloneWasm(diagnosticModule(6000));
 expect(wasm.diagnostics()).toBe('A'.repeat(4096));
 const memory=new DataView(wasm.exports.memory.buffer);
 new Uint8Array(wasm.exports.memory.buffer,64,100).fill(66);memory.setUint32(4,100,true);
 (wasm.exports._initialize as () => void)();
 expect(memory.getUint32(8,true)).toBe(100);
 expect(wasm.diagnostics()).toBe('A'.repeat(4096));
});
