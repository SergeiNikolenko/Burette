import assert from 'node:assert/strict';
import React, { act } from 'react';
import { test } from 'bun:test';
import { Fixture, doc, until, createHost, resetSource, click } from './structure-edit-fixture';
import { useAppViewerStateMessages } from '../apps/desktop/src/hooks/use-app-viewer-state-messages';

test('the real selectionChanged receiver publishes atoms to the Edit panel', async () => {
  resetSource(true);
  const target = { ...doc, id: 'review-message-selection', path: '/review-message-selection.sdf' };
  let handle!: ReturnType<typeof useAppViewerStateMessages>['handleViewerStateMessage'];
  let messages = 0;
  const noop = () => {};
  function Workspace() {
    ({ handleViewerStateMessage: handle } = useAppViewerStateMessages({
      activeDocument: target, documents: [target], updateDirtyGridDocument: noop, addDocuments: noop,
      openCommandPalette: noop, openDockTab: noop, toggleDockTab: noop, setPreference: noop,
      setViewerLigandSelections: () => { messages++; }, setStructureOverlayModes: noop,
      setStructureStories: noop, toggleSidebar: noop, toggleDock: noop,
    }));
    return <><iframe className="viewer-iframe" data-document-id={target.id} data-renderer="molstar" /><Fixture document={target} /></>;
  }
  const { host, root } = createHost();
  const css = Object.getOwnPropertyDescriptor(globalThis, 'CSS');
  Object.defineProperty(globalThis, 'CSS', { configurable: true, value: window.CSS });
  try {
    await act(async () => root.render(<Workspace />));
    await until(host, () => host.querySelectorAll('[data-atom]').length === 3, 'atoms');
    const frame = host.querySelector('iframe')!;
    await act(async () => {
      assert.equal(handle('burette-viewer', { type: 'selectionChanged', documentId: target.id,
        selection: { atoms: 2, atomIdentities: [{ sourceIndex: 1, atomIndex: 1 }, { sourceIndex: 2, atomIndex: 2 }] },
      }, frame.contentWindow), true);
    });
    assert.equal(messages, 1, 'actual production selection receiver handled the message');
    const selected = [...host.querySelectorAll('[data-atom][aria-selected="true"]')].map(row => Number(row.getAttribute('data-atom')));
    assert.deepEqual(selected, [1, 2], '3D selection reaches the editor through the actual host receiver');
    assert.ok(host.textContent.includes('C2–O3'));
    const selectedRows = () => [...host.querySelectorAll('[data-atom][aria-selected="true"]')].map(row => Number(row.getAttribute('data-atom')));
    await act(async () => handle('burette-viewer', { type: 'selectionChanged', documentId: target.id, selection: null }, frame.contentWindow));
    assert.deepEqual(selectedRows(), [], 'clearing 3D selection clears the Edit selection');
    await click(host.querySelector('[data-atom="0"]'));
    const stale = document.createElement('iframe');
    stale.className = 'viewer-iframe'; stale.dataset.documentId = target.id; stale.dataset.renderer = 'molstar'; stale.hidden = true; host.append(stale);
    const replacement = { type: 'selectionChanged', documentId: target.id, selection: { atoms: 1, atomIdentities: [{ sourceIndex: 2 }] } };
    await act(async () => handle('burette-viewer', replacement, stale.contentWindow));
    assert.deepEqual(selectedRows(), [0], 'a hidden former scene cannot overwrite the active panel selection');
    frame.hidden = true;
    await act(async () => handle('burette-viewer', replacement, frame.contentWindow));
    assert.deepEqual(selectedRows(), [0], 'a warm hidden owner is not the currently displayed scene');
    frame.hidden = false;
    frame.dataset.sourcePreviewRole = 'staging';
    await act(async () => handle('burette-viewer', replacement, frame.contentWindow));
    assert.deepEqual(selectedRows(), [0], 'an unpromoted source preview cannot retarget the editor');
    delete frame.dataset.sourcePreviewRole;
    frame.dataset.readOnly = 'true';
    await act(async () => handle('burette-viewer', replacement, frame.contentWindow));
    assert.deepEqual(selectedRows(), [0], 'a read-only scene cannot retarget the editable panel');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    if (css) Object.defineProperty(globalThis, 'CSS', css); else Reflect.deleteProperty(globalThis, 'CSS');
  }
}, 30_000);
