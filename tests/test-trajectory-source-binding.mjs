import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fixture, closeRuntime, bundleSha256 } from './fixtures/retained-trajectory-native.mjs';
const text='2\nowned frame 1\nC 0 0 0\nO 1 0 0\n2\nowned frame 2\nC 0 0 0\nO 2 0 0\n';
const foreign=text.replaceAll('owned','foreign'), hash=value=>createHash('sha256').update(value).digest('hex');
try{
 const f=await fixture(foreign), wanted={...f.expected(),sourceSha256:hash(text)}, before=f.plugin.state.data.getSnapshot();
 const rejected=await f.execute({type:'set_structure_pose',index:1,expected:wanted});
 assert.equal(rejected.ok,false,'A same-count unrelated XYZ must not authorize a plot seek');
 assert.equal(f.index(),0);assert.deepEqual(f.plugin.state.data.getSnapshot(),before);
 const report=await f.scope.BuretteSceneFiles.science.graphBinding(f.viewer,'xyz');assert.equal(report.sourceSha256,hash(foreign));
 assert.equal((await f.execute({type:'set_structure_pose',index:1,expected:f.expected()})).ok,true);assert.equal(f.index(),1);
 const retained=f.expected();await f.plugin.state.data.build().to(f.raw).update({data:text}).commit();
 const replaced=f.plugin.state.data.getSnapshot();assert.equal((await f.execute({type:'set_structure_pose',index:0,expected:retained})).ok,false);assert.deepEqual(f.plugin.state.data.getSnapshot(),replaced);
 // Existing player/CLI callers omit expected and retain their established behavior.
 assert.equal((await f.execute({type:'set_structure_pose',index:0})).ok,true);assert.equal(f.index(),0);
 assert.equal((await f.execute({type:'set_structure_pose',index:5})).ok,false);assert.equal(f.index(),0);
 console.log(JSON.stringify({bundleSha256:bundleSha256,sameCountForeignSource:'rejected unchanged',currentSource:'seek 0 to 1',replacedSource:'rejected unchanged',existingCaller:'preserved'}));
}finally{await closeRuntime();}
