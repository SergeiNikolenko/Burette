import { VolumeSegmentorManager, VolumeSegmentorBehavior, computeBodyMask, writeBodyMaskMrc, orderBodiesBySize, maskBaseName, bodyMaskFileName } from '@molstar/volume-tools-extension/segmentor';
import { Volume } from '@molstar/model/model/volume';
import { CCP4Writer } from '@molstar/model/formats/writer/ccp4/ccp4';
import { Task } from '@molstar/core/task';
import { UUID } from '@molstar/core/util/uuid';
import { zip } from '@molstar/core/util/zip/zip';
import { BuretteVolumeSegmentationState as Saved } from './molstar-volume-segmentation-state.js';

const panels = new WeakMap();
// Exports use the existing binary host bridge. Bound both allocation and payload.
const MaxExportBytes = 128 * 1024 * 1024;

function sourceVolumes(plugin) {
  return Saved.volumes(plugin);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function createPanel(plugin, { download, onError, canExport = true }) {
  const root = element('details', 'buret-volume-segmentation');
  const heading = element('summary', 'buret-tree-section', 'Segment map');
  root.append(heading);
  const content = element('div');
  root.append(content);
  let manager, drawing, pending = false, focusKey;
  let dust = 100, bundle = true, toolsOpen = false, mapEdit = '';

  function stopDrawing() {
    if (!drawing && !manager?.state.isDrawing) return;
    drawing?.();
    drawing = undefined;
    manager?.setDrawing(false);
  }

  async function run(action) {
    if (pending || manager?.state.busy) return;
    pending = true;
    render();
    try { await action(); if (manager && !manager.state.isDrawing) await Saved.persist(plugin, manager); }
    catch (error) { onError(error); }
    finally { pending = false; render(); }
  }

  function button(parent, label, action, disabled = false, key = label) {
    const node = element('button', 'buret-button', label);
    node.type = 'button';
    node.dataset.focusKey = key;
    node.disabled = disabled || pending || !!manager?.state.busy;
    node.addEventListener('click', () => void run(action));
    parent.append(node);
    return node;
  }

  function field(label, input) {
    const row = element('label', 'buret-tree-menu-field');
    input.name = label.toLowerCase().replace(/[^a-z]+/g, '-');
    input.dataset.focusKey = input.name;
    input.autocomplete = 'off';
    row.append(element('span', '', label), input);
    content.append(row);
    return input;
  }

  function number(label, value, action, { min, max, step = 1 } = {}) {
    const input = element('input', 'buret-input buret-tree-menu-text');
    input.type = 'number';
    input.value = String(value);
    input.step = String(step);
    if (min !== undefined) input.min = String(min);
    if (max !== undefined) input.max = String(max);
    input.disabled = pending || manager.state.busy;
    input.addEventListener('change', () => {
      const next = input.valueAsNumber;
      if (!Number.isFinite(next) || !input.checkValidity()) { render(); return; }
      void run(() => action(next));
    });
    return field(label, input);
  }

  function select(label, options, value, action) {
    const input = element('select', 'buret-select');
    for (const [id, name] of options) {
      const option = element('option', '', name);
      option.value = String(id);
      input.append(option);
    }
    input.value = String(value ?? '');
    input.disabled = pending || manager.state.busy;
    input.addEventListener('change', () => void run(() => action(input.value)));
    return field(label, input);
  }

  function beginDrawing() {
    stopDrawing();
    focusKey = 'draw-polygon';
    const body = manager.activeBody;
    if (body?.views.length >= 64) throw new Error('A body can contain at most 64 views.');
    const viewport = plugin.canvas3dContext?.canvas?.parentElement;
    const camera = plugin.canvas3d?.camera;
    if (!body || body.remainder) return;
    if (!viewport || !camera) throw new Error('The map viewport is unavailable. Reopen the map and try again.');
    const canvas = element('canvas', 'buret-volume-polygon');
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Draw a polygon. Enter finishes; Escape cancels.');
    const bounds = viewport.getBoundingClientRect();
    canvas.width = Math.round(bounds.width);
    canvas.height = Math.round(bounds.height);
    const snapshot = camera.getSnapshot();
    const { width: viewportWidth, height: viewportHeight } = camera.viewport;
    const vertexLimit = Math.min(1024, 16384 - manager.state.bodies.reduce((sum, item) => sum + item.views.reduce((n, view) => n + view.polygon.length, 0), 0));
    if (vertexLimit < 3) throw new Error('Map polygons exceed the 16384-vertex limit.');
    const points = [];
    const ctx = canvas.getContext('2d');
    const color = `#${body.color.toString(16).padStart(6, '0')}`;
    const paint = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!points.length) return;
      ctx.beginPath();
      ctx.moveTo(...points[0]);
      for (const point of points.slice(1)) ctx.lineTo(...point);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
      for (const point of points) { ctx.beginPath(); ctx.arc(...point, 4, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); }
    };
    const finish = () => {
      if (points.length < 3) return;
      const view = { id: UUID.create22(), label: `View ${body.views.length + 1}`, polygon: points.slice(), canvasWidth: canvas.width, canvasHeight: canvas.height, viewportWidth, viewportHeight, cameraSnapshot: snapshot };
      stopDrawing();
      void run(() => Saved.addView(manager, body.id, view));
    };
    const key = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); stopDrawing(); render(); }
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); finish(); }
      if (event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); points.pop(); paint(); }
      if (event.key.startsWith('Arrow')) {
        event.preventDefault(); event.stopPropagation();
        if (points.length >= vertexLimit) return;
        const last = points.at(-1) || [canvas.width / 2, canvas.height / 2];
        const cursor = [last[0] + (event.key === 'ArrowRight' ? 10 : event.key === 'ArrowLeft' ? -10 : 0), last[1] + (event.key === 'ArrowDown' ? 10 : event.key === 'ArrowUp' ? -10 : 0)];
        points.push(cursor); paint();
      }
    };
    canvas.addEventListener('pointerdown', event => {
      event.preventDefault(); event.stopPropagation();
      if (event.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const point = [(event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height];
      if (points.length >= 3 && Math.hypot(point[0] - points[0][0], point[1] - points[0][1]) < 12) { finish(); return; }
      if (points.length >= vertexLimit) return;
      points.push(point); paint();
    });
    canvas.addEventListener('dblclick', event => { event.preventDefault(); finish(); });
    canvas.addEventListener('keydown', key);
    const observer = new ResizeObserver(() => {
      const next = viewport.getBoundingClientRect();
      if (Math.abs(next.width - bounds.width) > 1 || Math.abs(next.height - bounds.height) > 1) { stopDrawing(); render(); }
    });
    observer.observe(viewport);
    viewport.append(canvas);
    drawing = () => { observer.disconnect(); canvas.remove(); };
    manager.setDrawing(true);
    canvas.focus();
  }

  async function exportMasks() {
    const volume = manager.volume, store = manager.store;
    if (!volume || !store) return;
    const bodies = orderBodiesBySize(bundle ? store.bodies : store.bodies.filter(body => body.id === manager.state.activeBodyId));
    const bytes = volume.grid.cells.data.length * 4 + 1024;
    if (bytes > MaxExportBytes || (bundle && bytes * bodies.length > MaxExportBytes)) {
      throw new Error('Masks exceed the 128 MiB export limit. Export individual masks or use a smaller map.');
    }
    const base = maskBaseName(volume.label).replace(/[^\w.-]/g, '_').slice(0, 160);
    await plugin.runTask(Task.create('Export map masks', async ctx => {
      const files = {};
      for (let i = 0; i < bodies.length; i++) {
        const body = bodies[i];
        await ctx.update({ message: `Exporting ${body.name}`, current: i, max: bodies.length });
        const result = await computeBodyMask(volume, store.labels, body.id, { ...manager.state.defaults, extend: body.extend ?? manager.state.defaults.extend, softEdge: body.softEdge ?? manager.state.defaults.softEdge }, manager.thresholdAbs, ctx);
        if (!result?.voxelCount) continue;
        const name = bodyMaskFileName(base, i + 1);
        const data = writeBodyMaskMrc(volume, result);
        if (bundle) files[name] = new Uint8Array(data);
        else download(new Blob([data], { type: 'application/octet-stream' }), name);
      }
      if (bundle && Object.keys(files).length) {
        const data = await zip(ctx, files, true);
        if (data.byteLength > MaxExportBytes) throw new Error('Masks exceed the 128 MiB export limit.');
        download(new Blob([data], { type: 'application/zip' }), `${base}_body_masks.zip`);
      }
    }));
  }

  function render() {
    if (!manager) return;
    const state = manager.state;
    if (content.contains(document.activeElement)) focusKey = document.activeElement.dataset.focusKey;
    content.replaceChildren();
    select('Map', sourceVolumes(plugin).map(v => [v.cell.transform.ref, v.cell.obj?.label || 'Map']), state.targetVolumeRef, ref => { stopDrawing(); return activateVolume(ref); });
    if (!manager.volume) { restoreFocus(); return; }
    number('Threshold', manager.thresholdAbs, value => manager.buretteSetThreshold(Volume.IsoValue.absolute(value)), { step: 'any' });
    const actions = element('div', 'buret-volume-actions');
    button(actions, 'Add body', () => manager.addBody(), state.bodies.length >= 255);
    button(actions, 'Remainder', () => manager.addRemainderBody(), state.bodies.some(b => b.remainder));
    button(actions, 'Undo', () => { stopDrawing(); return manager.undo(); }, !state.undoDepth);
    content.append(actions);
    if (state.bodies.length) {
      select('Body', state.bodies.map(b => [b.id, `${b.name} (${b.voxelCount})`]), state.activeBodyId, id => { stopDrawing(); manager.setActiveBody(Number(id)); });
      const active = manager.activeBody;
      if (active) {
        const name = element('input', 'buret-input buret-tree-menu-text');
        name.value = active.name;
        name.maxLength = 100;
        name.disabled = pending || state.busy;
        name.addEventListener('change', () => { const value = name.value.trim() || active.name; void run(() => manager.renameBody(active.id, value)); });
        field('Name', name);
        const color = element('input', 'buret-input');
        color.type = 'color';
        color.value = `#${active.color.toString(16).padStart(6, '0')}`;
        color.disabled = pending || state.busy;
        color.addEventListener('change', () => { const value = Number.parseInt(color.value.slice(1), 16); void run(() => manager.setBodyColor(active.id, value)); });
        field('Color', color);
        const row = element('div', 'buret-volume-actions');
        button(row, state.isDrawing ? 'Cancel drawing' : 'Draw polygon', () => state.isDrawing ? stopDrawing() : beginDrawing(), active.remainder, 'draw-polygon');
        button(row, 'Remove body', () => { stopDrawing(); return manager.removeBody(active.id); });
        button(row, 'Move up', () => manager.moveBody(active.id, -1), state.bodies[0]?.id === active.id);
        button(row, 'Move down', () => manager.moveBody(active.id, 1), state.bodies.at(-1)?.id === active.id);
        content.append(row);
        number('Extend (voxels)', active.extend ?? state.defaults.extend, extend => manager.setBodyMaskParams(active.id, { extend, softEdge: active.softEdge }), { min: 0, max: 100 });
        number('Soft edge (voxels)', active.softEdge ?? state.defaults.softEdge, softEdge => manager.setBodyMaskParams(active.id, { extend: active.extend, softEdge }), { min: 0, max: 100 });
        for (const view of active.views) {
          const row = element('div', 'buret-volume-actions');
          button(row, view.label, () => manager.flyTo(view, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 300), false, `${view.id}:focus`);
          button(row, view.inverted ? 'Include' : 'Exclude', () => manager.invertView(active.id, view.id), false, `${view.id}:invert`);
          button(row, 'Remove', () => manager.removeView(active.id, view.id), false, `${view.id}:remove`);
          content.append(row);
        }
      }
      select('Preview', [['none', 'Source'], ['active', 'Active body'], ['all', 'All bodies']], state.preview, value => manager.setPreview(value));
      if (canExport) select('Export', [['zip', 'All masks (ZIP)'], ['mrc', 'Active mask (MRC)']], bundle ? 'zip' : 'mrc', value => { bundle = value === 'zip'; });
      const exports = element('div', 'buret-volume-actions');
      button(exports, 'Export masks', exportMasks, !(bundle ? state.bodies.some(b => b.voxelCount > 0) : manager.activeBody?.voxelCount > 0));
      if (canExport) content.append(exports);
    }
    const status = element('output', 'buret-volume-count', `${state.stats.unassigned} / ${state.stats.candidates} voxels unassigned`);
    status.setAttribute('aria-live', 'polite');
    content.append(status);
    if (state.message) {
      const message = element('output', 'buret-volume-count', state.message);
      message.setAttribute('role', 'status');
      content.append(message);
    }
    const advanced = element('details');
    advanced.open = toolsOpen;
    advanced.addEventListener('toggle', () => { toolsOpen = advanced.open; });
    advanced.append(element('summary', 'buret-tree-section', 'Map tools'));
    number('Dust (voxels)', dust, value => { dust = value; }, { min: 1, max: 1e8 });
    advanced.append(content.lastChild);
    const edits = element('div', 'buret-volume-actions');
    button(edits, 'Remove dust…', () => { mapEdit = 'dust'; });
    button(edits, 'Flip handedness…', () => { mapEdit = 'flip'; });
    if (canExport) button(edits, 'Export map', () => {
      const volume = manager.volume;
      if (volume.grid.cells.data.length * 4 + 1024 > MaxExportBytes) throw new Error('Map exceeds the 128 MiB export limit.');
      const data = Float32Array.from(volume.grid.cells.data);
      download(new Blob([CCP4Writer.writeMrc(volume.grid, data)], { type: 'application/octet-stream' }), `${maskBaseName(volume.label)}_volume.mrc`);
    });
    button(edits, 'Undo map edit', () => Saved.edit(plugin, manager, 'undo'), !Saved.editCount(plugin, state.targetVolumeRef));
    advanced.append(edits);
    if (mapEdit) {
      const confirmation = element('div', 'buret-volume-confirm');
      confirmation.append(element('p', '', mapEdit === 'dust' ? `Remove regions below ${dust} voxels from the loaded map?` : 'Mirror the loaded map along X?'));
      confirmation.title = 'This changes the loaded map. The source file is unchanged.';
      button(confirmation, 'Apply', async () => {
        const operation = mapEdit;
        mapEdit = '';
        if (operation === 'dust') await Saved.edit(plugin, manager, { kind: 'dust', minVoxels: dust, threshold: manager.thresholdAbs });
        else await Saved.edit(plugin, manager, { kind: 'flip' });
      });
      button(confirmation, 'Cancel', () => { mapEdit = ''; });
      advanced.append(confirmation);
    }
    content.append(advanced);
    if (pending || state.busy) heading.textContent = 'Segment map · Working…';
    else heading.textContent = 'Segment map';
    restoreFocus();
  }

  function restoreFocus() {
    if (!focusKey || pending || manager.state.busy || manager.state.isDrawing || !root.isConnected || !root.open || root.closest('[hidden], [aria-hidden="true"], .hidden')) return;
    const active = document.activeElement;
    if (active !== document.body && active !== document.documentElement && !root.contains(active)) return;
    const controls = [...content.querySelectorAll('[data-focus-key]')];
    const target = controls.find(node => node.dataset.focusKey === focusKey && !node.disabled)
      || controls.find(node => node.dataset.focusKey === 'Add body' && !node.disabled);
    target?.focus({ preventScroll: true });
  }

  async function activateVolume(ref) {
    const target = await Saved.attach(plugin, ref);
    await manager.setTargetVolume(target);
    const definition = Saved.definition(plugin, target);
    if (definition) {
      await manager.setDefaults(definition.defaults);
      await manager.buretteSetThreshold(definition.threshold);
      await manager.setPreview(definition.preview || 'none');
    }
  }

  root.addEventListener('toggle', () => {
    if (!root.open) { stopDrawing(); return; }
    if (!manager) {
      void run(async () => {
        const transform = VolumeSegmentorBehavior;
        if (!plugin.state.behaviors.cells.has(transform.id)) {
          await plugin.state.behaviors.build().to('misc').apply(transform, {}, { ref: transform.id }).commit();
        }
        manager = VolumeSegmentorManager.get(plugin);
        if (!manager) throw new Error('Map segmentation could not be started.');
        manager.behaviors.state.subscribe({
          next: () => { if (!manager.state.isDrawing && drawing) stopDrawing(); render(); },
          complete: () => { drawing?.(); drawing = undefined; }
        });
        const ref = sourceVolumes(plugin)[0]?.cell.transform.ref;
        if (ref) await activateVolume(ref);
      });
    } else render();
  });
  return { root, stopDrawing, refresh() {
    const volumes = sourceVolumes(plugin);
    root.hidden = !volumes.length;
    if (manager && !volumes.some(v => v.cell.transform.ref === manager.state.targetVolumeRef)) {
      stopDrawing();
      const ref = volumes[0]?.cell.transform.ref;
      void run(() => ref ? activateVolume(ref) : manager.setTargetVolume(undefined));
    }
  } };
}

export const BuretteVolumeSegmentation = {
  cancelDrawing(plugin) { panels.get(plugin)?.stopDrawing(); },
  panel(plugin, options) {
    let panel = panels.get(plugin);
    if (!panel) { panel = createPanel(plugin, options); panels.set(plugin, panel); }
    panel.refresh();
    return panel.root;
  }
};
