import {runReaderTask} from "../apps/desktop/src/lib/workbench/reader-task";
import {test,expect,fixture,click,wait,holdQuantum,quantumHeld,releaseQuantum,button,act} from './orbitals-runtime-fixture';
test('Cancel while replacing an already visible field clears the retained field with the same native receipt',async()=>{
 const view=await fixture();
 try{
  await click(view.host,'Show surface');await wait(()=>!button(view.host,'Export Cube').disabled,'first field');expect(view.fields()).toBe(1);
  const first=view.calls.find(action=>action.type==='scalar_field_binding');
  holdQuantum();await click(view.host,'Density');await wait(quantumHeld,'held replacement field');
  await click(view.host,'Cancel');await wait(()=>view.fields()===0,'clear previous field');
  releaseQuantum();await act(async()=>new Promise(resolve=>setTimeout(resolve,20)));
  expect(view.calls.filter(action=>action.type==='scalar_field_binding')).toEqual([first]);
  expect(view.fields()).toBe(0);expect(button(view.host,'Export Cube').disabled).toBe(true);
 }finally{releaseQuantum();await view.close();}
});
test('native source edit after a field is shown prevents exporting old field bytes',async()=>{
 const view=await fixture();
 try{
  await click(view.host,'Show surface');await wait(()=>!button(view.host,'Export Cube').disabled,'first field');
  const raw=[...view.plugin.state.data.cells.values()].find(cell=>cell.obj?.data==='1\nimported\nH 0 0 0\n')!;
  await view.plugin.state.data.build().to(raw.transform.ref).update({data:'1\nchanged\nH 0 0 2\n'}).commit();
  await click(view.host,'Export Cube');await wait(()=>Boolean(view.host.querySelector('[role="alert"]')),'source error');
  expect(view.saved).toEqual([]);expect(view.fields()).toBe(0);
 }finally{await view.close();}
});

test('independent: delayed native acceptance exports the exact requested field snapshot after a later native source change',async()=>{
 const view=await fixture();
 try{
  await click(view.host,'Show surface');await wait(()=>!button(view.host,'Export Cube').disabled,'original field');
  const originalCube=[...view.calls].reverse().find(action=>Boolean(action.cube)).cube;
  view.holdValidate();await click(view.host,'Export Cube');await wait(view.ackHeld,'real native validation accepted and ACK held');
  expect(view.saved).toEqual([]);
  const raw=[...view.plugin.state.data.cells.values()].find(cell=>cell.obj?.data==='1\nimported\nH 0 0 0\n')!;
  await view.plugin.state.data.build().to(raw.transform.ref).update({data:'1\nlater source\nH 0 0 2\n'}).commit();
  await wait(()=>view.fields()===0,'retire old field');
  view.releaseAck();await wait(()=>view.saved.length===1,'accepted original export completes');
  expect(view.saved[0]).toEqual({title:'import-orbital-1.cube',extension:'cube',text:originalCube});
  expect(view.fields()).toBe(0);
  const parsed=await runReaderTask({action:'parse',name:'saved.cube',text:view.saved[0].text});
  expect(parsed.atoms.map(({element,x,y,z})=>({element,x,y,z}))).toEqual([{element:'H',x:0,y:0,z:0}]);
  await click(view.host,'Export Cube');await wait(()=>Boolean(view.host.querySelector('[role="alert"]')),'fresh export rejected');
  expect(view.saved).toHaveLength(1);
 }finally{view.releaseAck();await view.close();}
});

test('a new exact source revision with the same scientific object remounts the owner and retires the previous field',async()=>{
 const view=await fixture();
 try{
  await click(view.host,'Show surface');await wait(()=>!button(view.host,'Export Cube').disabled,'first field');expect(view.fields()).toBe(1);
  await view.replaceText('1\nnew source revision\nH 0 0 0\n');
  await wait(()=>view.fields()===0,'old exact source retired');
  expect(button(view.host,'Export Cube').disabled).toBe(true);expect(button(view.host,'Show surface')).toBeTruthy();
  await click(view.host,'Show surface');await wait(()=>!button(view.host,'Export Cube').disabled,'new source field');
  expect(view.calls.filter(action=>action.type==='scalar_field_binding')).toHaveLength(2);
 }finally{await view.close();}
});
