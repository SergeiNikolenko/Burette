// Runs inside the embed iframe. It boots Burette's own viewer runtime (the same
// scripts and config the desktop app uses) for one scene, and talks to the host
// page only through the burette-embed message protocol in README.md.
(() => {
  'use strict';

  // Replaced by scripts/build.mjs: runtime file hashes and Burette's viewer defaults.
  const MANIFEST = {"version":"96925282c237","files":{"viewer-runtime.css":"a625befafd969da5d7de1125661c06c69731e38ce316c74f84e07d896e7b4bff","molstar.css":"bef46e4da8a4f4798bc7812b8e39f34d91ea5556dd91b8813522f409af421c3f","viewer-shell.js":"8ae219770eb803168ee9f3b538784fde9096c245585cb788c964ed0cc2c53f88","viewer-bootstrap.js":"e93c2c98104f10ac7a69930e1a48781f95da802fdb96f248c09947af01128c56","molstar.js":"9c1384940952024d50c89455033c91221fc83a411578aadd0e11211a155a0330","burette-agent.js":"f10b4bc80a127fbc4897acb8cf0424f8068a552d5d2a7e0afff8a5168e8c1931","trajectory-smoothing.js":"6ccd7883bb66a3ff96973c03c67746b3b646239374ee7684762441b422181048","molstar-preset-preview-controller.js":"5fdc0296ae5d2e678b4dc5b0a0fc19a6b9c27d2088d8a46168fe9f0ee56e5b1e","superposition-panel.js":"551afabf108a6b26fc18ef3e9ed3ef42675126b7429f93268171dc6d68f6b793","molecule-preview-interactions.js":"5b891b45c9a60cc196a243aaaf2965b768cfb26cd7a63056375ee440cba5ae9e","renderer-view-state.js":"97cb02ee8efbcaa1d57a2275c9c5e05943cf5e57649563c67b9b82cf886ecc41","color-picker.js":"2f117fda2171d55f79512982aa5458390485a324805371dd445e73709aff5732","sequence-panel.js":"2d0728cb8320fe176eb37739520d96d1dbf5cac927923fa017b6a54cbfdcda55","native-viewer-menus.js":"5add1be94da9fe34965e01549c551be89fe4607d70a5198aed8acfdb6b75f320","scene-file-actions.js":"25f361758d92d6b35059db68b26209dff0bc6b09d2816ec73203804bc345c7e0","sdf-collection-scene.js":"d92e6071668370e45fe2c279e4bddf098c696b76257adf9f947e66f6099056ab","svg-sanitizer.js":"fada3acccd5943a6e5e7cc5394e6d13133aa117414c9e485aa82cb0c8c84b520","svg-sanitizer.LICENSE":"cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30","viewer.js":"608809f60aff24e9824a27b22f59cc432a6ba14e9877e64aafe979e06b395c45","rdkit/RDKit_minimal.js":"339ec5a6031f2e0e3f04bcad3ee7991a9f9ae18f8926c1f8a6e19cc06a3daf1b","rdkit/RDKit_minimal.wasm":"f5981af4cf5bdcef861ffdf7410330bf9887f1195e39fbf9901b3a2f134ace2e","rdkit/LICENSE":"01c94cf021015183787810769b8006d0575e96e727b9533d6caffd2be58ea6f1"}};
  const DEFAULTS = {"molstarStyle":"illustrative","canvasBackground":"auto","themeTokens":{"light":{"accent":"#339cff","background":"#ffffff","foreground":"#1a1c1f","uiFont":"-apple-system-body, ui-sans-serif, -apple-system, system-ui, \"Segoe UI\", Helvetica, \"Apple Color Emoji\", Arial, sans-serif, \"Segoe UI Emoji\", \"Segoe UI Symbol\"","editorFont":"-apple-system-body, ui-sans-serif, -apple-system, system-ui, \"Segoe UI\", Helvetica, \"Apple Color Emoji\", Arial, sans-serif, \"Segoe UI Emoji\", \"Segoe UI Symbol\"","translucent":30,"contrast":45},"dark":{"accent":"#339cff","background":"#181818","foreground":"#ffffff","uiFont":"-apple-system-body, ui-sans-serif, -apple-system, system-ui, \"Segoe UI\", Helvetica, \"Apple Color Emoji\", Arial, sans-serif, \"Segoe UI Emoji\", \"Segoe UI Symbol\"","editorFont":"-apple-system-body, ui-sans-serif, -apple-system, system-ui, \"Segoe UI\", Helvetica, \"Apple Color Emoji\", Arial, sans-serif, \"Segoe UI Emoji\", \"Segoe UI Symbol\"","translucent":20,"contrast":60}},"viewerDefaults":{"screenshotResolution":"viewport","screenshotFormat":"png","screenshotTransparent":false,"gridViewMode":"cards","gridCardRenderer":"rdkit","gridCardSize":0,"hydrogenDisplay":"none"}};

  const STRUCTURE_FORMATS = {
    pdb: 'pdb', ent: 'pdb', cif: 'mmcif', mmcif: 'mmcif', mcif: 'mmcif', bcif: 'bcif',
    sdf: 'sdf', sd: 'sdf', mol: 'mol', mol2: 'mol2', pdbqt: 'pdbqt', xyz: 'xyz', gro: 'gro'
  };
  const POSE_FORMATS = new Set(['sdf', 'mol', 'mol2', 'pdbqt']);
  // Coordinate-only trajectories replayed over the structure file as topology.
  const TRAJECTORY_FORMATS = {
    xtc: 'xtc', trr: 'trr', dcd: 'dcd', nc: 'nctraj', ncdf: 'nctraj', nctraj: 'nctraj', lammpstrj: 'lammpstrj'
  };
  const TEXT_TRAJECTORY_FORMATS = new Set(['lammpstrj']);
  const TOPOLOGY_FORMATS = new Set(['pdb', 'mmcif', 'gro', 'pdbqt']);
  const MAX_SCENE_FILES = 64;
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
  let posePaging = false;
  let sdfPosePager = false;
  let smoothingView = null;
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

  function readFile(file, role, formats, table = STRUCTURE_FORMATS) {
    if (!file || typeof file !== 'object') throw new Error(`The ${role} file is missing.`);
    const name = String(file.name || role).slice(0, 255);
    const extension = String(file.format || name.split('.').pop() || '').toLowerCase();
    const format = Object.hasOwn(table, extension) ? table[extension] : null;
    if (!format || (formats && !formats.has(format))) throw new Error(`${name}: unsupported ${role} format.`);
    const bytes = file.data instanceof ArrayBuffer ? new Uint8Array(file.data)
      : ArrayBuffer.isView(file.data) ? new Uint8Array(file.data.buffer, file.data.byteOffset, file.data.byteLength) : null;
    if (!bytes?.length) throw new Error(`${name} is empty.`);
    const binary = format === 'bcif' || (table === TRAJECTORY_FORMATS && !TEXT_TRAJECTORY_FORMATS.has(format));
    return { name, format, binary, bytes };
  }

  // The viewer reports a pose's file by name, so names within one scene must differ.
  function readFiles(files, role, formats, table) {
    const list = files == null ? [] : Array.isArray(files) ? files : [files];
    if (list.length > MAX_SCENE_FILES) throw new Error(`A scene accepts at most ${MAX_SCENE_FILES} ${role} files.`);
    const seen = new Set();
    return list.map(file => {
      const entry = readFile(file, role, formats, table);
      for (let copy = 2; seen.has(entry.name); copy += 1) entry.name = `${entry.name.replace(/ \(\d+\)$/u, '')} (${copy})`;
      seen.add(entry.name);
      return entry;
    });
  }

  function source(file) {
    return { path: file.name, label: file.name, extension: file.format, format: file.format, binary: file.binary, byteCount: file.bytes.length };
  }

  // `kind` is what `ligands` holds: 'poses', 'trajectory' or 'structures'.
  function viewerConfig(scene, structure, ligands, kind) {
    const theme = ['light', 'dark', 'auto'].includes(scene.theme) ? scene.theme : 'auto';
    const byteCount = [structure, ...ligands].reduce((total, file) => total + file.bytes.length, 0);
    const config = {
      format: structure.format,
      molstarFormat: structure.format,
      binary: structure.binary,
      renderer: 'molstar',
      requestedRenderer: 'molstar',
      allowMolstarFallback: false,
      label: ligands.length ? [structure, ...ligands].map(file => file.name).join(' + ') : structure.name,
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
      sdfPosePager: !ligands.length && structure.format === 'sdf',
      // No desktop Info panel here: Smooth runs in the viewer for PDB and XYZ frames.
      trajectorySmoothing: 'in-viewer',
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
    if (ligands.length) {
      const activePose = kind !== 'trajectory' && Number.isInteger(scene.activePose) && scene.activePose >= 0 ? scene.activePose : null;
      // Equal structures form Burette's Together scene; poses keep the docking view.
      const sceneMode = kind === 'structures' ? 'structureAll' : null;
      config.docking = { activePose, sceneMode, receptor: source(structure), ligands: ligands.map(source) };
    }
    return config;
  }

  function publishPose(index, sourceRecordId, count, mode, file = 0) {
    if (lastPose?.index === index && lastPose.sourceRecordId === sourceRecordId
      && lastPose.count === count && lastPose.mode === mode && lastPose.file === file) return;
    lastPose = { type: 'pose', index, sourceRecordId, count, mode, file };
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
      publishPose(body.activePose, body.sourceRecordId, body.poseCount, body.poseMode, body.ligandIndex ?? 0);
    } else if (body.type === 'trajectoryFrameChanged' && sdfPosePager) {
      // Standalone SDF controls report the original record as a frame index.
      publishPose(body.globalFrameIndex, body.globalFrameIndex, body.frameCount, poseMode);
    } else if (body.type === 'trajectoryFrameChanged' && !posePaging) {
      // Pose and structure paging reuses the frame controls; it reports as `pose` only.
      toHost({
        type: 'frame', index: body.globalFrameIndex, playing: body.playing === true,
        segment: { start: body.segmentStartFrame, count: body.frameCount }
      });
    } else if (body.type === 'trajectorySmoothingChanged') {
      smoothingView = body.view === 'smoothed' ? 'smoothed' : 'original';
      toHost({ type: 'smoothing', view: smoothingView });
    } else if (body.type === 'structureOverlayModeChanged') {
      poseMode = body.mode;
      if (lastPose) publishPose(lastPose.index, lastPose.sourceRecordId, lastPose.count, poseMode, lastPose.file);
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
    const poses = readFiles(scene.poses, 'poses', POSE_FORMATS);
    const trajectory = readFiles(scene.trajectory, 'trajectory', null, TRAJECTORY_FORMATS);
    const structures = readFiles(scene.structures, 'structures');
    if ([poses, trajectory, structures].filter(list => list.length).length > 1) {
      throw new Error('A scene takes docking poses, a trajectory or more structures, not a combination.');
    }
    if (trajectory.length && !TOPOLOGY_FORMATS.has(structure.format)) {
      throw new Error(`${structure.name}: a trajectory needs a PDB, mmCIF, GRO or PDBQT topology.`);
    }
    if (trajectory.length > 1 && trajectory.some(file => file.format !== 'xtc')) {
      throw new Error('Several trajectory segments must all be XTC files.');
    }
    const kind = trajectory.length ? 'trajectory' : structures.length ? 'structures' : 'poses';
    const ligands = { trajectory, structures, poses }[kind];
    docking = poses.length > 0;
    posePaging = kind !== 'trajectory' && ligands.length > 0;
    if ([structure, ...ligands].reduce((total, file) => total + file.bytes.length, 0) > MAX_SCENE_BYTES) {
      throw new Error('The scene is larger than 100 MB.');
    }
    const config = viewerConfig(scene, structure, ligands, kind);
    sdfPosePager = config.sdfPosePager;
    setBackground(config.theme);
    jsonElement('burette-runtime-config', config);
    jsonElement('burette-runtime-data', ligands.length ? base64(new Uint8Array([10])) : base64(structure.bytes));
    if (ligands.length) {
      window.BuretteDockingPayloads = {
        receptor: { dataBase64: base64(structure.bytes) },
        ligands: ligands.map(file => ({ dataBase64: base64(file.bytes) }))
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
    // The viewer starts a scene on one structure; the desktop app switches it the same way.
    if (kind === 'structures') await run({ type: 'set_sdf_pose_mode', mode: 'all' });
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
    setPose: ({ index, sourceRecordId, file }) => {
      const value = sourceRecordId ?? index;
      if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('The pose must be a non-negative integer.');
      if (file !== undefined && (!Number.isSafeInteger(file) || file < 0)) throw new RangeError('The pose file must be a non-negative integer.');
      return run({ type: 'set_sdf_pose_index', index, sourceRecordId, ligandIndex: sourceRecordId == null ? undefined : file ?? 0, keepPoseMode: true });
    },
    setFrame: ({ index }) => {
      if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('The frame must be a non-negative integer.');
      return run({ type: 'set_structure_pose', index });
    },
    setPlayback: ({ playing }) => run({ type: 'set_trajectory_playback', playing: playing === true }),
    setSmoothing: async ({ on }) => {
      if (on === (smoothingView === 'smoothed')) return { view: smoothingView ?? 'original' };
      if (on && !smoothingView) await run({ type: 'apply_trajectory_smoothing' });
      else await run({ type: 'set_trajectory_smoothing_view', view: on ? 'smoothed' : 'original' });
      return { view: on ? 'smoothed' : 'original' };
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
