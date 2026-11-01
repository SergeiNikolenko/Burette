(async () => {
 const runtime = globalThis.molstar; window.molstar = runtime;
 const { PluginContext, DefaultPluginSpec } = runtime.lib.plugin;
 const plugin = new PluginContext(DefaultPluginSpec()); await plugin.init();
 const sm = runtime.lib.structure;
 const quote = value => value.includes(' ') || value.includes("'") ? '"'+value+'"' : value.includes('"') ? "'"+value+"'" : value;
 const columns = ['group_PDB','id','type_symbol','label_atom_id','label_comp_id','label_asym_id','label_entity_id','label_seq_id','Cartn_x','Cartn_y','Cartn_z','auth_asym_id','auth_seq_id','pdbx_PDB_model_num'];
 const rows = names.flatMap((name,i)=>[0,1].map(j=>`ATOM ${i*2+j+1} C CA GLY L${i} 1 ${j+1} ${i*10+j} 2 3 ${quote(name)} ${j+1} 1`));
 const cif=['data_chains','loop_',...columns.map(x=>'_atom_site.'+x),...rows,''].join('\n');
 const extract=name=>{const found=viewerSource.match(new RegExp('\\n  (?:async )?function '+name+'\\([\\s\\S]*?\\n  \\}','u'));if(!found)throw Error('Missing source function '+name);return found[0]};
 try {
  const raw=await plugin.builders.data.rawData({data:cif,label:'Exact chains'});
  const trajectory=await plugin.builders.structure.parseTrajectory(raw,'mmcif');
  await plugin.builders.structure.hierarchy.applyPreset(trajectory,'default',{representationPreset:'empty'});
  const viewer={plugin,structureInteractivity(options){return runtime.Viewer.prototype.structureInteractivity.call(this,options)}};
  window.BuretteViewer=viewer; new Function('window',agentSource)(window);
  window.BuretteAgent.notifyStructureLoaded({viewer,config:{documentId:'chain-proof'},prepared:{format:'mmcif',data:cif}});
  const focus=[];const realFocus=plugin.managers.camera.focusLoci.bind(plugin.managers.camera);plugin.managers.camera.focusLoci=(loci,options)=>{focus.push(loci);return realFocus(loci,options)};
  const extra=viewerSource.includes('function molstarQueryComponentType(')?extract('molstarQueryComponentType'):'';
  const create=new Function('window','activeMolstarViewer','scheduleSceneTreeRender','debug',extra+['molstarCurrentStructures','normalizeSceneComponentKind','representationForSceneComponentKind','sceneActionFailure','createMolstarComponentFromQuery'].map(extract).join('\n')+'\nreturn createMolstarComponentFromQuery;')(window,()=>viewer,()=>{},()=>{});
  const ids=structure=>{const out=[];sm.Structure.eachAtomicHierarchyElement(structure,{atom:loc=>out.push(loc.unit.model.atomicConformation.atomId.value(loc.element))});return out.sort((a,b)=>a-b)};
  const lociIds=loci=>ids(sm.StructureElement.Loci.toStructure(loci));
  const records=[];
  for(let i=0;i<names.length;i++){
   const expected=[i*2+1,i*2+2],selector={auth_asym_id:names[i]};
   const selected=await window.BuretteAgent.run({command:'selectResidues',args:{selector,granularity:'atom'}});assert.equal(selected.ok,true);
   const actual=[...plugin.managers.structure.selection.entries.values()].flatMap(e=>lociIds(e.selection));assert.deepEqual(actual,expected);
   const focused=await window.BuretteAgent.run({command:'focusSelection',args:{selector}});assert.equal(focused.ok,true);assert.deepEqual(lociIds(focus.at(-1)),expected);
   const result=queries[i] ? await create({query:queries[i],label:names[i]}) : {ok:false,error:{code:'NO_QUERY'}};
   const components=plugin.managers.structure.hierarchy.current.structures.flatMap(s=>s.components).filter(c=>c.cell.obj.label===names[i]);
   const componentIds=components.flatMap(c=>ids(c.cell.obj.data));
   if(lane!=='baseline'){assert.equal(result.ok,true,names[i]);assert.deepEqual(componentIds,expected)}
   records.push({chain:names[i],query:queries[i],selected:actual,focused:lociIds(focus.at(-1)),component:result.ok?componentIds:result.error.code});
  }

  const finalComponents=plugin.managers.structure.hierarchy.current.structures.flatMap(s=>s.components);
  for(let i=0;i<names.length;i++) assert.deepEqual(finalComponents.filter(c=>c.cell.obj.label===names[i]).flatMap(c=>ids(c.cell.obj.data)),[i*2+1,i*2+2],`Earlier chain component must remain independently selectable: ${names[i]}`);
  const allStructure=plugin.managers.structure.hierarchy.current.structures[0];
  await plugin.builders.structure.tryCreateComponentStatic(allStructure.cell,'all','own-visible-all');
  const handlerStart=viewerSource.indexOf("    if (body?.type === 'compositionVisibilityRequest') {");
  assert.ok(handlerStart>=0);const handler=viewerSource.slice(handlerStart,viewerSource.indexOf("    if (!body || body.type !== 'agent-action'",handlerStart));
  let last=null;
  const receive=new Function('window','activeMolstarViewer','molstarStructureRuntime','post',`
    const compositionQueryCache=new WeakMap(), molstarCompositionQueries=new Map(), molstarCompositionHierarchyRequests=new Set();let molstarCompositionVisibilitySignature='';
    const sceneTreeColorState=()=>({value:undefined}), sceneTreeColorHex=()=>null;
    ${extra}${['molstarCurrentStructures','compositionQueryLoci','reportMolstarCompositionVisibility'].map(extract).join('\n')}
    return body=>{${handler}};
  `)(window,()=>viewer,()=>sm,(_type,_message,body)=>{last=JSON.parse(JSON.stringify(body))});
  const recv=body=>{const old=plugin.canvas3d;plugin.canvas3d={};try{receive(body)}finally{plugin.canvas3d=old}};
  recv({type:'compositionVisibilityRequest',hierarchy:true,requestId:'own-info-A',queries:queries.filter(Boolean)});
  const all=last.rows.find(r=>r.query==='all');assert.equal(all.counts.atoms,names.length*2);assert.equal(all.hierarchy.polymer.atoms,names.length*2);
  assert.deepEqual(all.hierarchy.chains.map(c=>c.authId).sort(),[...names].sort());
  for(let i=0;i<names.length;i++){const row=last.rows.find(r=>r.query===queries[i]);assert.equal(row.counts.atoms,2,names[i]);assert.equal(row.counts.chains,1,names[i])}
  recv({type:'compositionVisibilityRequest',hierarchy:true,requestId:'own-info-B'});assert.deepEqual(last.hierarchyRequestIds.sort(),['own-info-A','own-info-B']);
  recv({type:'compositionVisibilityRequest',releaseId:'own-info-A'});assert.deepEqual(last.hierarchyRequestIds,['own-info-B']);
  recv({type:'compositionVisibilityRequest',releaseId:'own-info-B'});assert.equal(last.hierarchyRequestIds,undefined);

  assert.equal(raw.data,cif);return {records,originalBytesPreserved:true,scientificBoundary:'actual built native parser/Viewer interactivity/selection/camera focus loci/component builder',cameraLimit:'No WebGL canvas; exact loci entering the real camera manager are observed.'};
 } finally {window.BuretteAgent?.detach();plugin.dispose()}
})()
