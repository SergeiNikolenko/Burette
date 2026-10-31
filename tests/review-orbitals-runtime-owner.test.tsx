import {test,expect,fixture,click,wait,holdQuantum,quantumHeld,releaseQuantum,act,button} from './orbitals-runtime-fixture';

test('independent: native source Undo while an orbital worker is held cannot attach the old-source grid to the restored scene',async()=>{
 const view=await fixture();
 try{
  const raw=[...view.plugin.state.data.cells.values()].find(cell=>cell.obj?.data==='1\nimported\nH 0 0 0\n')!;
  await view.plugin.state.data.build().to(raw.transform.ref).update({data:'1\nolder native pose\nH 0 0 2\n'}).commit();
  await view.plugin.state.data.build().to(raw.transform.ref).update({data:'1\nimported\nH 0 0 0\n'}).commit({canUndo:'Native coordinate edit'});
  holdQuantum();await click(view.host,'Show surface');await wait(quantumHeld,'held actual quantum response');
  await view.plugin.runTask(view.plugin.state.data.undo());
  expect(raw.obj!.data).toBe('1\nolder native pose\nH 0 0 2\n');
  releaseQuantum();await wait(()=>!view.host.textContent?.includes('Calculating'),'settled old-source job');
  expect(view.calls.filter(action=>action.cube)).toHaveLength(0);
  expect(view.fields()).toBe(0);
  expect(button(view.host,'Export Cube').disabled).toBe(true);
 }finally{releaseQuantum();await view.close();}
});
