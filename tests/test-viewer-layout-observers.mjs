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
// Visibility probes reuse their measured bounds; a menu opening must not read
// the same rectangle once for visibility and again for placement.
const measurementWindow = new Window();
const measurementDocument = measurementWindow.document;
const measurementContext = vm.createContext({ window: measurementWindow, document: measurementDocument });
vm.runInContext(['visibleRect', 'visibleRectTop'].map(extract).join('\n'), measurementContext);
for (const { style, width, height, top, visible, reads } of [
  { style: '', width: 100, height: 40, top: 12, visible: true, reads: 1 },
  { style: '', width: 100, height: 40, top: 0, visible: true, reads: 1 },
  { style: '', width: 100, height: 40, top: -12, visible: true, reads: 1 },
  { style: 'display: none', width: 100, height: 40, top: 12, visible: false, reads: 0 },
  { style: 'visibility: hidden', width: 100, height: 40, top: 12, visible: false, reads: 0 },
  { style: '', width: 0, height: 40, top: 12, visible: false, reads: 1 },
  { style: '', width: 100, height: 0, top: 12, visible: false, reads: 1 },
]) {
  const element = measurementDocument.createElement('div');
  element.id = 'anchor'; element.style.cssText = style;
  measurementDocument.body.append(element);
  const bounds = { width, height, top };
  let rectReads = 0;
  element.getBoundingClientRect = () => { rectReads++; return bounds; };
  assert.equal(measurementContext.visibleRect('#anchor'), visible ? bounds : null);
  assert.equal(rectReads, reads);
  rectReads = 0;
  assert.equal(measurementContext.visibleRectTop('#anchor'), visible ? top : 0);
  assert.equal(rectReads, reads);
  element.remove();
}
assert.equal(measurementContext.visibleRect('#missing'), null);
assert.equal(measurementContext.visibleRectTop('#missing'), 0);
await measurementWindow.happyDOM.abort();
// Opening motion changes the painted rectangle, not the menu's layout size.
// Placement stays anchored and bounded throughout motion and without motion.
for (const reducedMotion of [false, true]) {
  for (const { railRect, anchor, placement, expected } of [
    { railRect: { left: 760, right: 796, width: 36, height: 172 }, anchor: { top: 550 }, placement: { horizontalPlacement: 'right' }, expected: ['430px', '194px'] },
    { railRect: { left: 4, right: 40, width: 36, height: 172 }, anchor: { top: 2 }, placement: { horizontalPlacement: 'left' }, expected: ['46px', '6px'] },
    { railRect: { width: 380, height: 32 }, anchor: { left: 720, right: 780, top: 560, bottom: 592 }, placement: { horizontalPlacement: 'right', verticalPlacement: 'above' }, expected: ['456px', '156px'] },
    { railRect: { width: 380, height: 32 }, anchor: { left: 780, right: 800, top: 560, bottom: 592 }, placement: {}, expected: ['470px', '194px'] },
  ]) {
    let scale = 1, animations = 0;
    const menu = { style: {}, dataset: {}, offsetWidth: 324, offsetHeight: 400,
      getBoundingClientRect: () => ({ width: 324 * scale, height: 400 * scale }),
      animate: () => { animations++; },
    };
    const rail = { dataset: placement, getBoundingClientRect: () => railRect };
    const trigger = { getBoundingClientRect: () => anchor, closest: () => rail };
    const menuContext = vm.createContext({ menu, FLOATING_MENU_EASE: 'ease-out',
      window: { innerWidth: 800, innerHeight: 600, matchMedia: () => ({ matches: reducedMotion }) },
      document: { getElementById: () => menu, querySelector: () => trigger },
    });
    vm.runInContext(['positionOpenViewportMenu', 'floatingMenuMotion', 'floatingMenuFrames', 'revealFloatingMenu'].map(extract).join('\n'), menuContext);
    menuContext.revealFloatingMenu(menu);
    assert.equal(animations, reducedMotion ? 0 : 1);
    for (scale of reducedMotion ? [1] : [0.96, 0.98, 1]) {
      menuContext.positionOpenViewportMenu();
      assert.deepEqual([menu.style.left, menu.style.top], expected);
    }
  }
}
// Execute the collision repair from the floating-layout pass. It must derive
// each position from the anchor, not repeatedly push the last repaired position.
const computePlacement = source.slice(source.indexOf("    const computeRect = visibleRect('[data-buret-action=\"generate-3d-conformer\"]');"), source.indexOf("    const bottomLimit = visibleRectTop", source.indexOf('function updateFloatingLayoutOffsets')));
assert.ok(computePlacement.length > 0);
for (const [posesRect, viewportControlsTop, expected] of [
  [{ left: 12, right: 334, top: 104, bottom: 140 }, 104, 152],
  [{ left: 12, right: 220, top: 104, bottom: 140 }, 104, 104],
  [{ left: 12, right: 334, top: 540, bottom: 576 }, 540, 492],
  [null, 104, 104],
]) {
  const positions = [];
  let reanchors = 0;
  const layout = vm.createContext({
    window: { innerHeight: 600 }, viewportControlsTop, TOOLBAR_MARGIN: 12, FLOATING_LAYOUT_GAP: 12,
    visibleRect: selector => selector === '.buret-docking-poses' ? posesRect : { left: 235, right: 339, height: 36 },
    root: { style: { setProperty: (name, value) => positions.push([name, value]) } },
    positionGenerate3DMenu: () => reanchors++,
  });
  vm.runInContext(extract('rectsOverlapX') + `\nfunction repair() {${computePlacement}}\nrepair(); repair();`, layout);
  assert.deepEqual(positions, [['--buret-compute-control-top', `${expected}px`], ['--buret-compute-control-top', `${expected}px`]]);
  assert.equal(reanchors, 2, 'an already-open menu follows its repaired trigger');
}
console.log('viewer layout observer settles and still repairs real layout changes');
