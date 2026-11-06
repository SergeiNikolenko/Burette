// Avogadro-style atom dragging for the structure bound by a live Geometry lease.
// A plain left drag on an atom moves it (or the whole selection containing it) in
// the camera plane through that atom; other presses reach Mol* unchanged.
if (!window.BuretteAtomDrag) {
  const modes = new WeakMap();

  function rows(text) {
    const lines = text.trimEnd().split(/\r\n?|\n/u);
    return { lines, atoms: lines.slice(2).map(line => line.trim().split(/\s+/u)) };
  }
  function position(atoms, index) { return atoms[index].slice(1, 4).map(Number); }

  function set(viewer, action, currentViewer, notify) {
    const plugin = viewer?.plugin, geometry = window.molstar?.BuretteGeometry;
    if (typeof action.enabled !== 'boolean' || typeof action.lease !== 'string' || !action.lease || action.lease.length > 128) throw new Error('Invalid atom drag request.');
    if (!action.enabled) { modes.get(plugin)?.dispose(); return { enabled: false, lease: action.lease }; }
    if (!geometry?.pin) throw new Error('Reload a runtime supporting atom dragging.');
    const isCurrent = () => !plugin.disposed && currentViewer() === viewer;
    geometry.capture(plugin, isCurrent, action.lease);
    const canvas = plugin.canvas3dContext?.canvas;
    if (!canvas || !plugin.canvas3d) throw new Error('Atom dragging needs the 3D view.');
    modes.get(plugin)?.dispose();
    const lease = action.lease;
    let drag = null;
    const token = () => geometry.capture(plugin, isCurrent, lease);
    const post = (phase, current = drag) => notify({ type: 'atom-drag', phase, lease, atoms: current.sources, positions: current.positions });

    // Camera window coordinates are drawing-buffer pixels with a top-left origin.
    const windowPoint = (event, depth) => {
      const rect = canvas.getBoundingClientRect();
      const scale = rect.width ? canvas.width / rect.width : 1;
      const out = [0, 0, 0];
      plugin.canvas3d.camera.unproject(out, [(event.clientX - rect.left) * scale, (event.clientY - rect.top) * scale, depth]);
      return out;
    };
    // Asynchronous pick buffers answer `identify` with 'pending' until a read lands
    // (seconds while shaders compile). Hovering polls once per frame and keeps the
    // pick for the press while the pointer, camera and structure stay unchanged.
    let hovered = null, hoverPoint = null, hoverFrame = 0, hoverTries = 0;
    const view = () => Array.from(plugin.canvas3d?.camera.view || []).join();
    const shown = () => plugin.managers.structure.hierarchy.current.structures[0]?.cell.obj?.data;
    const probe = () => {
      hoverFrame = 0;
      const [x, y] = hoverPoint, rect = canvas.getBoundingClientRect();
      const pick = plugin.canvas3d?.identify([x - rect.left, y - rect.top]);
      if (pick !== 'pending') hovered = { x, y, pick, view: view(), structure: shown() };
      else if (++hoverTries < 1200) hoverFrame = requestAnimationFrame(probe);
    };
    const hover = event => {
      if (drag || event.target !== canvas) return;
      hoverPoint = [event.clientX, event.clientY]; hoverTries = 0;
      if (hovered && Math.hypot(hovered.x - event.clientX, hovered.y - event.clientY) > 3) hovered = null;
      if (!hoverFrame) hoverFrame = requestAnimationFrame(probe);
    };
    const pickedAtom = event => {
      const rect = canvas.getBoundingClientRect(), Element = window.molstar.lib.structure.StructureElement;
      let pick = plugin.canvas3d.identify([event.clientX - rect.left, event.clientY - rect.top]);
      if (pick === 'pending') pick = hovered && Math.hypot(hovered.x - event.clientX, hovered.y - event.clientY) <= 3
        && hovered.view === view() && hovered.structure === shown() ? hovered.pick : undefined;
      const loci = pick ? plugin.canvas3d.getLoci(pick.id).loci : null;
      if (!Element.Loci.is(loci) || Element.Loci.size(loci) !== 1) return null;
      const location = Element.Loci.getFirstLocation(loci);
      const structure = plugin.managers.structure.hierarchy.current.structures[0]?.cell.obj?.data;
      const unit = structure?.unitMap.get(location.unit.id);
      if (!unit || unit.model !== location.unit.model) return null;
      return { structure, unit: location.unit, row: location.element };
    };
    const selectedRows = (structure, model) => {
      const Element = window.molstar.lib.structure.StructureElement, selected = new Set();
      const loci = plugin.managers.structure.selection.getLoci(structure);
      if (Element.Loci.is(loci)) Element.Loci.forEachLocation(loci, location => { if (location.unit.model === model) selected.add(location.element); });
      return selected;
    };
    // Rewrites the held atoms in any text the Geometry queue applies.
    const patch = text => {
      const parsed = rows(text);
      if (!drag || parsed.atoms.length !== drag.count) return text;
      drag.rows.forEach((row, i) => { parsed.atoms[row].splice(1, 3, ...drag.positions[i].map(geometry.coordinate)); });
      return [...parsed.lines.slice(0, 2), ...parsed.atoms.map(atom => atom.join(' '))].join('\n') + '\n';
    };

    const listen = add => {
      const method = add ? 'addEventListener' : 'removeEventListener';
      window[method]('pointermove', move, true); window[method]('pointerup', up, true);
      window[method]('pointercancel', cancel, true); window[method]('keydown', key, true); window[method]('blur', cancel);
    };
    const stop = () => {
      listen(false);
      if (drag?.frame) cancelAnimationFrame(drag.frame);
      drag?.unpin();
      drag = null;
    };
    const retire = () => { const current = drag; stop(); if (current) post('cancel', current); dispose(); };
    const send = (text, options) => {
      let owner;
      try { owner = token(); } catch { retire(); return Promise.resolve(); }
      return geometry.update(plugin, text, owner, options).catch(() => { try { token(); } catch { retire(); } });
    };
    const step = () => {
      drag.frame = 0;
      const now = windowPoint(drag.pointer, drag.depth), delta = now.map((value, axis) => value - drag.origin[axis]);
      const local = drag.inverse.map(row => row[0] * delta[0] + row[1] * delta[1] + row[2] * delta[2]);
      // Reported positions equal the decimals written into the Geometry text.
      drag.positions = drag.start.map(point => point.map((value, axis) => Number(geometry.coordinate(value + local[axis]))));
      let text;
      try { text = geometry.binding(plugin, isCurrent).text; } catch { retire(); return; }
      void send(text, { passive: true });
      if (drag) post('move');
    };
    function down(event) {
      if (drag || event.target !== canvas || event.button !== 0 || event.pointerType === 'touch'
        || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || !isCurrent()) return;
      let binding;
      try { token(); binding = geometry.binding(plugin, isCurrent); } catch { dispose(); return; }
      const atom = pickedAtom(event);
      if (!atom || binding.lease !== lease) return;
      const parsed = rows(binding.text), model = atom.unit.model, sourceIndex = model.atomicHierarchy.atomSourceIndex;
      const selected = selectedRows(atom.structure, model);
      const held = selected.has(atom.row) ? [...selected].sort((a, b) => a - b) : [atom.row];
      if (held.some(row => row >= parsed.atoms.length)) return;
      const operator = atom.unit.conformation.operator.matrix, world = [0, 0, 0];
      atom.unit.conformation.position(atom.row, world);
      const projected = [0, 0, 0, 0];
      plugin.canvas3d.camera.project(projected, world);
      // World deltas map back through the inverse of the unit operator's linear part.
      const m = [[operator[0], operator[4], operator[8]], [operator[1], operator[5], operator[9]], [operator[2], operator[6], operator[10]]];
      const det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
      if (!det) return;
      const cofactor = (r, c) => {
        const [r1, r2] = [0, 1, 2].filter(i => i !== r), [c1, c2] = [0, 1, 2].filter(i => i !== c);
        return ((r + c) % 2 ? -1 : 1) * (m[r1][c1] * m[r2][c2] - m[r1][c2] * m[r2][c1]);
      };
      event.preventDefault(); event.stopImmediatePropagation();
      const start = held.map(row => position(parsed.atoms, row));
      drag = {
        count: parsed.atoms.length, rows: held, sources: held.map(row => sourceIndex.value(row)), start, positions: start,
        text: binding.text, depth: projected[2], origin: windowPoint(event, projected[2]), pointer: event, frame: 0,
        inverse: [0, 1, 2].map(r => [0, 1, 2].map(c => cofactor(c, r) / det)), unpin: () => {},
      };
      try { drag.unpin = geometry.pin(plugin, patch, token()); } catch { drag = null; dispose(); return; }
      listen(true);
      // Escape reaches this frame only while it has focus.
      window.focus();
      post('start');
    }
    function move(event) {
      event.preventDefault(); event.stopImmediatePropagation();
      drag.pointer = event;
      if (!drag.frame) drag.frame = requestAnimationFrame(step);
    }
    function up(event) {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopImmediatePropagation();
      drag.pointer = event;
      if (drag.frame) { cancelAnimationFrame(drag.frame); step(); }
      if (!drag) return;
      const current = drag;
      let text;
      try { text = geometry.binding(plugin, isCurrent).text; } catch { retire(); return; }
      // Keep the pin until the final coordinates are applied, then release the atoms.
      listen(false);
      current.ended = true;
      void send(text, { passive: true }).finally(() => { if (drag === current) stop(); });
      post('end', current);
    }
    function cancel(event) {
      const current = drag;
      if (!current || current.ended) return;
      event?.preventDefault?.(); event?.stopImmediatePropagation?.();
      stop();
      current.positions = current.start;
      void send(current.text);
      post('cancel', current);
    }
    function key(event) { if (event.key === 'Escape') cancel(event); }
    function dispose() {
      if (drag?.ended) stop(); else cancel();
      window.removeEventListener('pointerdown', down, true); window.removeEventListener('pointermove', hover, true);
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      if (modes.get(plugin) === mode) modes.delete(plugin);
    }
    const mode = { dispose };
    modes.set(plugin, mode);
    window.addEventListener('pointerdown', down, true); window.addEventListener('pointermove', hover, true);
    return { enabled: true, lease };
  }
  window.BuretteAtomDrag = { set };
}
