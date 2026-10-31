import {test,expect,fixture,click,wait,button} from './orbitals-runtime-fixture';
test('independent: a fresh binding cannot validate old scientific basis data against an already changed native source pose',async()=>{
 const view=await fixture();
 try{
  const raw=[...view.plugin.state.data.cells.values()].find(cell=>cell.obj?.data==='1\nimported\nH 0 0 0\n')!;
  await view.plugin.state.data.build().to(raw.transform.ref).update({data:'1\nchanged native pose\nH 0 0 2\n'}).commit({canUndo:'Native coordinate edit'});
  expect(raw.obj!.data).toBe('1\nchanged native pose\nH 0 0 2\n');
  await click(view.host,'Show surface');await wait(()=>!view.host.textContent?.includes('Calculating'),'settled source check');
  expect(view.calls.filter(action=>action.cube)).toHaveLength(0);expect(view.fields()).toBe(0);expect(button(view.host,'Export Cube').disabled).toBe(true);
 }finally{await view.close();}
});
