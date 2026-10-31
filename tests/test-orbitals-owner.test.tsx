import {test,expect,act,fixture,button,click,wait,holdQuantum,quantumHeld,releaseQuantum,compiler} from './orbitals-runtime-fixture';
import {runReaderTask} from '../apps/desktop/src/lib/workbench/reader-task';
const ready=async(view:Awaited<ReturnType<typeof fixture>>)=>wait(()=>!button(view.host,'Export Cube').disabled,'current field');
test('complete four-field panel uses real workers, surfaces, spin channels and save failure/retry',async()=>{
 const view=await fixture();
 try{
  expect(['Orbital','Density','Spin density','Cube field'].every(label=>Boolean(button(view.host,label)))).toBe(true);
  expect(view.host.textContent).toContain('HOMO');expect(view.host.textContent).toContain('LUMO');expect(view.host.textContent).toContain('Gap 27.211 eV');
  expect(button(view.host,'Export Cube').disabled).toBe(true);await click(view.host,'Show surface');await ready(view);expect(view.fields()).toBe(1);
  await click(view.host,'Density');await ready(view);expect(view.calls.at(-1).signed).toBe(false);
  await click(view.host,'Spin density');await ready(view);await click(view.host,'Export Cube');await wait(()=>view.saved.length===1,'spin export');
  const spin=await runReaderTask({action:'parse',name:'spin.cube',text:view.saved[0].text});expect(spin.grid!.values.every(value=>value<=0)).toBe(true);expect(view.saved[0].title).toContain('spin-density.cube');
  await click(view.host,'Cube field');await ready(view);view.failSave(true);await click(view.host,'Export Cube');await wait(()=>Boolean(view.host.querySelector('[role="alert"]')),'save failure');expect(view.host.textContent).toContain('Choose another destination.');
  view.failSave(false);await click(view.host,'Export Cube');await wait(()=>view.saved.length===3,'retry');const file=await runReaderTask({action:'parse',name:'field.cube',text:view.saved[2].text});expect(Array.from(file.grid!.values)).toEqual(Array.from(view.science.grid!.values));
  await click(view.host,'β');expect(view.host.textContent).toContain('Gap 9.524 eV');
  const row=view.host.querySelectorAll<HTMLTableRowElement>('tbody tr')[1];await act(async()=>row.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));await ready(view);await click(view.host,'Export Cube');await wait(()=>view.saved.length===4,'beta virtual export');expect(view.saved[3].title).toContain('orbital-4.cube');
  await click(view.host,'Hide surface');await wait(()=>view.fields()===0,'hide');expect(button(view.host,'Export Cube').disabled).toBe(true);
  expect(compiler.length).toBe(1);
 }finally{await view.close();}
});
test('source replacement, identical document replacement and edit/revision restore retire old computed jobs without reacquiring a target',async()=>{
 const view=await fixture();
 try{
  holdQuantum();await click(view.host,'Show surface');await wait(quantumHeld,'held real quantum response');
  await view.replaceScience({...view.science,orbitals:view.science.orbitals.map(orbital=>({...orbital,energyHartree:orbital.energyHartree+.1}))});
  releaseQuantum();await act(async()=>new Promise(r=>setTimeout(r,30)));expect(view.calls.filter(action=>action.cube)).toHaveLength(0);expect(button(view.host,'Export Cube').disabled).toBe(true);
  await click(view.host,'Show surface');await ready(view);await view.replaceDocument();await wait(()=>view.fields()===0,'same ID document cleanup');expect(button(view.host,'Export Cube').disabled).toBe(true);
  await click(view.host,'Show surface');await ready(view);await view.edit(true);await wait(()=>!view.host.querySelector('table'),'edited source loses orbitals');await wait(()=>view.fields()===0,'source edit retires surface');
  await view.edit(false);await wait(()=>Boolean(view.host.querySelector('table')),'prior revision restores scientific data');expect(button(view.host,'Export Cube').disabled).toBe(true);
  const calls=view.calls.filter(action=>action.cube).length;await act(async()=>new Promise(r=>setTimeout(r,30)));expect(view.calls.filter(action=>action.cube)).toHaveLength(calls);
 }finally{releaseQuantum();await view.close();}
});
test('Cancel after real surface creation but before ACK sends retained-target clear and ignores the late ACK',async()=>{
 const view=await fixture();
 try{
  view.holdAck();await click(view.host,'Show surface');await wait(view.ackHeld,'actual receiver ACK held');expect(view.fields()).toBe(1);
  await click(view.host,'Cancel');await wait(()=>view.fields()===0,'cancel clear');view.releaseAck();await act(async()=>new Promise(r=>setTimeout(r,30)));
  expect(button(view.host,'Export Cube').disabled).toBe(true);expect(view.host.textContent).not.toContain('Calculating');expect(button(view.host,'Show surface')).toBeTruthy();
 }finally{view.releaseAck();await view.close();}
});
test('restricted singly occupied and paired zero-spin fields remain usable and exportable',async()=>{
 const view=await fixture();
 try{
  for(const occupancy of [1,2]){
   await view.replaceScience({...view.science,orbitals:[{...view.science.orbitals[0],occupancy}]});await wait(()=>Boolean(button(view.host,'Spin density')),'restricted spin option');
   await click(view.host,'Spin density');await click(view.host,'Show surface');await ready(view);await click(view.host,'Export Cube');await wait(()=>view.saved.length===occupancy,'restricted export');
   const saved=await runReaderTask({action:'parse',name:'spin.cube',text:view.saved.at(-1)!.text});expect(saved.grid!.values.every(value=>occupancy===2?value===0:value>=0)).toBe(true);expect(saved.grid!.values.some(value=>value>0)).toBe(occupancy===1);
  }
 }finally{await view.close();}
});

test('real Cube-only source imports, changes isovalue, hides, exports and reopens with its physical axes',async()=>{
 let view=await fixture(true);
 try{
  expect(view.plugin.managers.structure.hierarchy.current.structures.length).toBe(0);expect(view.plugin.managers.volume.hierarchy.current.volumes.length).toBe(1);
  await click(view.host,'Show surface');await ready(view);expect(view.fields()).toBe(1);
  const before=view.calls.at(-1).isovalue;const control=view.host.querySelector<HTMLElement>('[aria-valuenow]')!;
  await act(async()=>control.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true})));await wait(()=>view.calls.at(-1).isovalue!==before,'isovalue resend');
  await click(view.host,'Export Cube');await wait(()=>view.saved.length===1,'cube export');const exported=view.saved[0].text,original=view.science.grid!;
  await click(view.host,'Hide surface');await wait(()=>view.fields()===0,'cube hide');expect(view.plugin.managers.volume.hierarchy.current.volumes.length).toBe(1);
  await view.close();view=await fixture(exported);await click(view.host,'Show surface');await ready(view);
  expect(Array.from(view.science.grid!.values)).toEqual(Array.from(original.values));expect(view.science.grid!.axes.every((axis,i)=>axis.every((value,j)=>Math.abs(value-original.axes[i][j])<1e-7))).toBe(true);expect(view.fields()).toBe(1);
 }finally{await view.close();}
});
