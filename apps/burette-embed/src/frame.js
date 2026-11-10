// Runs inside the embed iframe. It boots Burette's own viewer runtime (the same
// scripts and config the desktop app uses) for one scene, and talks to the host
// page only through the burette-embed message protocol in README.md.
(() => {
  'use strict';

  // Replaced by scripts/build.mjs: runtime file hashes and Burette's viewer defaults.
  const MANIFEST = __BURETTE_EMBED_MANIFEST__;
  const DEFAULTS = __BURETTE_EMBED_DEFAULTS__;

  const STRUCTURE_FORMATS = {
    pdb: 'pdb', ent: 'pdb', cif: 'mmcif', mmcif: 'mmcif', mcif: 'mmcif', bcif: 'bcif',
    sdf: 'sdf', sd: 'sdf', mol: 'mol', mol2: 'mol2', pdbqt: 'pdbqt', xyz: 'xyz', gro: 'gro'
  };
  const POSE_FORMATS = new Set(['sdf', 'mol', 'mol2', 'pdbqt']);
  const MAX_SCENE_BYTES = 100 * 1024 * 1024;
  // Same order as the desktop viewer document (browser-dev-documents.ts viewerHtml).
  const RUNTIME_SCRIPTS = [
    'molstar.js', 'burette-agent.js', 'trajectory-smoothing.js', 'molstar-preset-preview-controller.js',
    'superposition-panel.js', 'molecule-preview-interactions.js', 'renderer-view-state.js', 'color-picker.js',
    'sequence-panel.js', 'native-viewer-menus.js', 'scene-file-actions.js', 'svg-sanitizer.js', 'viewer.js'
  ];

  let hostOrigin = null;
  let opened = false;
  let ready = false;
  let lastPose;
  let poseMode = 'single';
  let docking = false;
  let sdfPosePager = false;
  let resolveRender;
  let rejectRender;
  let commandsInOrder = Promise.resolve();
  let appearance = {};

  function themeTokens(value = {}) {
    document.documentElement.lang = typeof value.locale === 'string' && /^[a-z]{2}(?:-[A-Za-z0-9]+)*$/.test(value.locale) ? value.locale : 'en';
    const valid = { locale: document.documentElement.lang };
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    for (const key of ['background', 'foreground', 'accent', 'uiFont']) {
      const text = value[key];
      if (typeof text !== 'string' || text.length > 256 || !CSS.supports(key === 'uiFont' ? 'font-family' : 'color', text)) continue;
      if (key === 'uiFont') {
        valid[key] = text;
        continue;
      }
      // The native theme resolver consumes sRGB hex, while host CSS may use
      // rgb(), oklch() or named colours. Resolve those in the browser once.
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = text;
      context.fillRect(0, 0, 1, 1);
      const rgba = context.getImageData(0, 0, 1, 1).data;
      if (rgba[3] === 255) valid[key] = '#' + Array.from(rgba.subarray(0, 3), byte => byte.toString(16).padStart(2, '0')).join('');
    }
    appearance = valid;
    if (valid.background) {
      for (const mode of ['light', 'dark']) document.documentElement.style.setProperty(`--burette-embed-background-${mode}`, valid.background);
    } else {
      for (const mode of ['light', 'dark']) document.documentElement.style.removeProperty(`--burette-embed-background-${mode}`);
    }
    return Object.fromEntries(['light', 'dark'].map(mode => [mode, { ...DEFAULTS.themeTokens[mode], ...valid, preserveColors: true }]));
  }

  function setBackground(theme) {
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.buretteTheme = theme;
    else delete document.documentElement.dataset.buretteTheme;
  }
  setBackground(new URLSearchParams(location.search).get('theme'));

  const versioned = name => `${name}?v=${MANIFEST.files[name]?.slice(0, 12) || MANIFEST.version}`;
  const toHost = message => {
    window.parent.postMessage({ source: 'burette-embed', ...message }, hostOrigin && hostOrigin !== 'null' ? hostOrigin : '*');
  };

  function resolveScript(name) {
    return window.BuretteResolveRuntimeAsset
      ? window.BuretteResolveRuntimeAsset(name) : versioned(name);
  }

  function loadScript(name, source) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = source;
      script.async = false;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Could not load ${name}`));
      document.body.append(script);
    });
  }

  function jsonElement(id, value) {
    const element = document.createElement('script');
    element.id = id;
    element.type = 'application/json';
    element.textContent = JSON.stringify(value).replaceAll('<', '\\u003c');
    document.head.append(element);
  }

  function base64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }

  function readFile(file, role, formats) {
    if (!file || typeof file !== 'object') throw new Error(`The ${role} file is missing.`);
    const name = String(file.name || role).slice(0, 255);
    const extension = String(file.format || name.split('.').pop() || '').toLowerCase();
    const format = Object.hasOwn(STRUCTURE_FORMATS, extension) ? STRUCTURE_FORMATS[extension] : null;
    if (!format || (formats && !formats.has(format))) throw new Error(`${name}: unsupported ${role} format.`);
    const bytes = file.data instanceof ArrayBuffer ? new Uint8Array(file.data)
      : ArrayBuffer.isView(file.data) ? new Uint8Array(file.data.buffer, file.data.byteOffset, file.data.byteLength) : null;
    if (!bytes?.length) throw new Error(`${name} is empty.`);
    return { name, format, binary: format === 'bcif', bytes };
  }

  function source(file) {
    return { path: file.name, label: file.name, extension: file.format, format: file.format, binary: file.binary, byteCount: file.bytes.length };
  }

  function viewerConfig(scene, structure, poses) {
    const theme = ['light', 'dark', 'auto'].includes(scene.theme) ? scene.theme : 'auto';
    const byteCount = structure.bytes.length + (poses?.bytes.length || 0);
    const config = {
      format: structure.format,
      molstarFormat: structure.format,
      binary: structure.binary,
      renderer: 'molstar',
      requestedRenderer: 'molstar',
      allowMolstarFallback: false,
      label: poses ? `${structure.name} + ${poses.name}` : structure.name,
      byteCount,
      previewByteCount: byteCount,
      quickLookBuild: 'burette-embed',
      debug: false,
      theme,
      themeTokens: themeTokens(scene.appearance),
      viewerDefaults: DEFAULTS.viewerDefaults,
      canvasBackground: DEFAULTS.canvasBackground,
      documentId: `embed-${Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16)).join("-")}`,
      uiScale: 0.9,
      overlayOpacity: 0.9,
      transparentBackground: false,
      sdfGrid: false,
      sdfPoseModeStorageKey: 'burette.embed.poseMode',
      sdfPosePager: !poses && structure.format === 'sdf',
      // Context menus and messages stay inside the frame: no native menu host.
      appViewer: false,
      tauriViewer: false,
      visualizationOnly: true,
      ketcherEditable: false,
      pubChemSearch: false,
      molstarStyle: DEFAULTS.molstarStyle,
      waterRepresentation: 'line',
      xyzrenderViewer: false,
      xyzrenderAvailable: false,
      molstarAvailable: true,
      canOpenInVesta: false,
      showPanelControls: true,
      defaultLayoutState: { left: 'hidden', right: 'hidden', top: 'hidden', bottom: 'hidden' }
    };
    if (poses) {
      const activePose = Number.isInteger(scene.activePose) && scene.activePose >= 0 ? scene.activePose : null;
      config.docking = { activePose, sceneMode: null, receptor: source(structure), ligands: [source(poses)] };
    }
    return config;
  }

  function publishPose(index, sourceRecordId, count, mode) {
    if (lastPose?.index === index && lastPose.sourceRecordId === sourceRecordId
      && lastPose.count === count && lastPose.mode === mode) return;
    lastPose = { type: 'pose', index, sourceRecordId, count, mode };
    toHost(lastPose);
  }

  function onViewerMessage(body) {
    if (!body || typeof body !== 'object') return;
    if (body.type === 'status' && String(body.message || '').startsWith('[web] Rendered ') && !ready) {
      ready = true;
      resolveRender();
    } else if (body.type === 'error') {
      const message = String(body.message || 'The structure could not be shown.').replace(/^\[web\]\s*/u, '').slice(0, 2000);
      if (!ready) rejectRender(new Error(message));
      else toHost({ type: 'error', message });
    } else if (body.type === 'dockingPoseChanged') {
      publishPose(body.activePose, body.sourceRecordId, body.poseCount, body.poseMode);
    } else if (body.type === 'trajectoryFrameChanged' && sdfPosePager) {
      // Standalone SDF controls report the original record as a frame index.
      publishPose(body.globalFrameIndex, body.globalFrameIndex, body.frameCount, poseMode);
    } else if (body.type === 'structureOverlayModeChanged') {
      poseMode = body.mode;
      if (lastPose) publishPose(lastPose.index, lastPose.sourceRecordId, lastPose.count, poseMode);
    } else if (body.type === 'selectionChanged') {
      toHost({ type: 'selection', selection: body.selection ?? null });
    } else if (body.type === 'exportText' || body.type === 'exportData') {
      toHost({ type: 'export', name: String(body.name || 'structure'), mimeType: String(body.mimeType || ''), text: body.text, base64: body.base64 });
    }
  }

  async function open(scene) {
    if (opened) throw new Error('This frame already shows a scene; reload it to open another.');
    opened = true;
    const structure = readFile(scene.structure, 'structure');
    const poses = scene.poses ? readFile(scene.poses, 'poses', POSE_FORMATS) : null;
    docking = !!poses;
    if (structure.bytes.length + (poses?.bytes.length || 0) > MAX_SCENE_BYTES) throw new Error('The scene is larger than 100 MB.');
    const config = viewerConfig(scene, structure, poses);
    sdfPosePager = config.sdfPosePager;
    setBackground(config.theme);
    jsonElement('burette-runtime-config', config);
    jsonElement('burette-runtime-data', poses ? base64(new Uint8Array([10])) : base64(structure.bytes));
    if (poses) {
      window.BuretteDockingPayloads = {
        receptor: { dataBase64: base64(structure.bytes) },
        ligands: [{ dataBase64: base64(poses.bytes) }]
      };
    }
    // The viewer reports to a native host when one is present; this frame is that host.
    Object.defineProperty(window, 'webkit', {
      configurable: true,
      value: { messageHandlers: { burette: { postMessage: onViewerMessage } } }
    });
    window.BuretteRDKitJSURL = versioned('rdkit/RDKit_minimal.js');
    window.BuretteRDKitWasmURL = versioned('rdkit/RDKit_minimal.wasm');
    await loadScript('viewer-shell.js', await resolveScript('viewer-shell.js'));
    await loadScript('viewer-bootstrap.js', await resolveScript('viewer-bootstrap.js'));
    window.__mqlPost = (type, message, payload) => onViewerMessage({ type, message: message || '', ...(payload || {}) });
    const rendered = new Promise((resolve, reject) => {
      resolveRender = resolve;
      rejectRender = reject;
    });
    // Asset resolution can finish out of order in an MCP host. Resolve in
    // parallel first, then insert scripts in their required execution order.
    const sources = await Promise.all(RUNTIME_SCRIPTS.map(resolveScript));
    await Promise.all([rendered, ...RUNTIME_SCRIPTS.map((name, index) => loadScript(name, sources[index]))]);
  }

  async function run(action) {
    if (!ready) throw new Error('The scene is still loading.');
    const response = await window.BuretteViewerActions.run(action);
    if (response?.ok === false) throw new Error(response.error?.message || response.message || `${action.type} failed.`);
    return response?.result ?? null;
  }

  const commands = {
    open: message => open(message.scene || {}),
    setTheme: ({ theme }) => {
      if (!['light', 'dark', 'auto'].includes(theme)) throw new TypeError('Unknown viewer theme.');
      setBackground(theme);
      window.dispatchEvent(new MessageEvent('message', {
        source: window.parent,
        origin: hostOrigin,
        data: { source: 'burette-host', body: { type: 'setViewerTheme', value: theme, themeTokens: themeTokens(appearance) } }
      }));
    },
    setAppearance: ({ appearance: next }) => {
      const tokens = themeTokens(next);
      window.dispatchEvent(new MessageEvent('message', {
        source: window.parent,
        origin: hostOrigin,
        data: { source: 'burette-host', body: { type: 'setViewerTheme', value: window.BuretteConfig.theme, themeTokens: tokens } }
      }));
    },
    setPose: ({ index, sourceRecordId }) => {
      const value = sourceRecordId ?? index;
      if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('The pose must be a non-negative integer.');
      return run({ type: 'set_sdf_pose_index', index, sourceRecordId });
    },
    setPoseMode: ({ mode }) => {
      if (mode !== 'all' && mode !== 'single') throw new TypeError('Unknown pose mode.');
      return run({ type: 'set_sdf_pose_mode', mode });
    },
    focusLigand: () => run({ type: 'focus_ligand', dockingPose: docking }),
    resetCamera: () => run({ type: 'reset_camera' }),
    capture: async ({ width, height, format = 'png', axes, transparent }) => {
      if (!['png', 'jpeg', 'webp'].includes(format)) throw new TypeError('Unknown screenshot format.');
      if ((width !== undefined || height !== undefined)
        && ![width, height].every(value => Number.isInteger(value) && value > 0 && value <= 4096)) {
        throw new RangeError('Both screenshot dimensions must be between 1 and 4096.');
      }
      const result = await run({ type: 'screenshot', args: { width, height, format, axes: typeof axes === 'boolean' ? axes : undefined, transparent: typeof transparent === 'boolean' ? transparent : undefined } });
      if (!result?.dataUri) throw new Error('The viewer did not produce an image.');
      return { dataUri: result.dataUri, width: result.width, height: result.height };
    }
  };

  // The shared runtime also understands desktop bridges. Keep external messages
  // on this API, and only let this frame's own translated theme event reach it.
  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source === window) return; // The renderer schedules work with self-messages.
    if (!event.isTrusted && event.source === window.parent && message?.source === 'burette-host'
      && message.body?.type === 'setViewerTheme') return;
    event.stopImmediatePropagation();
    if (event.source !== window.parent || message?.source !== 'burette-embed-host') return;
    if (hostOrigin && event.origin !== hostOrigin) return;
    if (!Object.hasOwn(commands, message.type) || typeof message.id !== 'string') return;
    hostOrigin = event.origin;
    commandsInOrder = commandsInOrder.then(async () => {
      try {
        const result = await commands[message.type](message);
        toHost({ type: 'result', id: message.id, ok: true, result });
      } catch (error) {
        toHost({ type: 'result', id: message.id, ok: false, error: String(error?.message || error).slice(0, 2000) });
      }
    });
  }, { capture: true });

  toHost({ type: 'frame-ready', version: MANIFEST.version });
})();
