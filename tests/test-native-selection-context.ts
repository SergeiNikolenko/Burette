import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createSelectionContext } from '../apps/burette-public-plugin/lib/hosted-context';

const source = readFileSync(new URL('../plugins/burette-agent/ui/native-workspace.mjs', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('  function observe(state)'), source.indexOf('  async function load(result)'));
const calls: any[] = [];
const messages: any[] = [];
let onMessage = () => {};
const { observe, send } = runInNewContext(`let latestState, contextSignature = '', contextQueue = Promise.resolve(), sendingAnnotations = false;
${code}
({ observe: async state => { observe(state); await contextQueue; }, send: sendAnnotations })`, {
  lifetime: { closed: false, close() {} }, placement: { observe() {} }, reveal() {}, fail() {}, gridSelections: new Map(),
  createSelectionContext, app: { getHostCapabilities: () => ({ updateModelContext: {}, message: { text: {}, image: {} } }),
    updateModelContext: async (context: unknown) => calls.push(JSON.parse(JSON.stringify(context))),
    sendMessage: async (message: unknown) => { messages.push(message); onMessage(); return {}; } },
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

const context = { content: [{ type: 'text', text: 'Burette annotations on 1htb.pdb' }], presentation: { composerAttachmentLayout: 'card', composerLabel: 'Burette · 1 annotation · 1htb.pdb' } };
const image = { data: 'AAAA', mimeType: 'image/jpeg' };
const before = calls.length;
// A heartbeat that lands while the batch is posting must not replace its card.
onMessage = () => { void observe(selected); };
await send({ text: '1. Why is this charged?', context, image });
assert.deepEqual(calls.slice(before), [context], 'The batch card is published once, before its message');
assert.deepEqual(messages, [{ role: 'user', content: [{ type: 'text', text: '1. Why is this charged?' }, { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' }] }],
  'Send posts one message: the comments and one marked-up frame');
onMessage = () => {};
await observe(selected);
assert.equal(calls.at(-1).structuredContent.burette.activeSelection.residues[0].compId, 'VAL', 'After the post the selection card returns');
console.log('Native composer: selections are draft attachments; an annotation batch posts once as text, frame and card');
