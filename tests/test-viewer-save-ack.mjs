import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const extract = name => {
  const match = source.match(new RegExp(`\\n  (?:async )?function ${name}\\([\\s\\S]*?\\n  \\}`, 'u'));
  assert.ok(match, name);
  return match[0];
};
const ack = source.slice(source.indexOf("    if (body.type === 'structureExportResult')"), source.indexOf("    if (body.type === 'viewerVisibilityChanged')"));
const harness = new Function(`
  let molstarPresetPreviewSceneRevision = 0, molstarStructureDirty = true, pendingMolstarSave = null;
  const messages = [], postHostMessage = body => { messages.push(body); return true; }, updateSaveModifiedStructureButton = () => {};
  const normalizeFormat = format => format;
  const payload = {name:'model.pdb',text:'atoms'};
  const molstarModifiedStructureExportPayload = () => payload;
  const molstarModifiedStructureExportPayloadForFormat = () => payload;
  ${['setMolstarStructureDirty','postMolstarModifiedStructureExport','saveMolstarModifiedStructure','saveMolstarModifiedStructureAs'].map(extract).join('\n')}
  return { save: saveMolstarModifiedStructure, saveAs: saveMolstarModifiedStructureAs,
    edit: () => setMolstarStructureDirty(true), dirty: () => molstarStructureDirty,
    ack: status => { const body = {type:'structureExportResult',requestId:messages.filter(m=>m.type==='exportText').at(-1).requestId,status}; ${ack} }, messages };
`)();
for (const status of ['cancelled', 'error']) {
  harness.edit(); harness.save(); assert.equal(harness.dirty(), true);
  harness.ack(status); assert.equal(harness.dirty(), true);
}
harness.save(); harness.edit(); harness.ack('saved'); assert.equal(harness.dirty(), true);
harness.saveAs('sdf'); harness.ack('saved'); assert.equal(harness.dirty(), true, 'selection export cannot save whole document');
harness.save(); harness.ack('saved'); assert.equal(harness.dirty(), false);
console.log('Save acknowledgement, cancel, error, concurrent edit and partial export passed');
