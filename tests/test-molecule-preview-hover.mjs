import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const handler = source.slice(source.indexOf('    const updateMoleculePreviewFromHover ='), source.indexOf('    const moleculeHoverSubscription ='));
assert.ok(handler.length > 0);
let menu = false, activeCard = false;
const shown = [], restored = [];
const update = new Function('menuIsOpen', 'molstarMoleculePreviewIsActive', 'molstarLociIsEmpty', 'molstarContextTargetForPick', 'showMolstarMoleculePreview', 'scheduleMolstarSelectedMoleculePreview', `${handler}; return updateMoleculePreviewFromHover;`)(
  () => menu, () => activeCard, loci => loci.kind === 'empty-loci', pick => ({ scope: pick.loci.scope, position: pick.position }),
  target => shown.push(target), () => restored.push(true),
);
const hover = { current: { loci: { kind: 'element-loci', scope: 'ligand' } }, position: [1, 2, 3], buttons: 0 };
update(hover);
assert.deepEqual(shown, [{ scope: 'ligand', position: [1, 2, 3] }]);
update({ ...hover, buttons: 1 });
menu = true; update(hover); menu = false;
activeCard = true; update(hover); activeCard = false;
assert.equal(shown.length, 1, 'drag, menu and interaction with the preview must not trigger preview work');
assert.equal(restored.length, 0, 'rotation must not rebuild selection previews');
update({ current: { loci: { kind: 'empty-loci' } }, buttons: 0 });
update({ current: { loci: { kind: 'element-loci', scope: 'residue' } }, buttons: 0 });
assert.equal(restored.length, 2, 'leaving a ligand restores the explicit selection preview');
assert.doesNotMatch(handler, /identify|molstarContextPickFromEvent|requestAnimationFrame/);
assert.match(source, /interaction\.hover\.subscribe\(updateMoleculePreviewFromHover\)/);
assert.match(source, /moleculeHoverSubscription\.unsubscribe\(\)/);
console.log('Molecule preview reuses async Mol* hover; no duplicate GPU pick or drag work');
