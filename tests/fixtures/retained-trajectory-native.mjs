import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { Window } from 'happy-dom';
const dom = new Window({ url:'https://trajectory-binding.invalid/' });
Object.assign(dom,{setImmediate,clearImmediate});
const context=vm.createContext({ console, window:dom, self:dom, document:dom.document, navigator:dom.navigator,
  crypto, TextEncoder, TextDecoder, URL, URLSearchParams, Blob:dom.Blob, File:dom.File, FileReader:dom.FileReader,
  ArrayBuffer, Uint8Array, Int32Array, Float32Array, Float64Array, DataView, atob,btoa,performance,
  setTimeout,clearTimeout,setInterval,clearInterval,setImmediate,clearImmediate,queueMicrotask,
  requestAnimationFrame:cb=>setTimeout(cb,0),cancelAnimationFrame:clearTimeout });
const bundle=readFileSync('PreviewExtension/Web/molstar.js','utf8');vm.runInContext(bundle,context);
const built=vm.runInContext('molstar',context), plugins=[];
const hash=value=>createHash('sha256').update(value).digest('hex');
const source=readFileSync('PreviewExtension/Web/viewer.js','utf8');
function method(name,async=false){const start=source.indexOf(`  ${async?'async ':''}function ${name}(`);assert.ok(start>=0);return source.slice(start,source.indexOf('\n  }',start)+4);}
export async function fixture(input, format="xyz"){
 const plugin=new built.lib.plugin.PluginContext(built.lib.plugin.DefaultPluginSpec());plugins.push(plugin);await plugin.init();
 const raw=await plugin.builders.data.rawData({data:input}), trajectory=await plugin.builders.structure.parseTrajectory(raw,format);
 await plugin.builders.structure.hierarchy.applyPreset(trajectory,'default',{representationPreset:'empty'});
 const viewer={plugin}, scope={molstar:built};
 vm.runInNewContext(readFileSync('PreviewExtension/Web/scene-file-actions.js','utf8'),{window:scope,crypto,TextEncoder,TextDecoder,Uint8Array,Float64Array,File:dom.File});
 const model=()=>[...plugin.state.data.cells.values()].find(c=>c.transform.transformer===built.lib.plugin.StateTransforms.Model.ModelFromTrajectory);
 const setter=index=>plugin.state.data.build().to(model()).update({modelIndex:index}).commit();
 const pose=new Function('window','activeMolstarViewer','activeStructurePoseSetter','activeTrajectoryPlaybackControl','loadScript','runtimeURL',
  method('agentActionFailure')+method('agentFrameIndexFailure')+method('setStructurePoseFromAction',true)+';return setStructurePoseFromAction;')
  (scope,()=>viewer,setter,{frameCount:()=>trajectory.obj.data.frameCount},async()=>{},(_key,url)=>url);
 const binding=()=>scope.BuretteSceneFiles.science.binding(viewer);
 const expected=()=>{const report=binding();return {structureRef:report.structureRef,modelRef:report.modelRef,trajectoryRef:report.trajectoryRef,frameIndex:report.frameIndex,frameCount:report.frameCount,sourceSha256:hash(input),sourceExtension:'xyz'};};
 const bindingStart=source.indexOf("    if (type === 'scene_science_binding') {");
 const read=new Function('window','activeMolstarViewer',"return async action=>{const type=action.type;"+source.slice(bindingStart,source.indexOf("    if (type === 'scene_science_restore_ack') {",bindingStart))+"};")(scope,()=>viewer);
 const execute=action=>action.type==='scene_science_binding'?read(action):pose(action);
 return {plugin,raw,model,scope,science:scope.BuretteSceneFiles.science,viewer,execute,expected,index:()=>model().transform.params.modelIndex,close:()=>plugin.dispose()};
}

export const bundleSha256=hash(bundle);
export async function closeRuntime(){for(const p of plugins)if(!p.disposed)p.dispose();await dom.happyDOM.close();}

export const NativeFile = dom.File;
