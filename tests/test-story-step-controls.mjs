import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const controls = source.slice(source.indexOf('  function controlMolstarStory(action)'), source.indexOf('  // Mol* keeps the author'));
const applied = [];
let applying = false;
const manager = {
  state: { current: 'one', entries: ['one', 'two', 'three'].map(id => ({ key: id, snapshot: { id } })) },
  setCurrent(id) { this.state.current = id; return { id }; },
  async applyNext(direction) {
    const index = this.state.entries.findIndex(entry => entry.snapshot.id === this.state.current);
    await viewer.plugin.state.setSnapshot(this.setCurrent(this.state.entries[(index + direction + 3) % 3].snapshot.id));
  },
};
const viewer = { plugin: { managers: { snapshot: manager }, state: {
  async setSnapshot(snapshot) {
    assert.equal(applying, false, 'snapshot applications cannot overlap');
    applying = true;
    await new Promise(resolve => setTimeout(resolve, 5));
    applied.push(snapshot.id);
    applying = false;
  },
} } };
const context = {
  activeViewer: viewer, activeConfig: {}, window: {},
  molstarStoryState: () => ({ available: true }),
  molstarStoryResult: () => ({ current: manager.state.current }),
  agentActionFailure: (_command, code) => ({ error: code }),
  configuredMolstarStyle: () => 'default', configuredMolstarAppearance: () => 'illustrative',
  molstarStoryPresentationRequiresRebuild: () => false,
  applyMolstarStoryStyleToSnapshots() {}, setMolstarStoryTransition() {}, syncMolstarStoryUi() {},
  MOLSTAR_STORY_TRANSITION_MS: 180,
};
const control = new Function(...Object.keys(context), `let molstarStoryStepQueue = Promise.resolve(); let molstarStoryReportedAt = 0; ${controls}; return controlMolstarStory;`)(...Object.values(context));
const results = await Promise.all([
  control({ operation: 'goto', id: 'two' }),
  control({ operation: 'goto', id: 'two' }),
  control({ operation: 'next' }),
  control({ operation: 'previous' }),
]);
assert.deepEqual(applied, ['two', 'three', 'two'], 'duplicate selection must not rebuild; rapid steps stay ordered');
assert.deepEqual(results, [{ current: 'two' }, { current: 'two' }, { current: 'three' }, { current: 'two' }]);
assert.deepEqual(await control({ operation: 'goto', id: 'missing' }), { error: 'STORY_STEP_NOT_FOUND' });
assert.deepEqual(await control({ operation: 'goto', index: 0 }), { current: 'one' });
console.log('Story controls: ordered steps, duplicate selection skipped, invalid selection preserves queue');
