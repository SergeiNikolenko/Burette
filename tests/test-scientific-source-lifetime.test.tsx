import {test,expect,React,act,createRoot} from './geometry-foundation-fixture';
import {useScientificSourceLifetime} from '../apps/desktop/src/lib/workbench/scientific-source-lifetime';
import {registerImportedScientificSource,claimImportedSource,scientificStateFor,importedOriginalFor,hasScientificSource,registeredRevision,forgetImportedSource} from '../apps/desktop/src/lib/workbench/scientific-source-state';
import {parseScientificFile} from '../apps/desktop/src/lib/molecular-workbench/quantum';
import type {DockArea} from '../apps/desktop/src/lib/dock';

async function owner(){
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 function Probe({area,ids}:{area:DockArea;ids:string[]}){useScientificSourceLifetime(area,ids.map(id=>({id})));return null;}
 return {render:async(area:DockArea,ids:string[])=>act(async()=>root.render(<Probe area={area} ids={ids}/>)),close:async()=>{await act(async()=>root.unmount());host.remove();}};
}
test('closed claims are pruned, shared live science is untouched, and pending publication survives cleanup',async()=>{
 const token='lifetime-shared',text=`1\n${token}\nH 0 0 0\n`,science=parseScientificFile('shared.xyz',text);
 const original={name:'source.xyz',file:new Blob([text])};
 registerImportedScientificSource(token,text,science,original);claimImportedSource(token,'A');claimImportedSource(token,'B');
 const pending='lifetime-pending',pendingText=`1\n${pending}\nH 1 0 0\n`,pendingScience=parseScientificFile('pending.xyz',pendingText);
 registerImportedScientificSource(pending,pendingText,pendingScience,{name:'pending.xyz',file:new Blob([pendingText])});
 const view=await owner();
 try{
  await view.render('right',['A','B']);const before=scientificStateFor('B',text);
  await view.render('right',['B']);
  expect([importedOriginalFor('A'),scientificStateFor('A',text).revision,hasScientificSource('A')]).toEqual([null,null,false]);
  const live=scientificStateFor('B',text);expect(live.revisions).toBe(before.revisions);expect(live.revision?.document).toBe(science);expect(live.original).toBe(original);
  expect(registeredRevision('not-published',pendingText)?.revision.document).toBe(pendingScience);
  await view.render('right',[]);expect([scientificStateFor('B',text).revision,importedOriginalFor('B'),hasScientificSource('B')]).toEqual([null,null,false]);
  expect(registeredRevision('not-published',pendingText)?.revision.document).toBe(pendingScience);
  // Publish the document before claiming, as the production opener does.
  await view.render('right',['C']);claimImportedSource(pending,'C');await view.render('right',['C']);
  expect(scientificStateFor('C',pendingText).revision?.document).toBe(pendingScience);
 }finally{await view.close();forgetImportedSource(token);forgetImportedSource(pending);}
});
test('a bottom dock never releases another surface document',async()=>{
 const token='lifetime-bottom',text=`1\n${token}\nH 0 0 0\n`,science=parseScientificFile('source.xyz',text);
 registerImportedScientificSource(token,text,science);claimImportedSource(token,'A');const view=await owner();
 try{await view.render('bottom',[]);expect(scientificStateFor('A',text).revision?.document).toBe(science);await view.render('right',[]);expect(scientificStateFor('A',text).revision).toBeNull();}
 finally{await view.close();forgetImportedSource(token);}
});
