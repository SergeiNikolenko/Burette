'use strict';

// Custom depictions edit their source structure, so history and exports share one scene.
(() => {
  const query = new URLSearchParams(location.search);
  if (query.get('collection') !== 'binding' || query.get('preview') === '1') return;
  // a host (embed=1) marks the picked residue itself, in its own way
  const embedded = query.get('embed') === '1';

  const selector = '.binding-residue[data-structure-id]';
  let selected = null;
  let gesture = null;
  let observer = null;
  let suppressClick = false;

  const current = () => window.lid;
  // a residue is grabbed by its drawing or by the empty space inside its outline (a hit area under everything)
  const nodeAt = target => {
    if (!(target instanceof Element)) return null;
    const area = target.closest('[data-binding-hit]');
    return area ? document.querySelector(`#draw-area ${selector}[data-structure-id="${area.dataset.bindingHit}"]`) : target.closest(selector);
  };
  const transformGroup = () => current().drawer.svgComponent.transformGroupsComponent.transformGroupDom.node();
  const scenePoint = event => new DOMPoint(event.clientX, event.clientY).matrixTransform(transformGroup().getScreenCTM().inverse());

  function decorateSelection() {
    const svg = document.getElementById('draw-area');
    if (!svg) return;
    for (const node of svg.querySelectorAll(selector)) {
      const id = Number(node.dataset.structureId);
      if (!node.hasAttribute('tabindex')) {
        node.setAttribute('tabindex', '0');
        node.setAttribute('role', 'button');
        const source = current().state.data.scene.scene.structures.find(s => s.id === id);
        node.setAttribute('aria-label', source.structureName || source.structureLabel || `Structure ${id}`);
        node.style.cursor = 'grab';
      }
      // Residues drawn as thin lines are grabbed anywhere inside their outline. The area lies under the
      // whole drawing, so contact lines and ligand atoms over it keep their own clicks.
      const areas = overlay.studyUnder;
      if (id !== 0 && areas && !areas.querySelector(`:scope > [data-binding-hit="${id}"]`)) {
        const box = node.getBBox();
        const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        for (const [key, value] of Object.entries({ x: box.x - 1, y: box.y - 1, width: box.width + 2, height: box.height + 2,
          fill: 'transparent', stroke: 'none', 'data-binding-hit': id })) hit.setAttribute(key, value);
        areas.prepend(hit);
      }
      const active = id === selected;
      if (node.getAttribute('aria-pressed') !== String(active)) node.setAttribute('aria-pressed', String(active));
      const outline = node.querySelector('[data-binding-selection]');
      if (!active || embedded) { outline?.remove(); continue; }
      if (outline) continue;
      const box = node.getBBox();
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      for (const [key, value] of Object.entries({ x: box.x - 3, y: box.y - 3,
        width: box.width + 6, height: box.height + 6, rx: 2, fill: 'none',
        stroke: current().state.theme === 'dark' ? '#a1a1aa' : '#71717a',
        'stroke-width': 0.6, 'stroke-dasharray': '2 2', 'pointer-events': 'none',
        'data-binding-selection': '' })) rect.setAttribute(key, value);
      node.append(rect);
    }
  }

  function snapshot(id) {
    const drawer = current().drawer;
    const structure = drawer.sceneData.structuresData.structures[id];
    if (!structure) return null;
    const atoms = structure.atomsData.atoms.map(a => ({ id: a.id, ...a.coordinates }));
    const xs = atoms.map(a => a.x), ys = atoms.map(a => a.y);
    return { drawer, id, atoms, center: { x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2 },
      annotations: [...structure.annotationConnectionData.annotations].map(id => {
        const a = drawer.sceneData.annotationsData.annotations[id];
        return { id, coordinates: { ...a.coordinates },
          alternatives: Object.entries(a.structureRepresentationInfo).filter(([rep]) => Number(rep) !== structure.representationsData.curRepresentation())
            .map(([, info]) => ({ ...info.coordinates })) };
      }), oldMid: { ...structure.boundaries.mid } };
  }

  function commit(before, dx, dy, angle) {
    if (!dx && !dy && Math.abs(angle) < 0.001) return;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const point = p => ({ x: before.center.x + (p.x - before.center.x) * cos - (p.y - before.center.y) * sin + dx,
      y: before.center.y + (p.x - before.center.x) * sin + (p.y - before.center.y) * cos + dy });
    const annotationCoordinateChanges = {};
    for (const a of before.annotations) {
      annotationCoordinateChanges[a.id] = { newCoords: point(a.coordinates), structureMoved: true,
        interactionMode: angle ? InteractionMode.rotation : InteractionMode.movement, oldStructureMid: before.oldMid };
      if (angle && a.alternatives.length) Object.assign(annotationCoordinateChanges[a.id], {
        oldAltRotCoords: a.alternatives[0], newAltRotCoords: point(a.alternatives[0]),
      });
    }
    before.drawer.svgDrawer.applySceneChanges({ coordinateChanges: {
      [before.id]: { newCoordinates: Object.fromEntries(before.atoms.map(a => [a.id, point(a)])), isFlip: false },
    }, annotationCoordinateChanges });
  }

  function finish(cancel = false) {
    if (!gesture) return;
    const pending = gesture;
    gesture = null;
    document.documentElement.classList.remove('lid-dragging');
    if (pending.svg.hasPointerCapture(pending.pointerId)) pending.svg.releasePointerCapture(pending.pointerId);
    if (pending.moved) {
      suppressClick = true;
      // The click generated by this pointerup is dispatched before the next task.
      setTimeout(() => { suppressClick = false; }, 0);
    }
    if (pending.live) {
      cancelAnimationFrame(pending.frame);
      const keep = !cancel && pending.moved && pending.before.drawer === current().drawer
        && (pending.dx || pending.dy || Math.abs(pending.angle) >= 0.001);
      // the scene change redraws the diagram where the preview left it, without a settle animation
      if (keep) { current().previewDrag(null, null, false); window.LidMotion?.instant(); commit(pending.before, pending.dx, pending.dy, pending.angle); }
      else if (pending.moved) current().previewDrag(null);
      document.querySelector(`${selector}[data-structure-id="${selected}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (!cancel && pending.moved && pending.before.drawer === current().drawer) {
      // The group stays where it was dropped; the redraw that follows lays the residue out from there.
      const fromShown = pending.tool === 'movement' && typeof studyOf === 'function' && studyOf();
      fromShown?.moved?.add(pending.before.id);
      commit(pending.before, fromShown ? pending.shown.x + pending.dx - pending.before.center.x : pending.dx,
        fromShown ? pending.shown.y + pending.dy - pending.before.center.y : pending.dy, pending.angle);
      document.querySelector(`${selector}[data-structure-id="${selected}"]`)?.focus({ preventScroll: true });
      return;
    }
    const dropped = pending.node.getAttribute('transform');
    if (pending.transform === null) pending.node.removeAttribute('transform');
    else pending.node.setAttribute('transform', pending.transform);
    if (!pending.moved) return;
    window.LidMotion?.cancel();
    // A cancelled drag glides back instead of jumping.
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const matrix = value => { const g = document.createElementNS('http://www.w3.org/2000/svg', 'g'); g.setAttribute('transform', value || ''); const m = g.transform.baseVal.consolidate()?.matrix; return m ? `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f})` : 'none'; };
      pending.node.animate([{ transform: matrix(dropped) }, { transform: matrix(pending.transform) }], { duration: 250, easing: 'cubic-bezier(.19, 1, .22, 1)' });
    }
  }

  document.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const node = nodeAt(event.target);
    if (!node || !node.closest('#draw-area')) return;
    selected = Number(node.dataset.structureId);
    decorateSelection();
    node.focus({ preventScroll: true });
    // Stop the base drawer from moving an unrelated hovered atom underneath a clone.
    event.stopPropagation();
    if (!['movement', 'rotation'].includes(current().state.tool)) return;
    const before = snapshot(selected);
    if (!before) return;
    const start = scenePoint(event);
    gesture = { node, before, start, screenX: event.clientX, screenY: event.clientY,
      svg: document.getElementById('draw-area'), pointerId: event.pointerId,
      tool: current().state.tool, transform: node.getAttribute('transform'), moved: false, dx: 0, dy: 0, angle: 0,
      // drawn diagrams are laid out again around the dragged residue on every frame, unless their layout is too slow for that
      live: typeof studyOf === 'function' && !!studyOf() && studyOf().liveDrag !== false,
      // where the residue is drawn, which a design may keep apart from its scene position
      shown: (() => { const r = node.getBoundingClientRect(); return scenePoint({ clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }); })() };
  }, true);

  document.addEventListener('pointermove', event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (!gesture.moved && Math.hypot(event.clientX - gesture.screenX, event.clientY - gesture.screenY) < 4) return;
    event.preventDefault();
    if (!gesture.moved) {
      gesture.svg.setPointerCapture(event.pointerId);
      document.documentElement.classList.add('lid-dragging');
      // the lifted residue passes over its neighbours and their lines
      if (!gesture.live) gesture.node.parentNode.append(gesture.node);
    }
    gesture.moved = true;
    const p = scenePoint(event), center = gesture.before.center;
    let matrix;
    if (gesture.tool === 'rotation') {
      gesture.angle = Math.atan2(p.y - center.y, p.x - center.x) - Math.atan2(gesture.start.y - center.y, gesture.start.x - center.x);
      matrix = new DOMMatrix().translate(center.x, center.y).rotate(gesture.angle * 180 / Math.PI).translate(-center.x, -center.y);
      if (!gesture.live) gesture.node.setAttribute('transform', `rotate(${gesture.angle * 180 / Math.PI} ${center.x} ${center.y}) ${gesture.transform || ''}`);
    } else {
      gesture.dx = p.x - gesture.start.x;
      gesture.dy = p.y - gesture.start.y;
      matrix = new DOMMatrix().translate(gesture.dx, gesture.dy);
      if (!gesture.live) gesture.node.setAttribute('transform', `translate(${gesture.dx} ${gesture.dy}) ${gesture.transform || ''}`);
    }
    if (gesture.live) {
      const live = gesture;
      cancelAnimationFrame(live.frame);
      live.frame = requestAnimationFrame(() => { if (gesture === live) current().previewDrag(live.before.id, matrix); });
      return;
    }
    window.LidMotion?.follow(gesture.before.id, matrix);
  }, { capture: true, passive: false });

  document.addEventListener('pointerup', event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.stopPropagation();
    finish();
  }, true);
  document.addEventListener('pointercancel', event => {
    if (gesture?.pointerId === event.pointerId) finish(true);
  }, true);
  document.addEventListener('lostpointercapture', event => {
    if (gesture?.pointerId === event.pointerId) finish(true);
  }, true);
  window.addEventListener('blur', () => finish(true));

  document.addEventListener('click', event => {
    if (!suppressClick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && gesture) {
      finish(true);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const node = nodeAt(event.target);
    if (!node || event.altKey || event.ctrlKey || event.metaKey) return;
    if (['Enter', ' '].includes(event.key) && !event.target.closest('[data-contact-index]')) {
      selected = Number(node.dataset.structureId);
      decorateSelection();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    if (gesture || !['movement', 'rotation'].includes(current().state.tool)) return;
    const before = snapshot(Number(node.dataset.structureId));
    if (!before) return;
    selected = before.id;
    const sign = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
    const step = event.shiftKey ? 5 : 2;
    event.preventDefault();
    event.stopPropagation();
    const rotation = current().state.tool === 'rotation';
    // keyboard nudges repeat quickly, so they apply without animation
    window.LidMotion?.instant();
    commit(before, rotation || ['ArrowUp', 'ArrowDown'].includes(event.key) ? 0 : sign * step,
      rotation || ['ArrowLeft', 'ArrowRight'].includes(event.key) ? 0 : sign * step,
      rotation ? sign * (event.shiftKey ? 15 : 5) * Math.PI / 180 : 0);
    document.querySelector(`${selector}[data-structure-id="${selected}"]`)?.focus({ preventScroll: true });
  }, true);

  document.addEventListener('lid:ready', () => {
    finish(true);
    selected = null;
    if (typeof studyOf === 'function') studyOf()?.moved?.clear();
    observer?.disconnect();
    const history = current().drawer.svgDrawer.historyDrawer;
    const previous = history.sceneChangeCallback;
    history.sceneChangeCallback = function (json) {
      previous?.call(this, json);
      drawOverlay(true);
      decorateSelection();
    };
    observer = new MutationObserver(decorateSelection);
    observer.observe(document.getElementById('draw-area'), { childList: true, subtree: true });
    decorateSelection();
  });
})();
