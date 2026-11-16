'use strict';

// Motion for the binding diagrams, after the Codex app: whatever is dragged follows the pointer one to one
// and its contact lines stretch with it, the layout is recomputed once on release, and what changed
// settles into place. Timing uses the Codex tokens (150 ms basic fade, 250 ms drop, --cubic-enter).
(() => {
  const query = new URLSearchParams(location.search);
  if (query.get('collection') !== 'binding' || query.get('preview') === '1') return;

  const FADE = 150, SETTLE = 250;
  const ENTER = 'cubic-bezier(.19, 1, .22, 1)';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const SKIP = new Set(['defs', 'filter', 'linearGradient', 'radialGradient', 'clipPath', 'mask', 'marker', 'title']);

  let ends = new Map();     // contact index -> { a, b, sa, sb } as last drawn, in drawing units
  let shown = new Map();    // contact index -> ends as displayed by a live gesture
  let ligand = null;        // live ligand drag driven by the base drawer
  let skipNext = false;
  let running = [];

  const layers = () => [overlay.halos, overlay.smudges, overlay.chain, overlay.contour, overlay.studyUnder, overlay.distances, overlay.study];
  const studyLayers = () => [overlay.studyUnder, overlay.study];
  const css = m => `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f})`;
  const base = node => {
    const t = node.transform?.baseVal.consolidate();
    return t ? DOMMatrix.fromMatrix(t.matrix) : new DOMMatrix();
  };
  const apply = (m, p) => p && { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
  // The similarity that carries segment a-b onto a2-b2, stretching only along the line so strokes keep their width.
  const elastic = (a, b, a2, b2) => {
    const t1 = Math.atan2(b.y - a.y, b.x - a.x), t2 = Math.atan2(b2.y - a2.y, b2.x - a2.x);
    const s = Math.hypot(b2.x - a2.x, b2.y - a2.y) / (Math.hypot(b.x - a.x, b.y - a.y) || 1);
    return new DOMMatrix().translate(a2.x, a2.y).rotate(t2 * 180 / Math.PI).scale(s, 1)
      .rotate(-t1 * 180 / Math.PI).translate(-a.x, -a.y);
  };
  const still = m => Math.abs(m.a - 1) + Math.abs(m.b) + Math.abs(m.c) + Math.abs(m.d - 1) < 1e-3 && Math.hypot(m.e, m.f) < 0.25;
  const contactNodes = index => studyLayers().flatMap(layer => [...layer.querySelectorAll(`[data-contact-index="${index}"]`)])
    .filter(node => !node.parentElement.closest('[data-contact-index]'));
  const play = (node, frames, options) => {
    const animation = node.animate(frames, { fill: 'none', ...options });
    running.push(animation);
    animation.finished.catch(() => {}).finally(() => { running = running.filter(a => a !== animation); });
    return animation;
  };

  // ---- live gestures: move the drawn geometry instead of recomputing the layout every frame
  function stretch(moved) {
    for (const [index, end] of ends) {
      const ma = moved(end.sa), mb = moved(end.sb);
      if (!ma && !mb) continue;
      const a2 = ma ? apply(ma, end.a) : end.a, b2 = mb ? apply(mb, end.b) : end.b;
      if (!end.a || !end.b) continue;
      shown.set(index, { a: a2, b: b2 });
      const m = elastic(end.a, end.b, a2, b2);
      for (const node of contactNodes(index)) node.style.transform = css(m.multiply(base(node)));
    }
  }

  // binding-edit drags a residue group; `matrix` is the drag in drawing units
  function follow(sid, matrix) {
    document.documentElement.classList.add('lid-moving');
    stretch(s => (s === sid ? matrix : null));
  }

  function rigidFit(from, to) {
    const n = Math.min(from.length, to.length);
    if (!n) return new DOMMatrix();
    let pc = { x: 0, y: 0 }, qc = { x: 0, y: 0 };
    for (let i = 0; i < n; i++) { pc.x += from[i].x / n; pc.y += from[i].y / n; qc.x += to[i].x / n; qc.y += to[i].y / n; }
    let cross = 0, dot = 0;
    for (let i = 0; i < n; i++) {
      const px = from[i].x - pc.x, py = from[i].y - pc.y, qx = to[i].x - qc.x, qy = to[i].y - qc.y;
      cross += px * qy - py * qx; dot += px * qx + py * qy;
    }
    return new DOMMatrix().translate(qc.x, qc.y).rotate(Math.atan2(cross, dot) * 180 / Math.PI).translate(-pc.x, -pc.y);
  }

  // Called by the overlay loop while the base drawer moves the ligand.
  function track() {
    if (!ligand) return;
    const m = rigidFit(ligand.start, liveAtoms(0));
    ligand.matrix = m;
    for (const { node, matrix } of ligand.carried) node.style.transform = css(m.multiply(matrix));
    stretch(s => (s === 0 ? m : null));
  }

  function startLigand() {
    const box = groups().atomGroupsComponent.atomToSelMap[0]?.structureSel?.node()?.getBBox();
    const near = node => {
      if (!box) return false;
      const b = node.getBBox?.();
      return b && b.x < box.x + box.width + 4 && b.x + b.width > box.x - 4 && b.y < box.y + box.height + 4 && b.y + b.height > box.y - 4;
    };
    // decorations drawn on the ligand (features, burial field, arcs, contour) ride with it
    const carried = [overlay.smudges, overlay.contour].map(node => ({ node, matrix: base(node) }));
    for (const layer of studyLayers()) for (const unit of units(layer)) {
      if (unit.type === 'plain' && near(unit.node)) carried.push({ node: unit.node, matrix: base(unit.node) });
    }
    ligand = { start: liveAtoms(0).map(p => ({ ...p })), carried, matrix: new DOMMatrix() };
    document.documentElement.classList.add('lid-moving');
  }

  function clearLive() {
    for (const layer of [overlay.smudges, overlay.contour]) layer?.style.removeProperty('transform');
    document.documentElement.classList.remove('lid-moving', 'lid-dragging');
  }

  // Escape or a lost pointer: lines spring back to where they were drawn.
  function cancel() {
    for (const [index] of shown) for (const node of contactNodes(index)) {
      const from = node.style.transform;
      node.style.removeProperty('transform');
      if (from && !reduce.matches) play(node, [{ transform: from }, { transform: css(base(node)) }], { duration: SETTLE, easing: ENTER });
    }
    shown = new Map();
    clearLive();
  }

  // ---- redraws: snapshot what is on screen, redraw, then animate from the snapshot
  function units(layer) {
    const out = [], counts = new Map();
    const key = k => { const n = counts.get(k) || 0; counts.set(k, n + 1); return `${k}#${n}`; };
    const walk = (node, path) => [...node.children].forEach((child, i) => {
      const p = [...path, i], tag = child.tagName;
      if (SKIP.has(tag)) return;
      if (child.classList.contains('binding-residue') && child.dataset.structureId != null) out.push({ node: child, path: p, type: 'move', key: key(`r${child.dataset.structureId}`) });
      else if (child.dataset.contactIndex != null) out.push({ node: child, path: p, type: 'contact', index: Number(child.dataset.contactIndex), key: key(`c${child.dataset.contactIndex}`) });
      else if (tag === 'text') out.push({ node: child, path: p, type: 'move', key: key(`t${child.textContent}`) });
      else if (tag === 'g' && child.querySelector('.binding-residue, [data-contact-index], text')) walk(child, p);
      else out.push({ node: child, path: p, type: 'plain', key: child.outerHTML });
    });
    walk(layer, []);
    return out;
  }
  const centre = node => { const r = node.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
  const at = (root, path) => path.reduce((node, i) => node?.children[i], root);

  function capture() {
    for (const a of running.slice()) a.finish();
    document.querySelectorAll('#draw-area .lid-ghost').forEach(g => g.remove());
    const motion = !reduce.matches && !skipNext;
    skipNext = false;
    const previous = ends, displayed = shown;
    // labels hidden during a gesture come back by fading in where they were recomputed
    const wasMoving = document.documentElement.classList.contains('lid-moving');
    shown = new Map();
    if (!motion || layers().some(l => !l)) { clearLive(); return null; }
    const scale = overlay.study.getScreenCTM()?.a || 1;
    const snapshot = layers().map(layer => {
      const list = units(layer);
      for (const u of list) if (u.type === 'move') u.at = centre(u.node);
      const ghost = layer.cloneNode(true);
      ghost.classList.add('lid-ghost');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.setAttribute('pointer-events', 'none');
      for (const node of [ghost, ...ghost.querySelectorAll('*')]) {
        for (const name of ['id', 'tabindex', 'role', 'aria-label', 'aria-pressed', 'data-contact-index', 'data-structure-id']) node.removeAttribute(name);
        node.classList?.remove('binding-residue');
      }
      layer.after(ghost);
      return { layer, list, ghost };
    });
    clearLive();
    return () => {
      for (const { layer, list, ghost } of snapshot) {
        const moved = new Map(list.filter(u => u.type !== 'plain').map(u => [u.key, u]));
        const plain = new Map();
        for (const u of list) if (u.type === 'plain') plain.set(u.key, [...(plain.get(u.key) || []), u]);
        const hide = u => { const twin = at(ghost, u.path); if (twin) twin.style.visibility = 'hidden'; };
        const fadeIn = node => {
          const opacity = getComputedStyle(node).opacity;
          play(node, [{ opacity: 0 }, { opacity }], { duration: FADE, easing: 'ease' });
        };
        for (const u of units(layer)) {
          if (u.type === 'plain') {
            const same = plain.get(u.key);
            if (same?.length) hide(same.shift()); else fadeIn(u.node);
            continue;
          }
          const old = moved.get(u.key);
          if (!old) { fadeIn(u.node); continue; }
          hide(old);
          if (wasMoving && u.node.tagName === 'text') { fadeIn(u.node); continue; }
          const end = ends.get(u.index), from = displayed.get(u.index) || previous.get(u.index);
          const m = u.type === 'contact' && end?.a && end?.b && from?.a && from?.b ? elastic(end.a, end.b, from.a, from.b)
            : (() => { const now = centre(u.node); return new DOMMatrix().translate((old.at?.x - now.x) / scale || 0, (old.at?.y - now.y) / scale || 0); })();
          if (still(m)) continue;
          const b = base(u.node);
          play(u.node, [{ transform: css(m.multiply(b)) }, { transform: css(b) }], { duration: SETTLE, easing: ENTER });
        }
        const out = play(ghost, [{ opacity: 1 }, { opacity: 0 }], { duration: FADE, easing: 'ease', fill: 'forwards' });
        out.finished.catch(() => {}).finally(() => ghost.remove());
      }
    };
  }

  // ---- pointer gestures on the ligand drawn by the base drawer
  const onLigand = target => {
    const g = groups();
    const nodes = [g.atomGroupsComponent.atomToSelMap[0]?.structureSel?.node(), g.edgeGroupsComponent.edgeToSelMap[0]?.structureSel?.node()];
    return nodes.some(node => node?.contains(target));
  };
  document.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !window.lid?.drawer || !['movement', 'rotation'].includes(state.tool)) return;
    if (event.target instanceof Element && event.target.closest('#draw-area') && onLigand(event.target)) startLigand();
  }, true);
  const endLigand = () => {
    if (!ligand) return;
    const moved = !still(ligand.matrix);
    ligand = null;
    document.documentElement.classList.remove('lid-moving');
    if (!moved) { cancel(); return; }
    // the base drawer records the move after this event; if it does not, the overlay loop redraws
    overlay.signature = '';
  };
  document.addEventListener('pointerup', endLigand, true);
  document.addEventListener('pointercancel', endLigand, true);
  window.addEventListener('blur', endLigand);

  window.LidMotion = {
    record(list) { ends = new Map(list.map((c, i) => [i, c])); },
    holding: () => ligand != null,
    track, follow, cancel, capture,
    instant() { skipNext = true; },
    finish() { for (const a of running.slice()) a.finish(); document.querySelectorAll('#draw-area .lid-ghost').forEach(g => g.remove()); },
  };
})();
