// Avogadro-style pointer tools for the 3D view.
// Drag: a plain left drag on an atom moves it (or the whole selection containing
// it) in the camera plane through that atom, for the structure bound by a live
// Geometry lease. Draw: clicks and drags report drawing gestures to the host,
// which edits the structure. Other presses reach Mol* unchanged.
if (!window.BuretteAtomDrag) {
  const modes = new WeakMap(), drawModes = new WeakMap();

  // Asynchronous pick buffers answer `identify` with 'pending' until a read lands
  // (seconds while shaders compile). Hovering polls once per frame and keeps the
  // pick for the press while the pointer, camera and structure stay unchanged.
  function createPicker(plugin, canvas) {
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
      if (event.target !== canvas) return;
      hoverPoint = [event.clientX, event.clientY]; hoverTries = 0;
      if (hovered && Math.hypot(hovered.x - event.clientX, hovered.y - event.clientY) > 3) hovered = null;
      if (!hoverFrame) hoverFrame = requestAnimationFrame(probe);
    };
    const loci = event => {
      const rect = canvas.getBoundingClientRect();
      let pick = plugin.canvas3d.identify([event.clientX - rect.left, event.clientY - rect.top]);
      if (pick === 'pending') pick = hovered && Math.hypot(hovered.x - event.clientX, hovered.y - event.clientY) <= 3
        && hovered.view === view() && hovered.structure === shown() ? hovered.pick : undefined;
      return pick ? plugin.canvas3d.getLoci(pick.id).loci : null;
    };
    const dispose = () => { if (hoverFrame) cancelAnimationFrame(hoverFrame); hoverFrame = 0; };
    return { hover, loci, dispose };
  }
  // One atom of the shown structure, or null.
  function atomAt(plugin, loci) {
    const Element = window.molstar.lib.structure.StructureElement;
    if (!Element.Loci.is(loci) || Element.Loci.size(loci) !== 1) return null;
    const location = Element.Loci.getFirstLocation(loci);
    const structure = plugin.managers.structure.hierarchy.current.structures[0]?.cell.obj?.data;
    const unit = structure?.unitMap.get(location.unit.id);
    if (!unit || unit.model !== location.unit.model) return null;
    return { structure, unit: location.unit, row: location.element };
  }
  // The inverse of a unit operator's linear part, or null when it is singular.
  function inverseLinear(operator) {
    const m = [[operator[0], operator[4], operator[8]], [operator[1], operator[5], operator[9]], [operator[2], operator[6], operator[10]]];
    const det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    if (!det) return null;
    const cofactor = (r, c) => {
      const [r1, r2] = [0, 1, 2].filter(i => i !== r), [c1, c2] = [0, 1, 2].filter(i => i !== c);
      return ((r + c) % 2 ? -1 : 1) * (m[r1][c1] * m[r2][c2] - m[r1][c2] * m[r2][c1]);
    };
    return [0, 1, 2].map(r => [0, 1, 2].map(c => cofactor(c, r) / det));
  }
  const apply3 = (matrix, v) => matrix.map(row => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
  // Camera window coordinates are drawing-buffer pixels with a top-left origin.
  function windowPoint(plugin, canvas, event, depth) {
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width ? canvas.width / rect.width : 1;
    const out = [0, 0, 0];
    plugin.canvas3d.camera.unproject(out, [(event.clientX - rect.left) * scale, (event.clientY - rect.top) * scale, depth]);
    return out;
  }

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

    const picker = createPicker(plugin, canvas);
    const hover = event => { if (!drag) picker.hover(event); };
    const pickedAtom = event => atomAt(plugin, picker.loci(event));
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
      const now = windowPoint(plugin, canvas, drag.pointer, drag.depth), delta = now.map((value, axis) => value - drag.origin[axis]);
      const local = apply3(drag.inverse, delta);
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
      const world = [0, 0, 0];
      atom.unit.conformation.position(atom.row, world);
      const projected = [0, 0, 0, 0];
      plugin.canvas3d.camera.project(projected, world);
      // World deltas map back through the inverse of the unit operator's linear part.
      const inverse = inverseLinear(atom.unit.conformation.operator.matrix);
      if (!inverse) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const start = held.map(row => position(parsed.atoms, row));
      drag = {
        count: parsed.atoms.length, rows: held, sources: held.map(row => sourceIndex.value(row)), start, positions: start,
        text: binding.text, depth: projected[2], origin: windowPoint(plugin, canvas, event, projected[2]), pointer: event, frame: 0,
        inverse, unpin: () => {},
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
      picker.dispose();
      if (modes.get(plugin) === mode) modes.delete(plugin);
    }
    const mode = { dispose };
    modes.set(plugin, mode);
    window.addEventListener('pointerdown', down, true); window.addEventListener('pointermove', hover, true);
    return { enabled: true, lease };
  }

  // Draw mode reports one gesture per press, in source atom indices and model
  // coordinates (Å): `empty` (a click on empty space), `atom` (a click on an
  // atom), `drag` (from an atom into space), `bond` (from an atom onto another)
  // and `bond-click`. Presses on empty space that move still rotate the view.
  const CLICK_TOLERANCE = 4;
  function draw(viewer, action, currentViewer, notify) {
    const plugin = viewer?.plugin;
    if (typeof action.enabled !== 'boolean' || typeof action.lease !== 'string' || !action.lease || action.lease.length > 128) throw new Error('Invalid draw request.');
    if (!action.enabled) { drawModes.get(plugin)?.dispose(); return { enabled: false, lease: action.lease }; }
    const canvas = plugin?.canvas3dContext?.canvas;
    if (!canvas || !plugin.canvas3d) throw new Error('Drawing needs the 3D view.');
    drawModes.get(plugin)?.dispose();
    const lease = action.lease, isCurrent = () => !plugin.disposed && currentViewer() === viewer;
    const picker = createPicker(plugin, canvas), Bond = window.molstar.lib.structure.Bond;
    const source = (unit, row) => unit.model.atomicHierarchy.atomSourceIndex.value(row);
    // Model coordinates of a window point at `depth`, through the inverse of the unit operator.
    const modelPoint = (event, depth, unit) => {
      const world = windowPoint(plugin, canvas, event, depth), operator = unit.conformation.operator.matrix, inverse = inverseLinear(operator);
      return inverse ? apply3(inverse, [world[0] - operator[12], world[1] - operator[13], world[2] - operator[14]]) : null;
    };
    const depthOf = world => { const projected = [0, 0, 0, 0]; plugin.canvas3d.camera.project(projected, world); return projected[2]; };
    const hitAt = event => {
      const loci = picker.loci(event), atom = atomAt(plugin, loci);
      if (atom) {
        const world = [0, 0, 0];
        atom.unit.conformation.position(atom.row, world);
        return { kind: 'atom', unit: atom.unit, atom: source(atom.unit, atom.row), depth: depthOf(world) };
      }
      const structure = plugin.managers.structure.hierarchy.current.structures[0]?.cell.obj?.data;
      const bond = Bond.isLoci(loci) && loci.bonds.length ? loci.bonds[0] : null;
      if (!bond || structure?.unitMap.get(bond.aUnit.id)?.model !== bond.aUnit.model || bond.aUnit.model !== bond.bUnit.model) return null;
      return { kind: 'bond', atoms: [source(bond.aUnit, bond.aUnit.elements[bond.aIndex]), source(bond.bUnit, bond.bUnit.elements[bond.bIndex])] };
    };
    const post = gesture => notify({ type: 'atom-draw', lease, ...gesture });

    // A line from the pressed atom to the pointer while dragging.
    const doc = canvas.ownerDocument, svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'), line = doc.createElementNS('http://www.w3.org/2000/svg', 'line');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;display:none;overflow:visible';
    line.setAttribute('stroke', '#8e8e93'); line.setAttribute('stroke-width', '2'); line.setAttribute('stroke-linecap', 'round');
    svg.append(line); doc.body.append(svg);
    const cursor = canvas.style.cursor;
    canvas.style.cursor = 'crosshair';

    let press = null;
    const listen = add => {
      const method = add ? 'addEventListener' : 'removeEventListener';
      window[method]('pointermove', move, true); window[method]('pointerup', up, true);
      window[method]('pointercancel', cancel, true); window[method]('keydown', key, true); window[method]('blur', cancel);
    };
    const finish = () => { listen(false); press = null; svg.style.display = 'none'; };
    function down(event) {
      if (press || event.target !== canvas || event.button !== 0 || event.pointerType === 'touch'
        || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || !isCurrent()) return;
      press = { x: event.clientX, y: event.clientY, hit: hitAt(event), moved: false };
      // Presses on atoms and bonds belong to the tool; on empty space Mol* still rotates the view.
      if (press.hit) { event.preventDefault(); event.stopImmediatePropagation(); window.focus(); }
      listen(true);
    }
    function move(event) {
      picker.hover(event);
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_TOLERANCE) press.moved = true;
      if (!press.hit) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (press.hit.kind !== 'atom' || !press.moved) return;
      line.setAttribute('x1', press.x); line.setAttribute('y1', press.y); line.setAttribute('x2', event.clientX); line.setAttribute('y2', event.clientY);
      svg.style.display = '';
    }
    function up(event) {
      if (event.button !== 0) return;
      const { hit, moved } = press;
      finish();
      if (hit) { event.preventDefault(); event.stopImmediatePropagation(); }
      if (!isCurrent()) return;
      if (!hit) {
        if (moved) return;
        const structure = plugin.managers.structure.hierarchy.current.structures[0]?.cell.obj?.data, unit = structure?.units[0];
        const position = unit && modelPoint(event, depthOf(Array.from(plugin.canvas3d.camera.state.target)), unit);
        if (position) post({ gesture: 'empty', position });
        return;
      }
      if (hit.kind === 'bond') { if (!moved) post({ gesture: 'bond-click', atoms: hit.atoms }); return; }
      if (!moved) { post({ gesture: 'atom', atoms: [hit.atom] }); return; }
      const end = hitAt(event);
      if (end?.kind === 'atom' && end.atom !== hit.atom) { post({ gesture: 'bond', atoms: [hit.atom, end.atom] }); return; }
      const position = modelPoint(event, hit.depth, hit.unit);
      if (position) post({ gesture: 'drag', atoms: [hit.atom], position });
    }
    function cancel(event) {
      if (!press) return;
      if (press.hit) { event?.preventDefault?.(); event?.stopImmediatePropagation?.(); }
      finish();
    }
    function key(event) { if (event.key === 'Escape') cancel(event); }
    function dispose() {
      if (press) finish();
      window.removeEventListener('pointerdown', down, true); window.removeEventListener('pointermove', picker.hover, true);
      picker.dispose();
      svg.remove();
      canvas.style.cursor = cursor;
      if (drawModes.get(plugin) === mode) drawModes.delete(plugin);
    }
    const mode = { dispose };
    drawModes.set(plugin, mode);
    window.addEventListener('pointerdown', down, true); window.addEventListener('pointermove', picker.hover, true);
    return { enabled: true, lease };
  }
  window.BuretteAtomDrag = { set, draw };
}
