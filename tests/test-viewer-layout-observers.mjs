import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';
const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const extract = name => source.match(new RegExp(`\\n  function ${name}\\([\\s\\S]*?\\n  \\}`, 'u'))?.[0] || '';
const window = new Window();
const { document } = window;
let observerPasses = 0, overflow = false;
class MutationObserver extends window.MutationObserver {
  constructor(callback) {
    super(records => {
      if (++observerPasses > 50) { overflow = true; this.disconnect(); return; }
      callback(records);
    });
  }
}
document.body.innerHTML = '<div class="msp-layout-region msp-layout-left"></div>';
let layoutPasses = 0;
const context = vm.createContext({ document, MutationObserver, layoutState: { left: 'hidden' }, leftPanelVisibilityGuardInstalled: false,
  stripMolstarSequenceTooltips() {}, installSequenceCloseButton() {}, scheduleViewportCornerLayout() { layoutPasses++; } });
vm.runInContext(['hasEffectiveLayoutMutation','syncLeftPanelVisibility','installLeftPanelVisibilityGuard'].map(extract).join('\n') + '\ninstallLeftPanelVisibilityGuard();', context);
const region = document.querySelector('div');
region.style.display = 'block';
// Bound the observation period; do not wait for a self-triggering observer to idle.
await new Promise(resolve => setTimeout(resolve, 30));
assert.equal(overflow, false, 'observer writes must not recursively starve the window event loop');
const firstPasses = layoutPasses;
await new Promise(resolve => setTimeout(resolve, 30));
assert.equal(layoutPasses, firstPasses, 'layout repair must settle, not feed its own observer');
assert.equal(region.style.display, 'none');
region.style.display = 'block';
await new Promise(resolve => setTimeout(resolve, 30));
assert.ok(layoutPasses > firstPasses, 'a subsequent real Mol* layout change must still be repaired');
assert.equal(region.style.display, 'none');
await window.happyDOM.abort();
console.log('viewer layout observer settles and still repairs real layout changes');
