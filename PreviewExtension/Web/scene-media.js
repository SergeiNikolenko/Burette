// Avogadro-style scene media for the 3D view.
// SVG: the shown ball-and-stick, licorice and spacefill representations as flat
// vector shapes, painted back to front from the current camera, with the same
// colour and size themes as the render: one <circle> per atom, one <g> per bond.
// Movie: an MP4 of the canvas at a chosen frame rate (WebCodecs H.264, or
// MediaRecorder where WebCodecs is missing), optionally while the camera spins
// once about the screen's vertical axis; vibrations and trajectories that play
// in the view are recorded as shown.
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
        shapes.push({ depth: center[2], kind: 'bond', a, b, order, radius, pixels: pixelRadius(a.world, a.center, radius) });
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
      const { a, b, order, radius, pixels } = shape;
      const dx = b.center[0] - a.center[0], dy = b.center[1] - a.center[1], length = Math.hypot(dx, dy) || 1;
      const strokes = Math.min(Math.max(order | 0, 1), 3), strokeWidth = strokes > 1 ? pixels * 2 / (strokes * 0.9) : pixels * 2;
      const nx = -dy / length * strokeWidth * 1.1, ny = dx / length * strokeWidth * 1.1;
      const axis = b.world.map((value, i) => value - a.world[i]), span = Math.hypot(...axis);
      const middle = project(a.world.map((value, i) => value + axis[i] / 2));
      const parts = [];
      for (let s = 0; s < strokes; s++) {
        const offset = s - (strokes - 1) / 2, ox = nx * offset, oy = ny * offset;
        // The stroke's half width plus its distance from the bond axis, in Å.
        const lateral = pixels ? (0.5 + Math.abs(offset) * 1.1) * strokeWidth * radius / pixels : 0;
        // Where the stroke leaves the atom's sphere: under its disc, at least half a
        // radius from the centre for strokes wider than the atom, never past the middle.
        const end = (atom, sign) => {
          const along = span ? sign * Math.min(Math.max(Math.sqrt(Math.max(atom.radius ** 2 - lateral ** 2, 0)), atom.radius / 2), span / 2) / span : 0;
          return project(atom.world.map((value, i) => value + axis[i] * along));
        };
        const from = end(a, 1), to = end(b, -1);
        // The first half runs a little past the middle so the halves meet without a seam.
        const lap = Math.min(0.5, Math.hypot(to[0] - middle[0], to[1] - middle[1])) / length;
        for (const [start, stop, color] of [[from, [middle[0] + dx * lap, middle[1] + dy * lap], a.color], [middle, to, b.color]]) {
          parts.push(`<line x1="${round(start[0] + ox)}" y1="${round(start[1] + oy)}" x2="${round(stop[0] + ox)}" y2="${round(stop[1] + oy)}" stroke="${hex(color)}" stroke-width="${round(strokeWidth)}"/>`);
        }
      }
      lines.push(`<g class="bond">${parts.join('')}</g>`);
    }
    lines.push('</svg>', '');
    return { svg: lines.join('\n'), atoms: atomCount, bonds: bondCount };
  }

  // ISO BMFF boxes for one H.264 track with a fixed frame duration.
  const concat = parts => {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) { out.set(part, at); at += part.length; }
    return out;
  };
  const u16 = value => Uint8Array.of(value >> 8 & 255, value & 255);
  const u32 = value => Uint8Array.of(value >>> 24 & 255, value >> 16 & 255, value >> 8 & 255, value & 255);
  const ascii = text => Uint8Array.from(text, ch => ch.charCodeAt(0));
  const box = (type, ...parts) => { const body = concat(parts); return concat([u32(body.length + 8), ascii(type), body]); };
  const fullBox = (type, version, flags, ...parts) => box(type, Uint8Array.of(version, flags >> 16 & 255, flags >> 8 & 255, flags & 255), ...parts);
  const MATRIX = concat([u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000)]);

  function mp4({ width, height, fps, samples, keys, description }) {
    const count = samples.length, milliseconds = Math.round(count * 1000 / fps);
    const ftyp = box('ftyp', ascii('isom'), u32(512), ascii('isomiso2avc1mp41'));
    const moov = chunkOffset => box('moov',
      fullBox('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(milliseconds), u32(0x10000), u16(0x100), new Uint8Array(10), MATRIX, new Uint8Array(24), u32(2)),
      box('trak',
        fullBox('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(milliseconds), new Uint8Array(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(width << 16), u32(height << 16)),
        box('mdia',
          fullBox('mdhd', 0, 0, u32(0), u32(0), u32(fps), u32(count), u16(0x55c4), u16(0)),
          fullBox('hdlr', 0, 0, u32(0), ascii('vide'), new Uint8Array(12), ascii('VideoHandler\0')),
          box('minf',
            fullBox('vmhd', 0, 1, new Uint8Array(8)),
            box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1))),
            box('stbl',
              fullBox('stsd', 0, 0, u32(1), box('avc1', new Uint8Array(6), u16(1), new Uint8Array(16), u16(width), u16(height),
                u32(0x480000), u32(0x480000), u32(0), u16(1), new Uint8Array(32), u16(0x18), u16(0xffff), box('avcC', description))),
              fullBox('stts', 0, 0, u32(1), u32(count), u32(1)),
              fullBox('stss', 0, 0, u32(keys.length), ...keys.map(index => u32(index + 1))),
              fullBox('stsc', 0, 0, u32(1), u32(1), u32(count), u32(1)),
              fullBox('stsz', 0, 0, u32(0), u32(count), ...samples.map(sample => u32(sample.length))),
              fullBox('stco', 0, 0, u32(1), u32(chunkOffset)))))));
    const data = concat(samples), offset = ftyp.length + moov(0).length + 8;
    return new Blob([ftyp, moov(offset), u32(data.length + 8), ascii('mdat'), data], { type: 'video/mp4' });
  }

  // Turns the camera once about the screen's vertical axis through its target.
  function spinner(camera) {
    const start = camera.getSnapshot();
    const up = [start.up[0], start.up[1], start.up[2]], target = start.target;
    const offset = [0, 1, 2].map(axis => start.position[axis] - target[axis]);
    return {
      turn(fraction) {
        // Rodrigues rotation of the eye offset about the up axis.
        const angle = fraction * Math.PI * 2, cos = Math.cos(angle), sin = Math.sin(angle);
        const dot = up[0] * offset[0] + up[1] * offset[1] + up[2] * offset[2];
        const cross = [up[1] * offset[2] - up[2] * offset[1], up[2] * offset[0] - up[0] * offset[2], up[0] * offset[1] - up[1] * offset[0]];
        camera.setState({ ...start, position: [0, 1, 2].map(axis => target[axis] + offset[axis] * cos + cross[axis] * sin + up[axis] * dot * (1 - cos)) }, 0);
      },
      restore() { camera.setState(start, 0); },
    };
  }
  const sleep = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
  const nextFrames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  // WebCodecs H.264 with synthetic timestamps: the movie has exactly
  // `seconds × fps` frames at `fps` however fast the view renders. A spin
  // frame is taken after the view has drawn that angle; "as shown" frames are
  // taken on the wall clock, so a slow view plays back faster than it ran.
  async function encode(plugin, canvas, { seconds, fps, spin }) {
    const width = canvas.width - canvas.width % 2, height = canvas.height - canvas.height % 2;
    const config = { codec: 'avc1.420033', width, height, bitrate: 8_000_000, framerate: fps, avc: { format: 'avc' } };
    if (!(await VideoEncoder.isConfigSupported(config)).supported) return null;
    const samples = [], keys = [];
    let description = null, failure = null;
    const encoder = new VideoEncoder({
      output(chunk, metadata) {
        const source = metadata?.decoderConfig?.description;
        if (source) description = new Uint8Array(ArrayBuffer.isView(source) ? source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) : source.slice(0));
        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        if (chunk.type === 'key') keys.push(samples.length);
        samples.push(bytes);
      },
      error(error) { failure = error; },
    });
    encoder.configure(config);
    const turning = spin ? spinner(plugin.canvas3d.camera) : null, count = Math.round(seconds * fps), began = performance.now();
    try {
      for (let index = 0; index < count && !failure; index++) {
        if (turning) { turning.turn(index / count); plugin.canvas3d.requestDraw?.(); await nextFrames(); }
        else await sleep(began + index * 1000 / fps - performance.now());
        const frame = new VideoFrame(canvas, { timestamp: Math.round(index * 1e6 / fps), duration: Math.round(1e6 / fps), visibleRect: { x: 0, y: 0, width, height } });
        encoder.encode(frame, { keyFrame: index % (fps * 2) === 0 });
        frame.close();
        while (encoder.encodeQueueSize > 4 && !failure) await sleep(5);
      }
      if (!failure) await encoder.flush();
    } finally {
      if (encoder.state !== 'closed') encoder.close();
      turning?.restore();
    }
    if (failure) throw failure;
    if (!description || samples.length !== count) throw new Error('The movie could not be encoded.');
    return { blob: mp4({ width, height, fps, samples, keys, description }), type: 'video/mp4' };
  }

  // Without WebCodecs: MediaRecorder on a 2D copy, timed by the wall clock.
  async function stream(plugin, canvas, { seconds, fps, spin }) {
    const type = typeof MediaRecorder === 'function' ? MOVIE_TYPES.find(candidate => MediaRecorder.isTypeSupported(candidate)) : null;
    if (!type) throw new Error('This browser cannot record the 3D view.');
    const copy = document.createElement('canvas');
    copy.width = canvas.width - canvas.width % 2; copy.height = canvas.height - canvas.height % 2;
    const context = copy.getContext('2d'), media = copy.captureStream(0), track = media.getVideoTracks()[0];
    const recorder = new MediaRecorder(media, { mimeType: type, videoBitsPerSecond: 8_000_000 }), chunks = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    const stopped = new Promise((resolve, reject) => { recorder.onstop = resolve; recorder.onerror = event => reject(event.error || new Error('Recording failed.')); });
    const turning = spin ? spinner(plugin.canvas3d.camera) : null, count = Math.round(seconds * fps), began = performance.now();
    recorder.start(250);
    try {
      for (let index = 0; index < count; index++) {
        turning?.turn(index / count);
        await sleep(began + index * 1000 / fps - performance.now());
        context.drawImage(canvas, 0, 0, copy.width, copy.height);
        track.requestFrame?.();
      }
    } finally {
      if (recorder.state !== 'inactive') recorder.stop();
      media.getTracks().forEach(item => item.stop());
      turning?.restore();
    }
    await stopped;
    return { blob: new Blob(chunks, { type: type.split(';')[0] }), type: type.split(';')[0] };
  }

  async function record(plugin, settings) {
    const canvas = plugin?.canvas3dContext?.canvas;
    if (!canvas || !plugin.canvas3d?.camera) throw new Error('Recording needs the 3D view.');
    if (!(settings.seconds > 0 && settings.seconds <= MAX_SECONDS)) throw new Error(`Choose a length from 1 to ${MAX_SECONDS} seconds.`);
    if (![12, 24, 25, 30, 50, 60].includes(settings.fps)) throw new Error('Choose a frame rate of 12, 24, 25, 30, 50 or 60.');
    const encoded = typeof VideoEncoder === 'function' && typeof VideoFrame === 'function' ? await encode(plugin, canvas, settings) : null;
    return encoded ?? stream(plugin, canvas, settings);
  }

  window.BuretteSceneMedia = { svg, record, MAX_SECONDS };
}
