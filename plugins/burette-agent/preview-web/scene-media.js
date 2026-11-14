// Avogadro-style scene media for the 3D view.
// SVG: the shown ball-and-stick, licorice and spacefill representations as flat
// vector shapes, painted back to front from the current camera, with the same
// colour and size themes as the render: one <circle> per atom, one <g> per bond.
// Movie: the canvas recorded at a chosen frame rate, optionally while the camera
// spins once about the screen's vertical axis; vibrations and trajectories that
// play in the view are recorded as shown.
if (!window.BuretteSceneMedia) {
  const SPHERE_TYPES = new Set(['ball-and-stick', 'spacefill']);
  const MAX_SECONDS = 60;
  const MOVIE_TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];

  const hex = color => `#${(color >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
  const shade = (color, factor) => {
    const channel = shift => Math.round(Math.min(255, Math.max(0, ((color >> shift) & 255) * factor)));
    return (channel(16) << 16) | (channel(8) << 8) | channel(0);
  };
  const round = value => Math.round(value * 100) / 100;
  const escape = text => String(text).replace(/[<>&"]/gu, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[ch]);

  // Visible sphere-and-stick representations with their structure and themes.
  function shownRepresentations(plugin) {
    const out = [];
    for (const cell of plugin.state.data.cells.values()) {
      const params = cell.transform.params;
      const type = params?.type?.name;
      if (!SPHERE_TYPES.has(type) || cell.state.isHidden || cell.status !== 'ok' || !cell.obj?.data?.sourceData) continue;
      // A hidden ancestor (component or structure) hides the representation too.
      let hidden = false;
      for (let ref = cell.transform.parent; ref && ref !== cell.transform.ref;) {
        const parent = plugin.state.data.cells.get(ref);
        if (!parent) break;
        if (parent.state.isHidden) { hidden = true; break; }
        if (parent.transform.parent === ref) break;
        ref = parent.transform.parent;
      }
      if (hidden) continue;
      const structure = cell.obj.data.sourceData, themes = plugin.representation.structure.themes;
      const colorTheme = themes.colorThemeRegistry.create(params.colorTheme.name, { structure }, params.colorTheme.params);
      const sizeTheme = themes.sizeThemeRegistry.create(params.sizeTheme.name, { structure }, params.sizeTheme.params);
      const props = params.type.params || {};
      out.push({ type, structure, colorTheme, sizeTheme, sizeFactor: props.sizeFactor ?? 1,
        aspect: type === 'spacefill' ? 0 : props.sizeAspectRatio ?? 2 / 3 });
    }
    return out;
  }

  function svg(plugin, { transparent = false } = {}) {
    const canvas3d = plugin?.canvas3d, Element = window.molstar?.lib?.structure?.StructureElement;
    if (!canvas3d || !Element) throw new Error('Vector export needs the 3D view.');
    const representations = shownRepresentations(plugin);
    if (!representations.length) throw new Error('Vector export supports ball-and-stick, licorice and spacefill views.');
    const camera = canvas3d.camera, { width, height } = camera.viewport, view = camera.view;
    const right = [view[0], view[4], view[8]];
    const project = point => { const p = camera.project([0, 0, 0, 0], point); return [p[0], height - p[1], p[2]]; };
    const pixelRadius = (point, center, radius) => {
      const edge = project(point.map((value, axis) => value + right[axis] * radius));
      return Math.hypot(edge[0] - center[0], edge[1] - center[1]);
    };
    const shapes = [], colors = new Set();
    let atomCount = 0, bondCount = 0;
    for (const { type, structure, colorTheme, sizeTheme, sizeFactor, aspect } of representations) {
      const location = Element.Location.create(structure), other = Element.Location.create(structure);
      const atom = new Map();
      // Atoms: projected centre, pixel radius and colour, keyed by unit and element row.
      for (const unit of structure.units) {
        if (unit.kind !== 0) continue;
        location.unit = unit;
        for (let i = 0; i < unit.elements.length; i++) {
          location.element = unit.elements[i];
          const world = [0, 0, 0]; unit.conformation.position(location.element, world);
          const center = project(world), radius = sizeTheme.size(location) * sizeFactor;
          const color = colorTheme.color(location, false);
          colors.add(color);
          const entry = { world, center, radius, color, pixels: pixelRadius(world, center, radius) };
          atom.set(`${unit.id}:${i}`, entry);
          atomCount++;
          shapes.push({ depth: center[2], kind: 'atom', entry, label: `${unit.model.atomicHierarchy.atoms.type_symbol.value(location.element)}${unit.model.atomicHierarchy.atomSourceIndex.value(location.element) + 1}` });
        }
      }
      if (!aspect) continue;
      const addBond = (a, b, order) => {
        if (!a || !b) return;
        const center = a.center.map((value, axis) => (value + b.center[axis]) / 2);
        const radius = Math.min(a.radius, b.radius) * aspect;
        bondCount++;
        shapes.push({ depth: center[2], kind: 'bond', a, b, order, pixels: pixelRadius(a.world, a.center, radius) });
      };
      for (const unit of structure.units) {
        if (unit.kind !== 0) continue;
        const { a, b, edgeProps } = unit.bonds;
        for (let k = 0; k < a.length; k++) if (a[k] < b[k]) addBond(atom.get(`${unit.id}:${a[k]}`), atom.get(`${unit.id}:${b[k]}`), edgeProps.order[k]);
      }
      const seen = new Set();
      for (const edge of structure.interUnitBonds?.edges || []) {
        const ka = `${edge.unitA}:${edge.indexA}`, kb = `${edge.unitB}:${edge.indexB}`, key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        if (seen.has(key)) continue;
        seen.add(key);
        addBond(atom.get(ka), atom.get(kb), edge.props?.order ?? 1);
      }
    }
    // Painter's order: far shapes first; a bond draws before atoms at the same depth.
    shapes.sort((p, q) => q.depth - p.depth || (p.kind === q.kind ? 0 : p.kind === 'bond' ? -1 : 1));
    const background = canvas3d.props?.renderer?.backgroundColor ?? 0xffffff;
    const gradient = color => `a${hex(color).slice(1)}`;
    const lines = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      '<defs>',
      ...[...colors].map(color => `<radialGradient id="${gradient(color)}" cx="0.38" cy="0.35" r="0.7"><stop offset="0" stop-color="${hex(shade(color, 1.35))}"/><stop offset="0.55" stop-color="${hex(color)}"/><stop offset="1" stop-color="${hex(shade(color, 0.6))}"/></radialGradient>`),
      '</defs>',
    ];
    if (!transparent) lines.push(`<rect width="${width}" height="${height}" fill="${hex(background)}"/>`);
    for (const shape of shapes) {
      if (shape.kind === 'atom') {
        const { center, pixels, color } = shape.entry;
        lines.push(`<circle cx="${round(center[0])}" cy="${round(center[1])}" r="${round(pixels)}" fill="url(#${gradient(color)})" stroke="${hex(shade(color, 0.45))}" stroke-width="${round(Math.max(0.5, pixels * 0.04))}"><title>${escape(shape.label)}</title></circle>`);
        continue;
      }
      // A bond: one group with a half in each atom's colour; double and triple
      // bonds as parallel strokes across the screen.
      const { a, b, order, pixels } = shape;
      const dx = b.center[0] - a.center[0], dy = b.center[1] - a.center[1], length = Math.hypot(dx, dy) || 1;
      const strokes = Math.min(Math.max(order | 0, 1), 3), strokeWidth = strokes > 1 ? pixels * 2 / (strokes * 0.9) : pixels * 2;
      const nx = -dy / length * strokeWidth * 1.1, ny = dx / length * strokeWidth * 1.1;
      const middle = [(a.center[0] + b.center[0]) / 2, (a.center[1] + b.center[1]) / 2];
      const parts = [];
      for (let s = 0; s < strokes; s++) {
        const offset = s - (strokes - 1) / 2, ox = nx * offset, oy = ny * offset;
        for (const [from, to, color] of [[a.center, middle, a.color], [middle, b.center, b.color]]) {
          parts.push(`<line x1="${round(from[0] + ox)}" y1="${round(from[1] + oy)}" x2="${round(to[0] + ox)}" y2="${round(to[1] + oy)}" stroke="${hex(color)}" stroke-width="${round(strokeWidth)}"/>`);
        }
      }
      lines.push(`<g class="bond" stroke-linecap="round">${parts.join('')}</g>`);
    }
    lines.push('</svg>', '');
    return { svg: lines.join('\n'), atoms: atomCount, bonds: bondCount };
  }

  // Records the canvas for `seconds`; with `spin` the camera turns once about the
  // screen's vertical axis through the target and returns to where it started.
  async function record(plugin, { seconds, fps, spin }) {
    const canvas = plugin?.canvas3dContext?.canvas, camera = plugin?.canvas3d?.camera;
    if (!canvas || !camera) throw new Error('Recording needs the 3D view.');
    if (!(seconds > 0 && seconds <= MAX_SECONDS)) throw new Error(`Choose a length from 1 to ${MAX_SECONDS} seconds.`);
    if (![12, 24, 25, 30, 50, 60].includes(fps)) throw new Error('Choose a frame rate of 12, 24, 25, 30, 50 or 60.');
    if (typeof MediaRecorder !== 'function' || typeof canvas.captureStream !== 'function') throw new Error('This browser cannot record the 3D view.');
    const type = MOVIE_TYPES.find(candidate => MediaRecorder.isTypeSupported(candidate));
    if (!type) throw new Error('This browser cannot record the 3D view.');
    const stream = canvas.captureStream(fps), recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    const stopped = new Promise((resolve, reject) => { recorder.onstop = resolve; recorder.onerror = event => reject(event.error || new Error('Recording failed.')); });
    const start = camera.getSnapshot();
    const up = [start.up[0], start.up[1], start.up[2]], target = start.target;
    const offset = [0, 1, 2].map(axis => start.position[axis] - target[axis]);
    let frame = 0, began = 0;
    const turn = now => {
      began ||= now;
      const angle = Math.min(1, (now - began) / (seconds * 1000)) * Math.PI * 2;
      // Rodrigues rotation of the eye offset about the up axis.
      const cos = Math.cos(angle), sin = Math.sin(angle), dot = up[0] * offset[0] + up[1] * offset[1] + up[2] * offset[2];
      const cross = [up[1] * offset[2] - up[2] * offset[1], up[2] * offset[0] - up[0] * offset[2], up[0] * offset[1] - up[1] * offset[0]];
      const position = [0, 1, 2].map(axis => target[axis] + offset[axis] * cos + cross[axis] * sin + up[axis] * dot * (1 - cos));
      camera.setState({ ...start, position }, 0);
      plugin.canvas3d.requestDraw?.();
      if (angle < Math.PI * 2) frame = requestAnimationFrame(turn);
    };
    recorder.start(250);
    if (spin) frame = requestAnimationFrame(turn);
    try {
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    } finally {
      if (frame) cancelAnimationFrame(frame);
      if (recorder.state !== 'inactive') recorder.stop();
      stream.getTracks().forEach(track => track.stop());
      if (spin) camera.setState(start, 0);
    }
    await stopped;
    return { blob: new Blob(chunks, { type: type.split(';')[0] }), type: type.split(';')[0] };
  }

  window.BuretteSceneMedia = { svg, record, MAX_SECONDS };
}
