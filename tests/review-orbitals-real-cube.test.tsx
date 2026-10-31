import {test,expect,fixture,click,wait,button,act} from './orbitals-runtime-fixture';
import {readFileSync} from 'node:fs';
import {runReaderTask} from '../apps/desktop/src/lib/workbench/reader-task';
test('independent: the full owner opens the tracked base-pair Cube as volume-only and exports/reopens its actual grid',async()=>{
 const text=readFileSync(new URL('../samples/quantum/volumes/base-pair-density.cube',import.meta.url),'utf8');
 const view=await fixture(text);
 try{
  expect({atoms:view.science.atoms.length,dimensions:view.science.grid!.dimensions,values:view.science.grid!.values.length}).toEqual({atoms:30,dimensions:[134,70,33],values:309540});
  expect(view.plugin.managers.structure.hierarchy.current.structures.length).toBe(0);
  expect(view.plugin.managers.volume.hierarchy.current.volumes.length).toBe(1);
  await click(view.host,'Show surface');await wait(()=>!button(view.host,'Export Cube').disabled,'real Cube field');expect(view.fields()).toBe(1);
  const before=view.calls.at(-1).isovalue,control=view.host.querySelector<HTMLElement>('[aria-valuenow]')!;
  await act(async()=>control.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true})));await wait(()=>view.calls.at(-1).isovalue!==before,'source Cube isovalue');
  await click(view.host,'Export Cube');await wait(()=>view.saved.length===1,'real Cube export');
  const saved=await runReaderTask({action:'parse',name:'saved.cube',text:view.saved[0].text}),source=view.science.grid!;
  let maximum=0,error=0;for(let i=0;i<source.values.length;i++){maximum=Math.max(maximum,Math.abs(source.values[i]));error=Math.max(error,Math.abs(source.values[i]-saved.grid!.values[i]));}
  expect(error<=maximum*1e-7).toBe(true);expect(saved.grid!.dimensions).toEqual(source.dimensions);
  expect(saved.grid!.axes.every((axis,i)=>axis.every((v,j)=>Math.abs(v-source.axes[i][j])<1e-7))).toBe(true);
  await click(view.host,'Hide surface');await wait(()=>view.fields()===0,'real Cube hide');expect(view.plugin.managers.volume.hierarchy.current.volumes.length).toBe(1);expect(button(view.host,'Export Cube').disabled).toBe(true);
 }finally{await view.close();}
});
