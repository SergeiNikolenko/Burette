'use strict';

// Embedded in Burette (the Interactions dock tab and the ligand card): the host
// computes the diagram of the structure it has open and sets ligand, design and
// theme; the diagram reports its ligands and the contact the user picks, so the
// host can show that pair in its 3D view.
(() => {
  const query = new URLSearchParams(location.search);
  if (query.get('embed') !== '1') return;
  document.documentElement.classList.add('embed');
  // A small host (a molecule card) has no room for the legend.
  if (query.get('legend') === '0') {
    document.head.append(Object.assign(document.createElement('style'), { textContent: '#legend { display: none !important; }' }));
  }
  const $ = (id) => document.getElementById(id);
  const post = (message) => window.parent.postMessage({ source: 'burette-lid', ...message }, '*');
  const residueOf = (id) => {
    const [name, chain, number] = String(id || '').split('_');
    return name && chain && number ? { name, chain, number: Number(number) } : null;
  };

  // The colour behind the frame in the host page: the backgrounds of the frame's
  // ancestors, composited down to the first opaque one. A host on another origin
  // cannot be read; the design then keeps its own background.
  function hostSurface() {
    let host = null;
    try { host = window.frameElement; } catch (_) { return null; }
    if (!host) return null;
    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const layers = [];
    for (let node = host.parentElement; node; node = node.parentElement) {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = host.ownerDocument.defaultView.getComputedStyle(node).backgroundColor;
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
      if (a) layers.unshift([r, g, b, a / 255]);
      if (a === 255) break;
    }
    if (!layers.length || layers[0][3] < 1) return null;
    const mixed = layers.reduce((under, [r, g, b, a]) => [r, g, b].map((value, i) => value * a + under[i] * (1 - a)), [0, 0, 0]);
    return `#${mixed.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
  }
  // The loading cover (--bg) takes the same colour as the drawing.
  function adoptSurface() {
    const surface = hostSurface();
    window.lid.state.surface = surface;
    if (surface) document.documentElement.style.setProperty('--bg', surface);
  }
  adoptSurface();

  function reportLigands() {
    const ligands = [...$('ligand').options].map((option) => ({ id: option.value, label: option.textContent }));
    post({ type: 'ligands', ligands });
  }
  new MutationObserver(reportLigands).observe($('ligand'), { childList: true });

  // The designs made for a host, in their order, once they have loaded; a card
  // offers them next to its title.
  function reportStyles() {
    const styles = Object.entries(window.lid?.styles ?? {}).filter(([, style]) => style.panel)
      .sort((a, b) => a[1].panel - b[1].panel).map(([id, style]) => ({ id, label: style.label }));
    if (styles.length) post({ type: 'styles', styles });
  }
  new MutationObserver(reportStyles).observe($('style'), { childList: true });

  // Hydrogens are drawn as counts on their heavy atoms (NH, OH). Hiding them
  // redraws with zero counts; the counts of the loaded diagram restore them.
  let showHydrogens = query.get('hydrogens') !== '0';
  const hydrogenCounts = new Map();
  const withHydrogens = (json) => {
    const scene = JSON.parse(json);
    for (const structure of scene.scene.structures) {
      for (const atom of structure.atoms) {
        const key = `${structure.id}:${atom.id}`;
        if (!hydrogenCounts.has(key)) hydrogenCounts.set(key, atom.hydrogenCount);
        atom.hydrogenCount = showHydrogens ? hydrogenCounts.get(key) : 0;
      }
    }
    return JSON.stringify(scene);
  };

  // #status hides once a diagram is drawn
  new MutationObserver(() => {
    if (!$('status').hidden || !window.lid?.state.ligand) return;
    post({ type: 'loaded', ligand: window.lid.state.ligand });
    // The drawer re-centres with an animation on every window resize event, which
    // makes a splitter drag jitter; the observer below refits once instead.
    const viewer = Object.getPrototypeOf(window.lid.drawer.svgDrawer.viewerDrawer);
    viewer.resize = function resizeAfterSettle() {};
    hydrogenCounts.clear();
    withHydrogens(window.lid.drawer.getJson());
    if (showHydrogens) requestAnimationFrame(fitAll);
    else redrawWhenVisible();
  }).observe($('status'), { attributes: true, attributeFilter: ['hidden'] });

  // One click can report the same residue twice: as the diagram's own
  // selection and as a click on the residue group.
  let lastContact = { key: '', time: 0 };
  // `links` are the atom pairs the host draws with their distances: the one
  // contact picked, or every contact of a picked residue.
  function postContact(contact, wholeResidue = false) {
    const [chain, number, name] = contact?.residueKey ?? [];
    const key = `${chain}:${number}`;
    if (contact && key === lastContact.key && performance.now() - lastContact.time < 400) return;
    lastContact = { key, time: performance.now() };
    const contacts = window.lid.state.data?.contacts ?? [];
    const picked = wholeResidue ? contacts.filter((c) => c.structure === contact.structure) : [contact];
    const links = contact ? picked.map((c) => ({ kind: c.kind, distance: c.distance, ligandAtom: c.ligandAtom, residueAtom: c.residueAtom })) : [];
    post({
      type: 'contact',
      contact: contact ? { kind: contact.kind, distance: contact.distance, residue: { chain, number, name }, ligand: residueOf(window.lid.state.ligand), links } : null,
    });
  }

  document.addEventListener('lid:selection', (event) => {
    postContact(event.detail.index == null ? null : window.lid.state.data?.contacts[event.detail.index]);
  });

  // Residue labels are small, thin strokes, so a click in the empty space around
  // one picks the residue whose box (with a little slack) is closest.
  function residueNear(x, y) {
    let best = null;
    let bestScore = Infinity;
    for (const node of document.querySelectorAll('.binding-residue[data-structure-id]')) {
      const r = node.getBoundingClientRect();
      const edge = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
      const score = edge + 0.01 * Math.hypot(x - (r.left + r.right) / 2, y - (r.top + r.bottom) / 2);
      if (edge <= 8 && score < bestScore) { best = node; bestScore = score; }
    }
    return best;
  }

  // A click on a ligand atom (its letter or a bond end) asks the host to mark that atom.
  function postAtomNear(x, y) {
    const lid = window.lid;
    const group = lid.drawer?.svgComponent.transformGroupsComponent.transformGroupDom.node();
    const ligand = lid.state.data?.scene.scene.structures[0];
    if (!group || !ligand) return false;
    // Atoms where they are drawn: a design that draws the ligand itself marks them, otherwise the scene has them.
    const screen = (node, px, py) => new DOMPoint(px, py).matrixTransform(node.getScreenCTM());
    const marks = [...document.querySelectorAll('#draw-area [data-ligand-atom]')];
    const atoms = marks.length
      ? marks.map((m) => ({ id: Number(m.dataset.ligandAtom), at: screen(m, Number(m.getAttribute('cx')), Number(m.getAttribute('cy'))) }))
      : (lid.drawer.sceneData.structuresData.structures[0]?.atomsData.atoms ?? []).map((a) => ({ id: a.id, at: screen(group, a.coordinates.x, a.coordinates.y) }));
    // within half a bond of the atom
    let best = null, distance = 5 * group.getScreenCTM().a;
    for (const atom of atoms) {
      const d = Math.hypot(atom.at.x - x, atom.at.y - y);
      if (d < distance) { distance = d; best = atom.id; }
    }
    if (best == null) return false;
    const source = ligand.atoms.find((a) => a.id === best);
    const name = source?.additionalInformation?.atomName ?? lid.state.data.atomRefs?.[best]?.atom;
    const residue = residueOf(lid.state.ligand);
    if (!name || !residue) return false;
    post({ type: 'atom', atom: { residue, name } });
    return true;
  }

  document.addEventListener('pointermove', (event) => {
    if (event.buttons) return;
    document.body.style.cursor = residueNear(event.clientX, event.clientY) ? 'pointer' : '';
  });

  // A click on a residue group (a drag moves it instead) shows that residue too
  let pressed = null;
  document.addEventListener('pointerdown', (event) => { pressed = [event.clientX, event.clientY]; }, true);
  document.addEventListener('click', (event) => {
    const moved = pressed && Math.hypot(event.clientX - pressed[0], event.clientY - pressed[1]) > 4;
    if (moved || !(event.target instanceof Element)) return;
    // a design may draw the ligand itself as structure 0; that is not a residue
    const area = event.target.closest('[data-binding-hit]');
    const group = area ? document.querySelector(`#draw-area .binding-residue[data-structure-id="${area.dataset.bindingHit}"]`)
      : event.target.closest('.binding-residue[data-structure-id]');
    const hit = group?.dataset.structureId === '0' ? null : group;
    // a ligand atom under the pointer wins over a residue merely nearby
    if (!hit && !event.target.closest('[data-contact-index]') && postAtomNear(event.clientX, event.clientY)) return;
    const node = hit ?? residueNear(event.clientX, event.clientY);
    // a click on free space asks the host for a larger view of the diagram
    if (!node && !event.target.closest('[data-contact-index]')) {
      post({ type: 'open' });
      return;
    }
    const contacts = window.lid.state.data?.contacts ?? [];
    const index = contacts.findIndex((c) => c.structure === Number(node?.dataset.structureId));
    if (index < 0) return;
    // a residue click also reaches the drawer as one of its contacts; the residue, with all of them, wins
    if (hit) { lastContact.key = ''; postContact(contacts[index], true); }
    else window.lid.selectContact(index);
  });

  // The drawer's own centring fits atoms only, so residue labels at the edge
  // fall outside a narrow pane; fit everything drawn, labels included. Residue
  // labels are about 5.6 drawing units tall, so below MIN_SCALE they stop being
  // readable: a drawing too large for the frame keeps that scale, centred on
  // the ligand, and the rest is a scroll or a drag away. A host with very
  // little room (a card) may lower the floor.
  const MIN_SCALE = Number(query.get('minscale')) || 1.7;
  const MAX_SCALE = 2.6;
  const MAX_ZOOM = 4;
  const MARGIN = 14;
  let fitScale = MIN_SCALE;

  function frame() {
    const lid = window.lid;
    const groups = lid?.drawer?.svgComponent?.transformGroupsComponent;
    if (!groups) return null;
    const svg = $('draw-area');
    const legend = $('legend');
    const height = svg.clientHeight - (legend?.offsetParent ? legend.offsetHeight + 18 : 0);
    const box = groups.transformGroupDom.node().getBBox();
    if (!box.width || !box.height || svg.clientWidth < 80 || height < 80) return null;
    return { lid, groups, svg, width: svg.clientWidth, height, box, transform: lid.drawer.interactionState.transformParams };
  }

  // One axis of the view: a drawing that fits stays centred; a larger one
  // slides until its edge, plus the margin, reaches the edge of the frame.
  function settle(size, scale, start, extent, wanted) {
    if (extent * scale <= size - 2 * MARGIN) return size / (2 * scale) - start - extent / 2;
    return Math.min(Math.max(wanted, (size - MARGIN) / scale - start - extent), MARGIN / scale - start);
  }

  function view(f, scale, x, y) {
    f.transform.scale = scale;
    f.transform.translate = {
      x: settle(f.width, scale, f.box.x, f.box.width, x),
      y: settle(f.height, scale, f.box.y, f.box.height, y),
    };
    f.groups.applyTransform(f.transform);
  }

  function fitAll() {
    const f = frame();
    if (!f) return;
    f.lid.drawer.svgDrawer.viewerDrawer.sceneData.setInfoForDrawing(f.svg.clientWidth, f.svg.clientHeight);
    fitScale = Math.min((f.width - 2 * MARGIN) / f.box.width, (f.height - 2 * MARGIN) / f.box.height);
    const scale = Math.min(Math.max(fitScale, MIN_SCALE), MAX_SCALE);
    const atoms = f.lid.drawer.sceneData.structuresData.structures[0]?.atomsData.atoms.map((atom) => atom.coordinates) ?? [];
    const middle = (key, fallback) => (atoms.length ? (Math.min(...atoms.map((p) => p[key])) + Math.max(...atoms.map((p) => p[key]))) / 2 : fallback);
    view(f, scale, f.width / (2 * scale) - middle('x', f.box.x + f.box.width / 2), f.height / (2 * scale) - middle('y', f.box.y + f.box.height / 2));
  }

  function zoomAbout(f, clientX, clientY, next) {
    const rect = f.svg.getBoundingClientRect();
    const px = clientX - rect.left, py = clientY - rect.top;
    const { scale, translate } = f.transform;
    next = Math.min(Math.max(next, Math.min(fitScale, scale)), MAX_ZOOM);
    view(f, next, translate.x + px / next - px / scale, translate.y + py / next - py / scale);
  }

  // The wheel scrolls a drawing larger than its frame; a pinch, or the wheel
  // with Ctrl or Cmd, zooms about the pointer. This replaces the drawer's own
  // wheel zoom, which has no bounds.
  document.addEventListener('wheel', (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('#draw-area')) return;
    const f = frame();
    if (!f) return;
    event.preventDefault();
    event.stopPropagation();
    const { scale, translate } = f.transform;
    if (event.ctrlKey || event.metaKey) zoomAbout(f, event.clientX, event.clientY, scale * Math.exp(-Math.min(Math.max(event.deltaY, -50), 50) * 0.01));
    else view(f, scale, translate.x - event.deltaX / scale, translate.y - event.deltaY / scale);
  }, { capture: true, passive: false });

  // A host shows the diagram for reading, so a drag never moves a residue or the
  // ligand away from its lines: it pans the whole drawing (within the bounds the
  // wheel uses) and a click still picks. These listeners run on the window, ahead
  // of the drawer's own drag handling, which starts on mousedown.
  let pan = null;
  let swallowClick = false;
  const onDiagram = (event) => event.target instanceof Element && !!event.target.closest('#draw-area');
  window.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !onDiagram(event)) return;
    // residues are moved by binding-edit.js; the rest of the drawing pans the view
    if (event.target.closest('.binding-residue[data-structure-id]:not([data-structure-id="0"]), [data-binding-hit]')) return;
    event.stopPropagation();
    pressed = [event.clientX, event.clientY];
    pan = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  }, true);
  window.addEventListener('mousedown', (event) => { if (onDiagram(event)) event.stopPropagation(); }, true);
  window.addEventListener('pointermove', (event) => {
    if (!pan || event.pointerId !== pan.id) return;
    event.stopPropagation();
    const dx = event.clientX - pan.x, dy = event.clientY - pan.y;
    if (!pan.moved && Math.hypot(dx, dy) < 4) return;
    pan.moved = true;
    pan.x = event.clientX;
    pan.y = event.clientY;
    const f = frame();
    if (!f) return;
    const { scale, translate } = f.transform;
    view(f, scale, translate.x + dx / scale, translate.y + dy / scale);
  }, true);
  const endPan = (event) => {
    if (!pan || event.pointerId !== pan.id) return;
    event.stopPropagation();
    swallowClick = pan.moved;
    pan = null;
  };
  window.addEventListener('pointerup', endPan, true);
  window.addEventListener('pointercancel', endPan, true);
  window.addEventListener('click', (event) => {
    if (!swallowClick) return;
    swallowClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  // WebKit reports a trackpad pinch as gesture events, not as a wheel
  let pinchStart = 1;
  document.addEventListener('gesturestart', (event) => {
    const f = frame();
    if (!f) return;
    event.preventDefault();
    pinchStart = f.transform.scale;
  });
  document.addEventListener('gesturechange', (event) => {
    const f = frame();
    if (!f) return;
    event.preventDefault();
    zoomAbout(f, event.clientX, event.clientY, pinchStart * event.scale);
  });

  // The host hides the frame (settings, other tabs) and resizes it. A diagram
  // drawn while hidden lays out in a zero box, so a theme redraw waits until
  // the frame is visible again; resizes only refit.
  let fitTimer = 0;
  let redrawFrame = 0;
  const redrawWhenVisible = () => {
    cancelAnimationFrame(redrawFrame);
    if ($('draw-area').getBoundingClientRect().width > 0) { window.lid.mount(withHydrogens(window.lid.drawer.getJson())); fitAll(); }
    else redrawFrame = requestAnimationFrame(redrawWhenVisible);
  };
  // Refit once the size settles; refitting on every frame of a splitter drag
  // makes the diagram jitter. The drawer replaces #draw-area on each mount, so
  // watch the body, which follows the frame.
  new ResizeObserver(([entry]) => {
    clearTimeout(fitTimer);
    const { width, height } = entry.contentRect;
    fitTimer = setTimeout(() => {
      const lid = window.lid;
      if (!width || !height || !lid?.state.data) return;
      // a frame that turned from wide to tall (or back) gets the layout drawn for that shape
      if (lid.canvasOrientation() !== lid.state.orientation) lid.loadComplex(lid.state.ligand);
      else fitAll();
    }, 150);
  }).observe(document.body);

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (event.source !== window.parent || message?.source !== 'burette-lid-host' || message.type !== 'configure') return;
    const lid = window.lid;
    if (!lid) return;
    const { ligand, style, theme, hydrogens } = message;
    let reload = false;
    let redraw = false;
    if (theme && theme !== lid.state.theme) {
      lid.state.theme = theme;
      adoptSurface();
      document.documentElement.dataset.theme = theme;
      redraw = true;
    }
    if (typeof hydrogens === 'boolean' && hydrogens !== showHydrogens) {
      showHydrogens = hydrogens;
      redraw = true;
    }
    if (redraw && lid.drawer && lid.state.data) redrawWhenVisible();
    if (style && style !== lid.state.style) {
      lid.useStyle(style);
      reload = true;
    }
    if (ligand && ligand !== lid.state.ligand) {
      lid.state.ligand = ligand;
      $('ligand').value = ligand;
      reload = true;
    }
    if (reload && lid.state.ligand) lid.loadComplex(lid.state.ligand);
  });

  post({ type: 'ready' });
})();
