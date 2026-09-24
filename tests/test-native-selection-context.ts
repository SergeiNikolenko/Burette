import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createSelectionContext } from '../apps/burette-public-plugin/lib/hosted-context';

const source = readFileSync(new URL('../plugins/burette-agent/ui/native-workspace.mjs', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('  function observe(state)'), source.indexOf('  async function load(result)'));
const calls: any[] = [];
const observe = runInNewContext(`let latestState, contextSignature = '', contextQueue = Promise.resolve();
${code}
async state => { observe(state); await contextQueue; }`, {
  lifetime: { closed: false, close() {} }, placement: { observe() {} }, reveal() {}, fail() {}, gridSelections: new Map(),
  createSelectionContext, app: { getHostCapabilities: () => ({ updateModelContext: {} }),
    updateModelContext: async (context: unknown) => calls.push(JSON.parse(JSON.stringify(context))) },
});
const selected = { activeDocument: { id: 'protein', title: '1htb.pdb', ready: true }, scene: { selection: { counts: {
  atoms: 7, residues: [{ chain: 'A', sequence: 349, compId: 'VAL' }], level: 'residue',
} } } };
await observe(selected);
assert.equal(calls[0].presentation.composerAttachmentLayout, 'card');
assert.equal(calls[0].structuredContent.burette.activeSelection.residues[0].compId, 'VAL');
await observe(selected);
assert.equal(calls.length, 1, 'Heartbeat must not republish identical composer attachments');
await observe({ ...selected, scene: { selection: null } });
assert.deepEqual(calls[1], { content: [] });
await observe({ ...selected, activeDocument: { id: 'other', title: 'other.pdb', ready: false } });
assert.equal(calls.length, 2, 'Loading a different document must not restore stale selection');
console.log('Native composer: selected residue produces a draft attachment; deselection clears it; no automatic send');
