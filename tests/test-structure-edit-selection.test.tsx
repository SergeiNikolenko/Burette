import assert from 'node:assert/strict';
import React, { act } from 'react';
import { test } from 'bun:test';
import { Fixture, doc, source, writes, until, click, button, createHost, resetSource, replaceSource, viewerActions, rememberViewerAtomSelection } from './structure-edit-fixture';
import { useSourceEditing } from '../apps/desktop/src/lib/source-editing/context';

for (const kind of ['bond', 'reorder', 'delete', 'viewer', 'clear', 'cancel', 'source'] as const) test(`pending ${kind} edit respects the latest selection and source`, async () => {
  resetSource(true);
  const { host, root } = createHost();
  const NativeWorker = globalThis.Worker;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let held = false;
  class HeldWorker extends NativeWorker {
    stopped = false;
    override postMessage(message: unknown, transfer: Transferable[]): void;
    override postMessage(message: unknown, options?: StructuredSerializeOptions): void;
    override postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
      const post = () => { if (Array.isArray(options)) super.postMessage(message, options); else super.postMessage(message, options); };
      if ((message as { action?: string })?.action === 'edit-graph' && !held) {
        held = true;
        void gate.then(() => { if (!this.stopped) post(); });
      } else post();
    }
    override terminate() { this.stopped = true; return super.terminate(); }
  }
  const selected = () => [...host.querySelectorAll('[data-atom][aria-selected="true"]')].map(row => Number(row.getAttribute('data-atom')));
  try {
    const target = { ...doc, id: `review-pending-selection-${kind}`, path: `/review-pending-selection-${kind}.sdf` };
    await act(async () => root.render(<Fixture document={target} />));
    await until(host, () => host.querySelectorAll('[data-atom]').length === 3, 'atoms');
    if (kind === 'source') await act(async () => useSourceEditing()!.beginEditing(target));
    if (kind === 'clear') {
      await act(async () => rememberViewerAtomSelection(target.id, { atoms: 2, atomIdentities: [{ sourceIndex: 1 }, { sourceIndex: 2 }] }));
      await until(host, () => host.textContent.includes('C2–O3'), 'viewer bond');
    } else if (kind === 'delete') await click(host.querySelector('[data-atom="1"]'));
    else if (kind !== 'reorder') {
      await click(host.querySelector('[data-atom="1"]'));
      await click(host.querySelector('[data-atom="2"]'), { metaKey: true });
      await until(host, () => host.textContent.includes('C2–O3'), 'bond');
    } else await click(host.querySelector('[data-atom="2"]'));
    globalThis.Worker = HeldWorker as typeof Worker;
    await click(button(host, kind === 'reorder' ? 'Move up' : kind === 'delete' ? 'Delete atom' : 'Double'));
    await until(host, () => held, 'held actual graph worker request');
    // The row remains interactive while the mutation controls are disabled.
    if (kind === 'viewer') await act(async () => rememberViewerAtomSelection(target.id, { atoms: 1, atomIdentities: [{ sourceIndex: 0, atomIndex: 0 }] }));
    else if (kind === 'clear') await act(async () => rememberViewerAtomSelection(target.id, null));
    else await click(host.querySelector(`[data-atom="${kind === 'reorder' ? 1 : kind === 'delete' ? 2 : 0}"]`));
    assert.deepEqual(selected(), kind === 'clear' ? [] : [kind === 'reorder' ? 1 : kind === 'delete' ? 2 : 0], 'the user changed the selection while the worker was pending');
    if (kind === 'cancel') {
      await click(button(host, 'Cancel'));
      await act(async () => { release(); await new Promise(resolve => setTimeout(resolve, 50)); });
      assert.equal(writes.length, 0, 'cancelled worker cannot publish');
      assert.deepEqual(selected(), [0], 'cancellation keeps the latest selection');
      return;
    }
    if (kind === 'source') await act(async () => replaceSource(source + '\n'));
    await act(async () => { release(); });
    if (kind === 'source') {
      await until(host, () => selected().length === 0 && host.querySelectorAll('[data-atom]').length === 3, 'external source reload');
      assert.equal(writes.length, 0, 'an external source edit cannot be overwritten by the held worker');
      assert.deepEqual(selected(), [], 'external reload invalidates indices from its previous snapshot');
      return;
    }
    await until(host, () => writes.length === 1 && !button(host, 'Undo').disabled, 'committed bond edit');
    if (kind !== 'reorder' && kind !== 'delete') assert.match(writes[0].content, /^M {2}V30 2 2 2 3$/mu);
    const expected = kind === 'clear' ? [] : [kind === 'reorder' ? 2 : kind === 'delete' ? 1 : 0];
    assert.deepEqual(selected(), expected, 'worker completion must remap the newer atom pick');
    assert.deepEqual((viewerActions.at(-1) as { atoms: number[] }).atoms, expected);
  } finally {
    release();
    globalThis.Worker = NativeWorker;
    await act(async () => root.unmount());
    host.remove();
    resetSource(true);
  }
}, 30_000);
