import { validateScientificDocument } from "../apps/desktop/src/lib/science-session/scientific-document";
import { readXyzFrames } from "../apps/desktop/src/lib/science-session/source-frames";
import { readFileSync } from 'node:fs';
import { test, expect, fixture, click, wait, button, holdQuantum, quantumHeld, releaseQuantum, act } from './orbitals-runtime-fixture';
import { runReaderTask } from '../apps/desktop/src/lib/workbench/reader-task';
const molden = readFileSync(new URL('fixtures/quantum/dispatcher/hydrogen.molden', import.meta.url), 'utf8');
const originalScience = () => runReaderTask({ action: 'parse', name: 'hydrogen.molden', text: molden });
const ready = (view: Awaited<ReturnType<typeof fixture>>) => wait(() => !button(view.host, 'Export Cube').disabled, 'current field');

test('switching alpha to beta selects its actual orbital, recomputes the native field and never exports the old alpha field as beta', async () => {
 const view = await fixture();
 try {
  await view.replaceScience(await originalScience());
  await click(view.host, 'Show surface'); await ready(view);
  await click(view.host, 'Export Cube'); await wait(() => view.saved.length === 1, 'alpha export');
  const alpha = await runReaderTask({ action: 'parse', name: 'alpha.cube', text: view.saved[0].text });
  holdQuantum(); await click(view.host, 'β');
  const selected = view.host.querySelector('tbody tr[aria-selected="true"]');
  expect(selected?.textContent).toContain('LUMO'); expect(selected?.querySelector('th')?.textContent).toContain('2');
  expect(button(view.host, 'Export Cube').disabled).toBe(true);
  await wait(quantumHeld, 'held actual beta quantum response');
  await click(view.host, 'Export Cube'); expect(view.saved).toHaveLength(1);
  releaseQuantum(); await ready(view);
  await click(view.host, 'Export Cube'); await wait(() => view.saved.length === 2, 'beta export');
  const beta = await runReaderTask({ action: 'parse', name: 'beta.cube', text: view.saved[1].text });
  expect(view.saved.map(file => file.title)).toEqual(['import-orbital-1.cube', 'import-orbital-2.cube']);
  expect(view.saved[1].text).not.toBe(view.saved[0].text);
  expect(Array.from(beta.grid!.values, value => value === 0 ? 0 : -value)).toEqual(Array.from(alpha.grid!.values));
  const volume = [...view.plugin.state.data.cells.values()].find(cell => cell.transform.transformer.id.endsWith('volume-from-cube'))!;
  expect(Array.from(volume.obj!.data.grid.cells.data, value => Math.fround(Number(value)))).toEqual(Array.from(beta.grid!.values));
  expect(view.fields()).toBe(1);
 } finally { releaseQuantum(); await view.close(); }
});

test('a real beta-only Molden source starts with its available channel and a usable selected orbital', async () => {
 const view = await fixture();
 try {
  const text = molden.replace('Sym= A\nEne= -0.5\nSpin= Alpha\nOccup= 1\n1 1.0\n', '');
  const science = await runReaderTask({ action: 'parse', name: 'beta.molden', text });
  expect(science.orbitals.map(orbital => orbital.spin)).toEqual(['beta']);
  await view.replaceScience(science);
  expect(button(view.host, 'β').getAttribute('aria-checked')).toBe('true');
  expect(button(view.host, 'α').disabled).toBe(true);
  expect(view.host.querySelectorAll('tbody tr[aria-selected="true"]')).toHaveLength(1);
  await click(view.host, 'Show surface'); await ready(view);
  await click(view.host, 'Export Cube'); await wait(() => view.saved.length === 1, 'beta-only export');
  const field = await runReaderTask({ action: 'parse', name: 'field.cube', text: view.saved[0].text });
  expect(field.grid!.values.every(value => value <= 0)).toBe(true);
  expect(field.grid!.values.some(value => value < 0)).toBe(true);
  expect(view.fields()).toBe(1);
 } finally { await view.close(); }
});

test('changing the displayed spin channel does not recompute or relabel total or spin density', async () => {
 const view = await fixture();
 try {
  for (const label of ['Density', 'Spin density']) {
   await click(view.host, label);
   const show = button(view.host, 'Show surface'); if (show) await click(view.host, 'Show surface');
   await ready(view);
   const before = view.calls.filter(action => action.cube);
   const spin = button(view.host, 'β').getAttribute('aria-checked') === 'true' ? 'α' : 'β';
   await click(view.host, spin); await act(async () => new Promise(resolve => setTimeout(resolve, 20)));
   expect(view.calls.filter(action => action.cube)).toEqual(before);
   expect(button(view.host, 'Export Cube').disabled).toBe(false);
   await click(view.host, 'Export Cube'); await wait(() => view.saved.length === (label === 'Density' ? 1 : 2), 'density export');
   expect(view.saved.at(-1)!.text).toBe(before.at(-1).cube);
   expect(view.saved.at(-1)!.title).toContain(label === 'Density' ? '-density.cube' : '-spin-density.cube');
  }
 } finally { await view.close(); }
});

test('schema-valid sparse source ids shared by alpha and beta select array positions and export unambiguous channel names', async () => {
 const view = await fixture();
 try {
  const original = await originalScience();
  const science = validateScientificDocument({ ...original, orbitals: original.orbitals.map(orbital => ({ ...orbital, index: 7 })) }, readXyzFrames('1\nimported\nH 0 0 0\n'));
  expect(science.orbitals.map(orbital => orbital.index)).toEqual([7, 7]);
  await view.replaceScience(science);
  expect(view.host.querySelector('tbody tr[aria-selected="true"] th')?.textContent).toContain('8HOMO');
  await click(view.host, 'Show surface'); await ready(view);
  await click(view.host, 'Export Cube'); await wait(() => view.saved.length === 1, 'sparse alpha export');
  await click(view.host, 'β'); await ready(view);
  expect(view.host.querySelector('tbody tr[aria-selected="true"] th')?.textContent).toContain('8LUMO');
  await click(view.host, 'Export Cube'); await wait(() => view.saved.length === 2, 'sparse beta export');
  expect(view.saved.map(file => file.title)).toEqual(['import-alpha-orbital-8.cube', 'import-beta-orbital-8.cube']);
  const a = await runReaderTask({ action: 'parse', name: 'a.cube', text: view.saved[0].text });
  const b = await runReaderTask({ action: 'parse', name: 'b.cube', text: view.saved[1].text });
  expect(Array.from(b.grid!.values, value => value === 0 ? 0 : -value)).toEqual(Array.from(a.grid!.values));
 } finally { await view.close(); }
});
