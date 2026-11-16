import {expect,test} from "bun:test";
import {plotVibrationalSpectrum as plot} from "../apps/desktop/src/lib/molecular-workbench/vibrational-spectrum-plot";
test('finite source intensity must reject post-transform Float32 overflow',()=>{
 const value=new Float32Array(new Uint32Array([0x7f7fffff]).buffer)[0];
 expect(Number.isFinite(value)).toBe(true);
 expect(()=>plot([{index:0,frequencyCm1:1000,intensityKmMol:value}],'ir',{scale:1,offsetCm1:0,fwhmCm1:1,axisStartCm1:1000,axisEndCm1:1001})).toThrow();
});
