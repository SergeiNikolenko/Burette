(() => {
  'use strict';

  const root = document.getElementById('app');
  const status = document.getElementById('status');
  const CARD_MIN_STORAGE_KEY = 'buret.grid.cardMin';
  const CARD_RENDERER_OPTIONS = ['rdkit', 'xyzrender'];
  const MIN_CARD_MIN = 86;
  const MAX_CARD_MIN = 360;
  const DEFAULT_CARD_MIN = 174;
  const RDKIT_SVG_SIZE = 260;
  const SVG_FIT_MIN_PADDING = 12;
  const SVG_FIT_PADDING_FRACTION = 0.08;
  const SVG_FIT_BOTTOM_PADDING_MULTIPLIER = 1.7;
  const SVG_FIT_VERTICAL_BIAS_FRACTION = 0.08;
  const XYZRENDER_CARD_CONCURRENCY = 4;
  const DEFAULT_XYZRENDER_PRESETS = [
    { value: 'default', label: 'Default' },
    { value: 'flat', label: 'Flat' },
    { value: 'paton', label: 'Paton' },
    { value: 'pmol', label: 'PMol' },
    { value: 'skeletal', label: 'Skeletal' },
    { value: 'bubble', label: 'Bubble' },
    { value: 'tube', label: 'Tube' },
    { value: 'btube', label: 'BTube' },
    { value: 'mtube', label: 'MTube' },
    { value: 'wire', label: 'Wire' },
    { value: 'graph', label: 'Graph' },
    { value: 'custom', label: 'Custom JSON' }
  ];
  const DEFAULT_XYZRENDER_CONTROLS = {
    transparentBackground: true,
    gradients: null,
    fog: null,
    showVdw: null,
    hideBonds: null,
    atomScale: null,
    bondWidth: null,
    molColor: '',
    showCell: null,
    showGhosts: null,
    showAxes: null,
    supercell: null
  };
  const state = {
    rdkit: null,
    all: Array.isArray(window.BurreteGridRecords) ? window.BurreteGridRecords : [],
    rows: [],
    totalRows: 0,
    visibleCount: 0,
    renderedCount: 0,
    query: '',
    smarts: '',
    smartsError: '',
    smartsMatches: new Map(),
    sort: 'index',
    showProperties: false,
    cardRenderer: 'rdkit',
    cardMin: storedOptionalInteger(CARD_MIN_STORAGE_KEY, MIN_CARD_MIN, MAX_CARD_MIN),
    xyzrenderPreset: 'default',
    xyzrenderControls: { ...DEFAULT_XYZRENDER_CONTROLS },
    selected: new Set(),
    selectionAnchorIndex: null,
    selectionKeydownHandler: null,
    svgCache: new Map(),
    molblockCache: new Map(),
    xyzrenderCardCache: new Map(),
    xyzrenderCardRequests: new Map(),
    xyzrenderCardQueue: [],
    xyzrenderCardActive: 0,
    hostRequests: new Map(),
    remoteMode: false,
    remoteLoading: false,
    requestSeq: 0,
    token: 0,
    rendering: false,
    pendingLoad: false,
    loadObserver: null,
    scrollHandler: null
  };

  function post(type, message, payload = {}) {
    try {
      if (window.__mqlPost) window.__mqlPost(type, message || '', payload);
      else {
        const body = { type, message: String(message || ''), ...payload };
        if (window.BurreteConfig && window.BurreteConfig.previewRequestID) {
          body.requestID = String(window.BurreteConfig.previewRequestID);
        }
        if (window.BurreteConfig && window.BurreteConfig.documentId) {
          body.documentId = String(window.BurreteConfig.documentId);
        }
        window.parent?.postMessage({ source: 'burrete-grid', body }, '*');
        window.webkit?.messageHandlers?.burrete?.postMessage(body);
      }
    } catch (_) {}
  }

  function setStatus(message, kind = 'info') {
    const cfg = window.BurreteConfig && typeof window.BurreteConfig === 'object' ? window.BurreteConfig : {};
    if (status) {
      status.textContent = String(message || '');
      status.classList.toggle('error', kind === 'error');
      status.classList.toggle('hidden', kind !== 'error' && !window.BurreteDebug);
      if (kind === 'error' && status && !window.BurreteDebug && cfg.appViewer === true) status.classList.add('hidden');
    }
    if (kind === 'error' || window.BurreteDebug) post(kind === 'error' ? 'error' : 'status', message || '');
  }

  function config() {
    if (!window.BurreteConfig || typeof window.BurreteConfig !== 'object') {
      throw new Error('preview-config.js did not define window.BurreteConfig.');
    }
    return window.BurreteConfig;
  }

  function capabilities(cfg) {
    const caps = cfg.capabilities || {};
    return {
      selection: !!caps.selection,
      export: !!caps.export,
      substructureSearch: !!caps.substructureSearch,
      rendererSwitch: cfg.appViewer === true && !!caps.rendererSwitch,
      xyzrenderCards: cfg.appViewer === true && !!caps.xyzrenderCards && !!cfg.xyzrenderEndpoint
    };
  }

  function isRemoteMode(cfg) {
    return cfg.appViewer === true && cfg.gridDataMode === 'bridge' && !Array.isArray(window.BurreteGridRecords);
  }

  function installHostMessageListener() {
    window.addEventListener('message', event => {
      const data = event.data;
      if (!data || data.source !== 'burrete-grid-host') return;
      const body = data.body || {};
      const requestId = String(body.requestId || '');
      if (!requestId || !state.hostRequests.has(requestId)) return;
      const pending = state.hostRequests.get(requestId);
      state.hostRequests.delete(requestId);
      try { clearTimeout(pending.timeoutId); } catch (_) {}
      if (body.type === 'gridPage') pending.resolve(body.result || {});
      else pending.reject(new Error(body.error || 'Grid host request failed.'));
    });
  }

  function hostRequest(type, payload = {}) {
    return new Promise((resolve, reject) => {
      const cfg = config();
      const requestId = `grid-${++state.requestSeq}`;
      const timeoutId = window.setTimeout(() => {
        state.hostRequests.delete(requestId);
        reject(new Error('Grid host request timed out.'));
      }, 15000);
      state.hostRequests.set(requestId, { resolve, reject, timeoutId });
      post(type, `[grid] ${type}`, {
        requestId,
        documentId: cfg.documentId,
        ...payload
      });
    });
  }

  async function initRDKit() {
    if (state.rdkit) return state.rdkit;
    if (typeof window.initRDKitModule !== 'function') {
      throw new Error('RDKit_minimal.js is missing. Run bun run vendor:rdkit and rebuild.');
    }
    setStatus('[grid] Loading RDKit.js...');
    const cfg = config();
    const wasmPath = cfg.rdkitWasmPath || '../assets/rdkit/RDKit_minimal.wasm';
    const options = { locateFile: () => wasmPath };
    if (window.BurreteRDKitWasmBase64) {
      options.wasmBinary = base64ToBytes(window.BurreteRDKitWasmBase64);
      window.BurreteRDKitWasmBase64 = '';
    } else if (wasmPath) {
      options.wasmBinary = await loadWasmBinary(wasmPath);
    }
    state.rdkit = await window.initRDKitModule(options);
    return state.rdkit;
  }

  async function loadWasmBinary(path) {
    const response = await fetch(String(path));
    if (!response.ok) {
      throw new Error(`Failed to load RDKit wasm: ${response.status} ${response.statusText}`.trim());
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  function base64ToBytes(value) {
    const binary = atob(String(value || ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function loadBatchSize(cfg) {
    const value = Number(cfg.pageSize || 72);
    return Number.isFinite(value) ? Math.max(12, Math.min(180, Math.floor(value))) : 72;
  }

  function storedOptionalInteger(key, min, max) {
    try {
      const value = window.localStorage?.getItem(key);
      if (value == null || value === 'auto') return null;
      return clampInteger(value, min, max, DEFAULT_CARD_MIN);
    } catch (_) {
      return null;
    }
  }

  function clampInteger(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, Math.round(number)));
  }

  function store(key, value) {
    try { window.localStorage?.setItem(key, String(value)); } catch (_) {}
  }

  function removeStored(key) {
    try { window.localStorage?.removeItem(key); } catch (_) {}
  }

  function applyTheme(cfg) {
    const theme = resolveTheme(cfg.theme);
    const canvasBackground = resolveCanvasBackground(theme, cfg.canvasBackground);
    const transparent = cfg.transparentBackground === true || canvasBackground === 'transparent';
    document.documentElement.dataset.buretTheme = theme;
    document.body.dataset.buretTheme = theme;
    document.body.classList.toggle('buret-theme-light', theme === 'light');
    document.body.classList.toggle('buret-theme-dark', theme !== 'light');
    document.body.classList.toggle('burette-transparent-background', transparent);
    document.body.classList.toggle('burette-opaque-background', !transparent);
    applyThemeTokens(cfg, theme);
    document.documentElement.style.setProperty('--buret-grid-canvas-background', canvasBackgroundCSS(canvasBackground));
  }

  function applyThemeTokens(cfg, theme) {
    const tokens = cfg.themeTokens && cfg.themeTokens[theme];
    if (!tokens || typeof tokens !== 'object') return;
    const accent = typeof tokens.accent === 'string' ? tokens.accent : '#AF52DE';
    const background = typeof tokens.background === 'string' ? tokens.background : (theme === 'light' ? '#FFFFFF' : '#111111');
    const foreground = typeof tokens.foreground === 'string' ? tokens.foreground : (theme === 'light' ? '#0D0D0D' : '#FCFCFC');
    const uiFont = typeof tokens.uiFont === 'string' ? tokens.uiFont : '';
    const opacity = 1 - (clampThemeNumber(tokens.translucent, theme === 'light' ? 10 : 20) / 100) * 0.95;
    const contrast = 0.2 + (clampThemeNumber(tokens.contrast, theme === 'light' ? 20 : 16) / 100) * 0.8;
    const root = document.documentElement;
    root.style.setProperty('--buret-accent', accent);
    root.style.setProperty('--buret-bg', `color-mix(in srgb, ${background} ${Math.round(opacity * 100)}%, transparent)`);
    root.style.setProperty('--buret-surface', `color-mix(in srgb, ${foreground} ${Math.round(contrast * 16)}%, transparent)`);
    root.style.setProperty('--buret-surface-raised', `color-mix(in srgb, ${foreground} ${Math.round(contrast * 28)}%, transparent)`);
    root.style.setProperty('--buret-input', `color-mix(in srgb, ${foreground} ${Math.round(contrast * 22)}%, transparent)`);
    root.style.setProperty('--buret-border', `color-mix(in srgb, ${foreground} ${Math.round(contrast * 18)}%, transparent)`);
    root.style.setProperty('--buret-border-strong', `color-mix(in srgb, ${foreground} ${Math.round(contrast * 30)}%, transparent)`);
    root.style.setProperty('--buret-text', `color-mix(in srgb, ${foreground} 94%, transparent)`);
    root.style.setProperty('--buret-muted', `color-mix(in srgb, ${foreground} 62%, transparent)`);
    root.style.setProperty('--buret-faint', `color-mix(in srgb, ${foreground} 38%, transparent)`);
    if (uiFont) document.body.style.fontFamily = uiFont;
  }

  function clampThemeNumber(value, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(Math.max(number, 0), 100);
  }

  function resolveTheme(value) {
    if (value === 'light' || value === 'dark') return value;
    try {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    } catch (_) {
      return 'dark';
    }
  }

  function normalizeCanvasBackground(value) {
    return ['auto', 'black', 'graphite', 'white', 'transparent'].includes(value) ? value : 'auto';
  }

  function resolveCanvasBackground(theme, value) {
    const background = normalizeCanvasBackground(value);
    if (background === 'auto') return theme === 'light' ? 'white' : 'graphite';
    return background;
  }

  function canvasBackgroundCSS(background) {
    if (background === 'white') return '#f7f7f2';
    if (background === 'graphite') return '#111317';
    if (background === 'transparent') return 'transparent';
    return '#000000';
  }

  function installThemeListener(cfg) {
    if (cfg.theme === 'light' || cfg.theme === 'dark' || !window.matchMedia) return;
    try {
      const media = window.matchMedia('(prefers-color-scheme: light)');
      const update = () => applyTheme(cfg);
      if (typeof media.addEventListener === 'function') media.addEventListener('change', update);
      else if (typeof media.addListener === 'function') media.addListener(update);
    } catch (_) {}
  }

  function buildUI(cfg) {
    const caps = capabilities(cfg);
    root.innerHTML = `
      <section class="buret-grid-shell">
        <header class="buret-grid-header">
          <div>
            <div class="buret-eyebrow">${escapeHTML(cfg.format === 'sdf' ? 'SDF collection' : 'SMILES collection')}</div>
            <h1>${escapeHTML(cfg.label || 'Molecule collection')}</h1>
            <div id="summary" class="buret-summary"></div>
          </div>
          <div class="buret-actions" ${caps.export ? '' : 'hidden'}>
            <button id="copy-selected" type="button">Copy selected</button>
            <button id="export-smi" type="button">Export SMILES</button>
            <button id="export-csv" type="button">Export CSV</button>
          </div>
        </header>
        <div class="buret-grid-toolbar">
          <div class="buret-toolbar-row buret-toolbar-row-main">
            <label class="buret-search-control">Search <input id="search" type="search" placeholder="name, SMILES, metadata" /></label>
            <label class="buret-smarts-control" ${caps.substructureSearch ? '' : 'hidden'}>SMARTS <input id="smarts" type="search" spellcheck="false" autocapitalize="off" placeholder="[#6]=O" /></label>
            <label class="buret-sort-control">Sort <select id="sort"><option value="index">File order</option><option value="name">Name</option><option value="smiles">SMILES</option>${propertyOptions(cfg)}</select></label>
            <div id="load-status" class="buret-load-status"></div>
          </div>
          <div class="buret-toolbar-row buret-toolbar-row-view">
            <button id="show-properties" class="buret-toggle-button" type="button" aria-pressed="false">Properties</button>
            <button id="clear-smarts" class="buret-toggle-button buret-clear-smarts" type="button" hidden>Clear SMARTS</button>
            <div class="buret-selection-actions" ${caps.selection ? '' : 'hidden'}>
              <button id="select-all" class="buret-toggle-button" type="button">Select all</button>
              <button id="clear-selection" class="buret-toggle-button" type="button">Clear selection</button>
            </div>
            ${caps.xyzrenderCards ? cardRendererSwitchHTML() : ''}
            ${caps.rendererSwitch ? rendererSwitchHTML() : ''}
          </div>
        </div>
        <main id="grid" class="buret-grid"></main>
        <div id="load-sentinel" class="buret-load-sentinel" aria-hidden="true"></div>
        <footer id="footer" class="buret-grid-footer"></footer>
      </section>`;
    document.getElementById('search').addEventListener('input', event => {
      state.query = event.target.value || '';
      refresh(cfg);
    });
    document.getElementById('smarts')?.addEventListener('input', event => {
      state.smarts = event.target.value || '';
      refresh(cfg);
    });
    document.getElementById('sort').addEventListener('change', event => {
      state.sort = event.target.value || 'index';
      refresh(cfg);
    });
    document.getElementById('show-properties').addEventListener('click', () => {
      state.showProperties = !state.showProperties;
      applyGridPreferences();
    });
    document.getElementById('select-all')?.addEventListener('click', () => selectAllRows(cfg));
    document.getElementById('clear-selection')?.addEventListener('click', () => clearSelection(cfg));
    document.getElementById('copy-selected')?.addEventListener('click', copySelected);
    document.getElementById('export-smi')?.addEventListener('click', () => exportSmiles(cfg));
    document.getElementById('export-csv')?.addEventListener('click', () => exportCSV(cfg));
    document.getElementById('clear-smarts')?.addEventListener('click', () => {
      state.smarts = '';
      const input = document.getElementById('smarts');
      if (input) input.value = '';
      refresh(cfg);
      input?.focus();
    });
    root.querySelectorAll('[data-buret-grid-renderer]').forEach(button => {
      button.addEventListener('click', () => requestRendererSwitch(button.getAttribute('data-buret-grid-renderer'), cfg));
    });
    root.querySelectorAll('[data-buret-grid-card-renderer]').forEach(button => {
      button.addEventListener('click', () => setCardRenderer(button.getAttribute('data-buret-grid-card-renderer'), cfg));
    });
    if (state.selectionKeydownHandler) {
      document.removeEventListener('keydown', state.selectionKeydownHandler);
    }
    state.selectionKeydownHandler = event => handleGridSelectionKeydown(event, cfg);
    document.addEventListener('keydown', state.selectionKeydownHandler);
    initXyzrenderControls(cfg);
    applyGridPreferences();
    initInfiniteLoading(cfg);
  }

  function applyGridPreferences() {
    document.body.classList.add('buret-grid-size-compact');
    document.body.classList.toggle('buret-hide-properties', !state.showProperties);
    if (state.cardMin == null) {
      document.body.classList.remove('buret-grid-manual-size');
      document.documentElement.style.removeProperty('--buret-card-min');
      document.documentElement.style.removeProperty('--buret-card-max');
    } else {
      document.body.classList.add('buret-grid-manual-size');
      document.documentElement.style.setProperty('--buret-card-min', `${state.cardMin}px`);
      document.documentElement.style.setProperty('--buret-card-max', `${state.cardMin}px`);
    }
    const propertiesToggle = document.getElementById('show-properties');
    if (propertiesToggle) {
      propertiesToggle.classList.toggle('active', state.showProperties);
      propertiesToggle.setAttribute('aria-pressed', state.showProperties ? 'true' : 'false');
    }
    requestAnimationFrame(fitRenderedGridSVGs);
    root.querySelectorAll('[data-buret-grid-card-renderer]').forEach(button => {
      const active = button.getAttribute('data-buret-grid-card-renderer') === state.cardRenderer;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function propertyOptions(cfg) {
    if (isRemoteMode(cfg)) return '';
    const keys = new Set();
    for (const row of state.all) {
      Object.keys(row.props || {}).forEach(key => {
        if (keys.size < 24) keys.add(key);
      });
      if (keys.size >= 24) break;
    }
    return [...keys].sort().map(key => `<option value="prop:${escapeAttr(key)}">${escapeHTML(key)}</option>`).join('');
  }

  function rendererSwitchHTML() {
    const presetOptions = xyzrenderPresetOptions()
      .map(option => `<option value="${escapeAttr(option.value)}">${escapeHTML(option.label)}</option>`)
      .join('');
    return `
      <div class="buret-grid-renderer-controls">
        <div class="buret-grid-renderer-switch" aria-label="3D renderer">
          <button type="button" data-buret-grid-renderer="molstar" data-buret-grid-sdf-poses data-buret-grid-docking>Poses</button>
          <button type="button" data-buret-grid-renderer="xyzrender-external">xyzrender</button>
        </div>
        <label class="buret-grid-xyzrender-preset">Preset
          <select data-buret-grid-xyzrender-preset>${presetOptions}</select>
        </label>
        <button class="buret-grid-xyzrender-tune" type="button" data-buret-grid-xyzrender-tune aria-expanded="false">Tune</button>
        <div class="buret-grid-xyzrender-popover hidden" data-buret-grid-xyzrender-popover>
          <div class="buret-grid-xyzrender-popover-title">xyzrender</div>
          <label><input type="checkbox" data-buret-grid-xctrl="transparentBackground" /> Transparent background</label>
          <label>Gradients ${triStateSelectHTML('gradients')}</label>
          <label>Fog ${triStateSelectHTML('fog')}</label>
          <label>VDW style ${triStateSelectHTML('showVdw')}</label>
          <label>Hide bonds ${triStateSelectHTML('hideBonds')}</label>
          <label>Atom scale <input type="number" min="0.1" max="3" step="0.05" data-buret-grid-xctrl="atomScale" placeholder="auto" /></label>
          <label>Bond width <input type="number" min="0.01" max="1" step="0.01" data-buret-grid-xctrl="bondWidth" placeholder="auto" /></label>
          <label>Molecule color <input type="text" data-buret-grid-xctrl="molColor" placeholder="#AF52DE or auto" /></label>
          <label>Cell ${triStateSelectHTML('showCell')}</label>
          <label>Ghost cells ${triStateSelectHTML('showGhosts')}</label>
          <label>Axes ${triStateSelectHTML('showAxes')}</label>
          <label>Supercell <input type="text" data-buret-grid-xctrl="supercell" placeholder="1,1,1" /></label>
        </div>
      </div>`;
  }

  function cardRendererSwitchHTML() {
    return `
      <div class="buret-grid-card-renderer-switch" aria-label="Card renderer">
        <span>Cards</span>
        <button type="button" data-buret-grid-card-renderer="rdkit" aria-pressed="true">RDKit</button>
        <button type="button" data-buret-grid-card-renderer="xyzrender" aria-pressed="false">xyzrender</button>
      </div>`;
  }

  function setCardRenderer(renderer, cfg) {
    const value = CARD_RENDERER_OPTIONS.includes(String(renderer || '').toLowerCase())
      ? String(renderer || '').toLowerCase()
      : 'rdkit';
    if (state.cardRenderer === value) return;
    state.cardRenderer = value;
    applyGridPreferences();
    render(cfg);
  }

  function requestRendererSwitch(renderer, cfg) {
    const value = normalizeRenderer(renderer);
    if (value === 'molstar') {
      requestSdfPoseDocument(cfg);
      return;
    }
    if (value === 'xyzrender-external') {
      const preset = root.querySelector('[data-buret-grid-xyzrender-preset]');
      state.xyzrenderPreset = normalizeXyzrenderPreset(preset?.value);
      state.xyzrenderControls = readXyzrenderControls();
    }
    const payload = value === 'xyzrender-external'
      ? { value, documentId: cfg?.documentId || null, preset: state.xyzrenderPreset, controls: { ...state.xyzrenderControls } }
      : { value, documentId: cfg?.documentId || null };
    post('setRenderer', `[grid] Switch renderer to ${value}.`, payload);
  }

  function requestSdfPoseDocument(cfg) {
    post('openSdfPoseDocument', '[grid] Open SDF poses in Mol*.', {
      documentId: cfg?.documentId || null
    });
  }

  function normalizeRenderer(renderer) {
    const value = String(renderer || 'molstar').toLowerCase();
    return value === 'xyzrender-external' || value === 'xyzrender' ? 'xyzrender-external' : 'molstar';
  }

  function initXyzrenderControls(cfg) {
    state.xyzrenderPreset = normalizeXyzrenderPreset(cfg.xyzrenderPreset);
    state.xyzrenderControls = normalizeXyzrenderControls(cfg.xyzrenderControls);
    const preset = root.querySelector('[data-buret-grid-xyzrender-preset]');
    if (preset) {
      preset.value = state.xyzrenderPreset;
      preset.addEventListener('change', event => {
        state.xyzrenderPreset = normalizeXyzrenderPreset(event.target.value);
        if (state.cardRenderer === 'xyzrender') render(config());
      });
    }
    writeXyzrenderControls();
    root.querySelector('[data-buret-grid-xyzrender-tune]')?.addEventListener('click', event => {
      const popover = root.querySelector('[data-buret-grid-xyzrender-popover]');
      if (!popover) return;
      const isHidden = popover.classList.toggle('hidden');
      event.currentTarget.setAttribute('aria-expanded', isHidden ? 'false' : 'true');
    });
    root.querySelectorAll('[data-buret-grid-xctrl]').forEach(input => {
      input.addEventListener('input', () => {
        state.xyzrenderControls = readXyzrenderControls();
      });
      input.addEventListener('change', () => {
        state.xyzrenderControls = readXyzrenderControls();
        if (state.cardRenderer === 'xyzrender') render(config());
      });
    });
  }

  function xyzrenderPresetOptions() {
    const configured = window.BurreteConfig?.xyzrenderPresetOptions;
    return Array.isArray(configured) && configured.length
      ? configured.map(option => ({
          value: normalizeXyzrenderPreset(rawXyzrenderPresetValue(option)),
          label: String(option?.label || option?.value || 'Default')
        }))
      : DEFAULT_XYZRENDER_PRESETS;
  }

  function rawXyzrenderPresetValue(option) {
    if (typeof option === 'string') return option;
    if (!option || typeof option !== 'object') return '';
    const explicit = option.value || option.id || option.key || option.preset;
    if (explicit) return explicit;
    const label = String(option.label || '').trim().toLowerCase();
    return DEFAULT_XYZRENDER_PRESETS.find(preset => preset.label.toLowerCase() === label)?.value || '';
  }

  function knownXyzrenderPresetValues() {
    const values = new Set(DEFAULT_XYZRENDER_PRESETS.map(option => option.value));
    const configured = window.BurreteConfig?.xyzrenderPresetOptions;
    if (Array.isArray(configured)) {
      configured.forEach(option => {
        const value = String(rawXyzrenderPresetValue(option) || '').toLowerCase();
        if (value) values.add(value);
      });
    }
    return values;
  }

  function normalizeXyzrenderPreset(value) {
    const raw = String(value || 'default').toLowerCase();
    return knownXyzrenderPresetValues().has(raw) ? raw : 'default';
  }

  function normalizeXyzrenderControls(value) {
    const controls = value && typeof value === 'object' ? value : {};
    return {
      transparentBackground: controls.transparentBackground === false ? false : DEFAULT_XYZRENDER_CONTROLS.transparentBackground,
      gradients: triState(controls.gradients),
      fog: triState(controls.fog),
      showVdw: triState(controls.showVdw),
      hideBonds: triState(controls.hideBonds),
      atomScale: numberOrNull(controls.atomScale, 0.1, 3),
      bondWidth: numberOrNull(controls.bondWidth, 0.01, 1),
      molColor: typeof controls.molColor === 'string' ? controls.molColor : '',
      showCell: triState(controls.showCell),
      showGhosts: triState(controls.showGhosts),
      showAxes: triState(controls.showAxes),
      supercell: normalizeSupercell(controls.supercell)
    };
  }

  function writeXyzrenderControls() {
    for (const [key, value] of Object.entries(state.xyzrenderControls)) {
      const input = root.querySelector(`[data-buret-grid-xctrl="${key}"]`);
      if (!input) continue;
      if (input.type === 'checkbox') input.checked = value === true;
      else if (input.tagName === 'SELECT') input.value = value === null ? '' : String(value);
      else input.value = value ?? '';
    }
  }

  function readXyzrenderControls() {
    const controls = { ...state.xyzrenderControls };
    root.querySelectorAll('[data-buret-grid-xctrl]').forEach(input => {
      const key = input.getAttribute('data-buret-grid-xctrl');
      if (!key) return;
      if (input.type === 'checkbox') controls[key] = input.checked;
      else if (input.tagName === 'SELECT') controls[key] = triState(input.value);
      else if (key === 'atomScale') controls[key] = numberOrNull(input.value, 0.1, 3);
      else if (key === 'bondWidth') controls[key] = numberOrNull(input.value, 0.01, 1);
      else if (key === 'supercell') controls[key] = normalizeSupercell(input.value);
      else controls[key] = String(input.value || '').trim();
    });
    return normalizeXyzrenderControls(controls);
  }

  function triStateSelectHTML(key) {
    return `<select data-buret-grid-xctrl="${escapeAttr(key)}"><option value="">Auto</option><option value="true">On</option><option value="false">Off</option></select>`;
  }

  function triState(value) {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return null;
  }

  function numberOrNull(value, min, max) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return Math.min(max, Math.max(min, number));
  }

  function normalizeSupercell(value) {
    const source = Array.isArray(value) ? value : String(value || '').split(/[,\s]+/u);
    const parsed = source.map(item => Number.parseInt(String(item), 10));
    if (parsed.length !== 3 || parsed.some(item => !Number.isFinite(item) || item < 1)) return null;
    return parsed;
  }

  function refresh(cfg) {
    if (state.remoteMode) {
      void refreshRemote(cfg);
      return;
    }
    const query = normalize(state.query);
    const textRows = query
      ? state.all.filter(row => normalize([row.name, row.smiles, ...Object.entries(row.props || {}).flat()].join('\n')).includes(query))
      : state.all.slice();
    state.rows = filterBySMARTS(textRows);
    state.rows.sort((a, b) => compare(a, b, state.sort));
    state.totalRows = state.rows.length;
    render(cfg);
  }

  function filterBySMARTS(rows) {
    state.smartsError = '';
    state.smartsMatches = new Map();
    const pattern = state.smarts.trim();
    if (!pattern) return rows;
    if (!state.rdkit || typeof state.rdkit.get_qmol !== 'function') {
      state.smartsError = 'This RDKit build does not support SMARTS queries.';
      return rows;
    }

    let qmol = null;
    try {
      qmol = state.rdkit.get_qmol(pattern);
      if (!qmol || (typeof qmol.is_valid === 'function' && !qmol.is_valid())) throw new Error('invalid SMARTS');
      const matches = [];
      for (const row of rows) {
        const match = substructureMatch(row, qmol);
        if (!match) continue;
        state.smartsMatches.set(Number(row.index), match);
        matches.push(row);
      }
      return matches;
    } catch (error) {
      state.smartsError = error?.message || String(error);
      return rows;
    } finally {
      try { qmol?.delete?.(); } catch (_) {}
    }
  }

  function substructureMatch(row, qmol) {
    let mol = null;
    try {
      mol = state.rdkit.get_mol(row.molblock || row.smiles || '');
      if (!mol || (typeof mol.is_valid === 'function' && !mol.is_valid())) return null;
      const raw = mol.get_substruct_match(qmol);
      const parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
      const atoms = Array.isArray(parsed?.atoms) ? parsed.atoms.filter(Number.isInteger) : [];
      const bonds = Array.isArray(parsed?.bonds) ? parsed.bonds.filter(Number.isInteger) : [];
      return atoms.length ? { atoms, bonds } : null;
    } catch (_) {
      return null;
    } finally {
      try { mol?.delete?.(); } catch {}
    }
  }

  function compare(a, b, key) {
    const get = row => key.startsWith('prop:') ? (row.props || {})[key.slice(5)] : row[key];
    if (key === 'index') return Number(a.index) - Number(b.index);
    return String(get(a) || '').localeCompare(String(get(b) || ''), undefined, {
      numeric: true,
      sensitivity: 'base'
    }) || Number(a.index) - Number(b.index);
  }

  function initInfiniteLoading(cfg) {
    const sentinel = document.getElementById('load-sentinel');
    if (!sentinel) return;
    state.loadObserver?.disconnect?.();
    if (typeof IntersectionObserver === 'function') {
      state.loadObserver = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) loadMore(cfg);
      }, { root: null, rootMargin: '520px 0px' });
      state.loadObserver.observe(sentinel);
    }
    if (state.scrollHandler) window.removeEventListener('scroll', state.scrollHandler);
    state.scrollHandler = () => maybeLoadMore(cfg);
    window.addEventListener('scroll', state.scrollHandler, { passive: true });
  }

  function hasMoreRows() {
    if (state.remoteMode) return state.renderedCount < state.rows.length || state.rows.length < state.totalRows;
    return state.renderedCount < state.rows.length;
  }

  function maybeLoadMore(cfg) {
    if (!hasMoreRows()) return;
    const sentinel = document.getElementById('load-sentinel');
    const rect = sentinel?.getBoundingClientRect();
    if (!rect || rect.top <= window.innerHeight + 520) loadMore(cfg);
  }

  async function render(cfg) {
    const token = ++state.token;
    const grid = document.getElementById('grid');
    grid.innerHTML = '';
    state.renderedCount = 0;
    state.visibleCount = Math.min(loadBatchSize(cfg), state.rows.length);
    if (!state.rows.length) {
      grid.innerHTML = '<div class="buret-empty">No molecules match this search.</div>';
      updateChrome(cfg);
      post('ready', 'ready');
      return;
    }
    await appendVisibleRows(cfg, token);
  }

  async function loadMore(cfg) {
    if (state.remoteMode) {
      await loadMoreRemote(cfg);
      return;
    }
    if (state.rendering) {
      state.pendingLoad = hasMoreRows();
      return;
    }
    if (!hasMoreRows()) return;
    state.visibleCount = Math.min(state.rows.length, state.visibleCount + loadBatchSize(cfg));
    await appendVisibleRows(cfg, state.token);
  }

  async function refreshRemote(cfg) {
    const token = ++state.token;
    state.smartsError = '';
    state.smartsMatches = new Map();
    state.rows = [];
    state.totalRows = 0;
    state.renderedCount = 0;
    state.visibleCount = 0;
    const grid = document.getElementById('grid');
    if (grid) grid.innerHTML = '';
    updateChrome(cfg);
    try {
      state.remoteLoading = true;
      if (state.smarts.trim()) {
        const matches = await scanRemoteBySMARTS(cfg, token);
        if (token !== state.token) return;
        state.rows = matches;
        state.totalRows = matches.length;
        state.visibleCount = Math.min(loadBatchSize(cfg), state.rows.length);
        await appendVisibleRows(cfg, token);
        return;
      }
      const result = await hostRequest('gridFetchPage', {
        query: state.query || '',
        sort: state.sort || 'index',
        offset: 0,
        limit: loadBatchSize(cfg)
      });
      if (token !== state.token) return;
      state.rows = Array.isArray(result.rows) ? result.rows : [];
      state.totalRows = Number(result.totalRows || 0);
      state.visibleCount = Math.min(loadBatchSize(cfg), state.rows.length);
      await appendVisibleRows(cfg, token);
    } catch (error) {
      const message = error?.message || String(error);
      setStatus(message, 'error');
    } finally {
      state.remoteLoading = false;
    }
  }

  async function scanRemoteBySMARTS(cfg, token) {
    const pattern = state.smarts.trim();
    if (!pattern) return [];
    if (!state.rdkit || typeof state.rdkit.get_qmol !== 'function') {
      state.smartsError = 'This RDKit build does not support SMARTS queries.';
      return [];
    }
    let qmol = null;
    try {
      qmol = state.rdkit.get_qmol(pattern);
      if (!qmol || (typeof qmol.is_valid === 'function' && !qmol.is_valid())) throw new Error('invalid SMARTS');
      const matches = [];
      let offset = 0;
      let total = null;
      const limit = Math.max(120, loadBatchSize(cfg));
      while (total === null || offset < total) {
        if (token !== state.token) return matches;
        const result = await hostRequest('gridFetchPage', {
          query: state.query || '',
          sort: state.sort || 'index',
          offset,
          limit
        });
        const pageRows = Array.isArray(result.rows) ? result.rows : [];
        total = Number(result.totalRows || 0);
        for (const row of pageRows) {
          const match = substructureMatch(row, qmol);
          if (!match) continue;
          state.smartsMatches.set(Number(row.index), match);
          matches.push(row);
        }
        offset += pageRows.length;
        if (!pageRows.length) break;
        setStatus(`[grid] SMARTS scan ${Math.min(offset, total).toLocaleString()} / ${total.toLocaleString()} rows...`);
      }
      return matches;
    } catch (error) {
      state.smartsError = error?.message || String(error);
      return [];
    } finally {
      try { qmol?.delete?.(); } catch (_) {}
    }
  }

  async function loadMoreRemote(cfg) {
    if (state.remoteLoading || !hasMoreRows()) return;
    if (state.renderedCount < state.rows.length) {
      state.visibleCount = Math.min(state.rows.length, state.visibleCount + loadBatchSize(cfg));
      await appendVisibleRows(cfg, state.token);
      return;
    }
    const token = state.token;
    state.remoteLoading = true;
    try {
      const result = await hostRequest('gridFetchPage', {
        query: state.query || '',
        sort: state.sort || 'index',
        offset: state.rows.length,
        limit: loadBatchSize(cfg)
      });
      if (token !== state.token) return;
      const nextRows = Array.isArray(result.rows) ? result.rows : [];
      state.totalRows = Number(result.totalRows || state.totalRows);
      state.rows.push(...nextRows);
      state.visibleCount = Math.min(state.rows.length, state.visibleCount + loadBatchSize(cfg));
      await appendVisibleRows(cfg, state.token);
    } catch (error) {
      setStatus(error?.message || String(error), 'error');
    } finally {
      state.remoteLoading = false;
    }
  }

  async function appendVisibleRows(cfg, token) {
    const grid = document.getElementById('grid');
    const rows = state.rows.slice(state.renderedCount, state.visibleCount);
    state.rendering = true;
    try {
      for (const row of rows) {
        if (token !== state.token) return;
        const nextCard = card(row, cfg);
        grid.appendChild(nextCard);
        fitCardSVGs(nextCard);
        state.renderedCount++;
        if (state.renderedCount % 16 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
      updateChrome(cfg);
      post('ready', 'ready');
      if (status && !window.BurreteDebug) status.classList.add('hidden');
    } finally {
      state.rendering = false;
      if (token === state.token) {
        if (state.pendingLoad) {
          state.pendingLoad = false;
          loadMore(cfg);
        } else {
          requestAnimationFrame(() => maybeLoadMore(cfg));
        }
      }
    }
  }

  function updateChrome(cfg) {
    const total = Number(cfg.recordsTotal || state.all.length);
    const included = state.remoteMode ? state.rows.length : Number(cfg.recordsIncluded || state.all.length);
    const visible = state.remoteMode ? state.totalRows : state.rows.length;
    document.getElementById('summary').textContent = [
      `${visible.toLocaleString()} visible`,
      `${state.renderedCount.toLocaleString()} shown`,
      `${included.toLocaleString()} loaded`,
      `${total.toLocaleString()} in file`,
      state.selected.size ? `${state.selected.size.toLocaleString()} selected` : ''
    ].filter(Boolean).join(' · ');
    if (!state.remoteMode && state.smarts.trim() && !state.smartsError) {
      document.getElementById('summary').textContent += ` · SMARTS matches ${state.smartsMatches.size.toLocaleString()}`;
    }
    const loadStatus = document.getElementById('load-status');
    if (loadStatus) {
      loadStatus.textContent = hasMoreRows()
        ? `${state.renderedCount.toLocaleString()} of ${visible.toLocaleString()} shown`
        : 'All visible molecules loaded';
    }
    const clearSMARTS = document.getElementById('clear-smarts');
    if (clearSMARTS) clearSMARTS.hidden = !state.smarts.trim();
    const smartsInput = document.getElementById('smarts');
    if (smartsInput) smartsInput.classList.toggle('invalid', !!state.smartsError);
    const selectableIndexes = selectableRowIndexes();
    const allCurrentSelected = selectableIndexes.length > 0 && selectableIndexes.every(index => state.selected.has(index));
    const selectAllButton = document.getElementById('select-all');
    if (selectAllButton) selectAllButton.disabled = selectableIndexes.length === 0 || allCurrentSelected;
    const clearSelectionButton = document.getElementById('clear-selection');
    if (clearSelectionButton) clearSelectionButton.disabled = state.selected.size === 0;
    const cardRendererStatus = state.cardRenderer === 'xyzrender' && capabilities(cfg).xyzrenderCards
      ? 'External xyzrender card rendering. Loaded cards are cached in this view.'
      : 'Offline RDKit.js rendering. No network access required.';
    document.getElementById('footer').textContent = state.smartsError
      ? `SMARTS error: ${state.smartsError}`
      : (total > included && !state.remoteMode
        ? `Showing first ${included.toLocaleString()} of ${total.toLocaleString()} records.`
        : (hasMoreRows()
          ? `Scroll to load more. ${state.renderedCount.toLocaleString()} of ${visible.toLocaleString()} visible molecules are rendered.`
          : (state.remoteMode
            ? 'Desktop grid runtime is loading rows on demand.'
            : cardRendererStatus)));
  }

  function card(row, cfg) {
    const caps = capabilities(cfg);
    const el = document.createElement('article');
    const index = Number(row.index);
    el.className = 'buret-card';
    el.dataset.index = String(row.index);
    el.dataset.buretCardTooltip = cardTooltip(row);
    if (state.selected.has(index)) el.classList.add('selected');
    el.setAttribute('aria-selected', state.selected.has(index) ? 'true' : 'false');
    if (state.smartsMatches.has(index)) el.classList.add('smarts-match');
    el.innerHTML = `
      <div class="buret-molecule-picture" data-buret-molecule-picture data-xyzrender-key="">${draw(row, cfg)}</div>
      <div class="buret-card-body">
        ${state.smartsMatches.has(index) ? '<div class="buret-match-badge">SMARTS match</div>' : ''}
        <h2>${escapeHTML(row.name || `Molecule ${index + 1}`)}</h2>
        ${row.smiles ? `<div class="buret-smiles">${escapeHTML(row.smiles)}</div>` : ''}
        ${metadata(row)}
      </div>
      <span class="buret-selected-indicator" aria-hidden="true"></span>
      <span class="buret-card-resize-handle buret-card-resize-handle-x" role="separator" aria-orientation="vertical" tabindex="0" title="Drag left or right to resize grid cards. Double-click to reset width." data-buret-card-resize="x"></span>
      <span class="buret-card-resize-handle buret-card-resize-handle-y" role="separator" aria-orientation="horizontal" tabindex="0" title="Drag up or down to resize grid cards. Double-click to reset size." data-buret-card-resize="y"></span>
      <span class="buret-card-resize-handle buret-card-resize-handle-xy" role="separator" aria-orientation="vertical" tabindex="0" title="Drag to resize cards in both directions. Double-click to reset size." data-buret-card-resize="xy"></span>`;
    if (caps.selection) {
      el.tabIndex = 0;
      el.role = 'button';
      el.addEventListener('click', event => handleCardSelection(event, row, cfg, el));
      el.addEventListener('keydown', event => {
        if (event.key === ' ' || event.key === 'Enter') {
          handleCardSelection(event, row, cfg, el);
        }
      });
    }
    if (state.cardRenderer === 'xyzrender' && capabilities(cfg).xyzrenderCards) {
      const picture = el.querySelector('[data-buret-molecule-picture]');
      if (picture) renderXyzrenderCard(row, picture, cfg);
    }
    installCardHover(el);
    installCardResizeHandle(el);
    return el;
  }

  function selectableRowIndexes() {
    return state.rows
      .map(row => Number(row.index))
      .filter(index => Number.isFinite(index));
  }

  function syncRenderedSelection() {
    root.querySelectorAll('.buret-card[data-index]').forEach(card => {
      const index = Number(card.dataset.index);
      const selected = state.selected.has(index);
      card.classList.toggle('selected', selected);
      card.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
  }

  function toggleSelection(index, cfg) {
    if (!Number.isFinite(index)) return;
    if (state.selected.has(index)) state.selected.delete(index);
    else state.selected.add(index);
    state.selectionAnchorIndex = index;
    syncRenderedSelection();
    updateChrome(cfg);
  }

  function selectRangeTo(index, cfg) {
    if (!Number.isFinite(index)) return;
    const indexes = selectableRowIndexes();
    const targetPosition = indexes.indexOf(index);
    const anchorPosition = indexes.indexOf(state.selectionAnchorIndex);
    if (targetPosition < 0 || anchorPosition < 0) {
      state.selected.add(index);
      state.selectionAnchorIndex = index;
      syncRenderedSelection();
      updateChrome(cfg);
      return;
    }
    const start = Math.min(anchorPosition, targetPosition);
    const end = Math.max(anchorPosition, targetPosition);
    indexes.slice(start, end + 1).forEach(rowIndex => state.selected.add(rowIndex));
    syncRenderedSelection();
    updateChrome(cfg);
  }

  function selectAllRows(cfg) {
    const indexes = selectableRowIndexes();
    state.selected = new Set(indexes);
    state.selectionAnchorIndex = indexes.length ? indexes[indexes.length - 1] : null;
    syncRenderedSelection();
    updateChrome(cfg);
  }

  function clearSelection(cfg) {
    state.selected.clear();
    state.selectionAnchorIndex = null;
    syncRenderedSelection();
    updateChrome(cfg);
  }

  function handleCardSelection(event, row, cfg, cardElement) {
    if (event.defaultPrevented || event.target?.closest?.('[data-buret-card-resize]')) return;
    event.preventDefault();
    const index = Number(row.index);
    if (event.shiftKey) selectRangeTo(index, cfg);
    else toggleSelection(index, cfg);
    cardElement?.focus?.({ preventScroll: true });
  }

  function handleGridSelectionKeydown(event, cfg) {
    if (!capabilities(cfg).selection) return;
    const target = event.target;
    if (target?.closest?.('input, textarea, select, button, [contenteditable="true"], [data-buret-card-resize]')) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      selectAllRows(cfg);
      return;
    }
    if (event.key === 'Escape' && state.selected.size) {
      event.preventDefault();
      clearSelection(cfg);
    }
  }

  function cardTooltip(row) {
    const label = row.name || `Molecule ${Number(row.index) + 1}`;
    const parts = [label];
    if (row.smiles) parts.push(row.smiles);
    const props = Object.entries(row.props || {})
      .filter(([, value]) => String(value || '').length)
      .slice(0, 2)
      .map(([key, value]) => `${key}: ${value}`);
    parts.push(...props);
    return parts.join(' · ');
  }

  function installCardHover(card) {
    const picture = card.querySelector('[data-buret-molecule-picture]');
    if (!picture) return;
    picture.addEventListener('pointerenter', () => card.classList.add('buret-card-hovering-molecule'));
    picture.addEventListener('pointermove', () => card.classList.add('buret-card-hovering-molecule'));
    picture.addEventListener('pointerleave', () => card.classList.remove('buret-card-hovering-molecule'));
    card.addEventListener('focusin', () => card.classList.add('buret-card-hovering-molecule'));
    card.addEventListener('focusout', () => card.classList.remove('buret-card-hovering-molecule'));
  }

  function installCardResizeHandle(card) {
    const handles = card.querySelectorAll('[data-buret-card-resize]');
    handles.forEach(handle => {
      const axis = handle.getAttribute('data-buret-card-resize') || 'x';
      handle.addEventListener('click', event => {
        event.stopPropagation();
      });
      handle.addEventListener('dblclick', event => {
        event.preventDefault();
        event.stopPropagation();
        resetCardResize(axis);
      });
      handle.addEventListener('keydown', event => handleResizeKeydown(event, card, axis));
      handle.addEventListener('pointerdown', event => startCardResize(event, card, axis));
    });
  }

  function measuredCardWidth(card) {
    const width = card.getBoundingClientRect().width;
    return Number.isFinite(width) && width > 0 ? width : DEFAULT_CARD_MIN;
  }

  function resetCardResize(_axis) {
    state.cardMin = null;
    removeStored(CARD_MIN_STORAGE_KEY);
    applyGridPreferences();
  }

  function handleResizeKeydown(event, card, axis) {
    const widthKey = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
    const heightKey = event.key === 'ArrowUp' || event.key === 'ArrowDown';
    if (!widthKey && !heightKey && event.key !== 'Home') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Home') {
      resetCardResize(axis);
      return;
    }
    if (((axis === 'x' || axis === 'xy') && widthKey) || ((axis === 'y' || axis === 'xy') && heightKey)) {
      const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
      const limits = cardWidthLimits(card);
      state.cardMin = clampInteger((state.cardMin || measuredCardWidth(card)) + direction * 8, limits.min, limits.max, DEFAULT_CARD_MIN);
      store(CARD_MIN_STORAGE_KEY, state.cardMin);
    }
    applyGridPreferences();
  }

  function cardWidthLimits(card) {
    const grid = card.closest('.buret-grid');
    const gridWidth = grid?.getBoundingClientRect().width || window.innerWidth || DEFAULT_CARD_MIN;
    const gap = parseFloat(getComputedStyle(grid || document.documentElement).columnGap || '0') || 0;
    const minByColumns = (gridWidth - gap * 29) / 30;
    const maxByColumns = (gridWidth - gap * 2) / 3;
    return {
      min: clampInteger(minByColumns, MIN_CARD_MIN, MAX_CARD_MIN, MIN_CARD_MIN),
      max: clampInteger(maxByColumns, MIN_CARD_MIN, MAX_CARD_MIN, MAX_CARD_MIN)
    };
  }

  function startCardResize(event, card, axis) {
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = state.cardMin || measuredCardWidth(card);
    const limits = cardWidthLimits(card);
    document.body.classList.add('buret-grid-resizing');
    document.body.dataset.buretGridResizeAxis = axis;
    card.classList.add('buret-card-resizing');
    card.dataset.buretGridResizeAxis = axis;
    const pointerId = event.pointerId;
    try { event.currentTarget.setPointerCapture(pointerId); } catch (_) {}
    const onMove = moveEvent => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      const delta = axis === 'x'
        ? deltaX
        : (axis === 'y' ? deltaY : (Math.abs(deltaX) >= Math.abs(deltaY) ? deltaX : deltaY));
      const nextWidth = clampInteger(startWidth + delta, limits.min, limits.max, DEFAULT_CARD_MIN);
      if (state.cardMin !== nextWidth) {
        state.cardMin = nextWidth;
        store(CARD_MIN_STORAGE_KEY, nextWidth);
        applyGridPreferences();
      }
    };
    const onUp = () => {
      document.body.classList.remove('buret-grid-resizing');
      delete document.body.dataset.buretGridResizeAxis;
      card.classList.remove('buret-card-resizing');
      delete card.dataset.buretGridResizeAxis;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    window.addEventListener('pointercancel', onUp, { once: true });
  }

  function draw(row, cfg) {
    if (state.cardRenderer === 'xyzrender' && capabilities(cfg).xyzrenderCards) {
      return '<div class="buret-molecule-loading">Rendering with xyzrender...</div>';
    }
    return drawRdkit(row);
  }

  function drawRdkit(row) {
    const match = state.smartsMatches.get(Number(row.index));
    const key = `${row.index}|${row.smiles || ''}|${hash(row.molblock || '')}|${state.smarts}|${match ? `${match.atoms.join(',')}:${match.bonds.join(',')}` : ''}`;
    if (state.svgCache.has(key)) return state.svgCache.get(key);
    let mol = null;
    let html = '';
    try {
      mol = state.rdkit.get_mol(row.molblock || row.smiles || '');
      if (!mol || (typeof mol.is_valid === 'function' && !mol.is_valid())) throw new Error('invalid molecule');
      try {
        try { mol.set_new_coords?.(); } catch (_) {}
        html = match && typeof mol.get_svg_with_highlights === 'function'
          ? mol.get_svg_with_highlights(JSON.stringify({
              atoms: match.atoms,
              bonds: match.bonds,
              width: RDKIT_SVG_SIZE,
              height: RDKIT_SVG_SIZE
            }))
          : mol.get_svg(RDKIT_SVG_SIZE, RDKIT_SVG_SIZE);
      } catch (_) {
        html = mol.get_svg();
      }
      html = sanitizeSVG(String(html || ''));
      html = stripSVGClipping(html);
      html = padSVGViewBox(html, 52);
      if (!html.includes('<svg')) throw new Error('empty drawing');
    } catch (error) {
      const label = row.smiles || row.name || 'Molecule';
      const denseClass = String(label).length > 36 ? ' buret-molecule-error-dense' : '';
      html = `<div class="buret-molecule-error${denseClass}"><strong>${escapeHTML(label)}</strong><span>${escapeHTML(error.message || String(error))}</span></div>`;
    } finally {
      try { mol?.delete?.(); } catch {}
    }
    state.svgCache.set(key, html);
    while (state.svgCache.size > 360) state.svgCache.delete(state.svgCache.keys().next().value);
    return html;
  }

  function stripSVGClipping(svg) {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return svg;
    for (const node of [...doc.querySelectorAll('clipPath, mask')]) node.remove();
    for (const node of [...doc.querySelectorAll('*')]) {
      node.removeAttribute('clip-path');
      node.removeAttribute('mask');
    }
    return new XMLSerializer().serializeToString(doc.documentElement);
  }

  function padSVGViewBox(svg, padding) {
    return String(svg || '').replace(/<svg\b([^>]*)>/i, (tag, attrs) => {
      let next = tag;
      if (!/\sdata-buret-rdkit-svg=/i.test(attrs)) {
        next = next.replace('<svg', '<svg data-buret-rdkit-svg="true"');
      }
      if (!/\spreserveAspectRatio=/i.test(attrs)) {
        next = next.replace('<svg', '<svg preserveAspectRatio="xMidYMid meet"');
      }
      return next.replace(/viewBox="([^"]+)"/i, (_match, value) => {
        const parts = value.trim().split(/\s+/).map(Number);
        if (parts.length !== 4 || parts.some(part => !Number.isFinite(part))) return _match;
        const [x, y, width, height] = parts;
        return `viewBox="${x - padding} ${y - padding} ${width + padding * 2} ${height + padding * 2}"`;
      });
    });
  }

  function fitCardSVGs(card) {
    card.querySelectorAll('svg[data-buret-rdkit-svg="true"]').forEach(svg => fitSVGToContent(svg));
  }

  function fitRenderedGridSVGs() {
    root.querySelectorAll('svg[data-buret-rdkit-svg="true"]').forEach(svg => fitSVGToContent(svg));
  }

  function fitSVGToContent(svg) {
    const bounds = contentBounds(svg) || svgBounds(svg);
    if (!bounds) return;
    const width = bounds.x2 - bounds.x1;
    const height = bounds.y2 - bounds.y1;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    const size = Math.max(width, height);
    const padding = Math.max(SVG_FIT_MIN_PADDING, size * SVG_FIT_PADDING_FRACTION);
    const bottomPadding = padding * SVG_FIT_BOTTOM_PADDING_MULTIPLIER;
    const centerX = bounds.x1 + width / 2;
    const viewSize = Math.max(width + padding * 2, height + padding + bottomPadding);
    const baseCenterY = bounds.y1 + height / 2 + (bottomPadding - padding) / 2;
    const maxSafeBias = Math.max(0, bounds.y1 - padding + viewSize / 2 - baseCenterY);
    const centerY = baseCenterY + Math.min(viewSize * SVG_FIT_VERTICAL_BIAS_FRACTION, maxSafeBias);
    svg.setAttribute('viewBox', `${centerX - viewSize / 2} ${centerY - viewSize / 2} ${viewSize} ${viewSize}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.removeAttribute('width');
    svg.removeAttribute('height');
  }

  function svgBounds(svg) {
    let box = null;
    try { box = svg.getBBox(); } catch (_) {}
    if (!box || !Number.isFinite(box.width) || !Number.isFinite(box.height)) return null;
    if (box.width <= 0 || box.height <= 0) return null;
    return {
      x1: box.x,
      y1: box.y,
      x2: box.x + box.width,
      y2: box.y + box.height
    };
  }

  function contentBounds(svg) {
    const content = svg.querySelectorAll('path, line, circle, ellipse, polygon, polyline, text');
    let bounds = null;
    content.forEach(node => {
      const next = transformedNodeBounds(node, svg);
      if (!next) return;
      bounds = bounds
        ? {
            x1: Math.min(bounds.x1, next.x1),
            y1: Math.min(bounds.y1, next.y1),
            x2: Math.max(bounds.x2, next.x2),
            y2: Math.max(bounds.y2, next.y2)
          }
        : next;
    });
    return bounds;
  }

  function transformedNodeBounds(node, svg) {
    let box = null;
    let matrix = null;
    try {
      box = node.getBBox();
      const svgMatrix = svg.getCTM();
      const nodeMatrix = node.getCTM();
      matrix = svgMatrix && nodeMatrix ? svgMatrix.inverse().multiply(nodeMatrix) : null;
    } catch (_) {}
    if (!box || !matrix || !Number.isFinite(box.width) || !Number.isFinite(box.height)) return null;
    if (box.width <= 0 && box.height <= 0) return null;
    const corners = [
      new DOMPoint(box.x, box.y),
      new DOMPoint(box.x + box.width, box.y),
      new DOMPoint(box.x, box.y + box.height),
      new DOMPoint(box.x + box.width, box.y + box.height)
    ].map(point => point.matrixTransform(matrix));
    const xs = corners.map(point => point.x).filter(Number.isFinite);
    const ys = corners.map(point => point.y).filter(Number.isFinite);
    if (xs.length !== 4 || ys.length !== 4) return null;
    return {
      x1: Math.min(...xs),
      y1: Math.min(...ys),
      x2: Math.max(...xs),
      y2: Math.max(...ys)
    };
  }

  function drawXyzrenderFallback(row, error) {
    const fallback = drawRdkit(row);
    if (fallback.includes('buret-molecule-error')) return fallback;
    return `<div class="buret-molecule-fallback" title="${escapeAttr(`xyzrender failed: ${error?.message || String(error)}`)}">${fallback}</div>`;
  }

  function renderXyzrenderCard(row, picture, cfg) {
    const key = xyzrenderCardKey(row);
    picture.dataset.xyzrenderKey = key;
    const cached = state.xyzrenderCardCache.get(key);
    if (cached) {
      picture.innerHTML = cached;
      return;
    }
    const existing = state.xyzrenderCardRequests.get(key);
    const request = existing || enqueueXyzrenderCard(row, cfg)
      .then(html => {
        state.xyzrenderCardCache.set(key, html);
        while (state.xyzrenderCardCache.size > 180) state.xyzrenderCardCache.delete(state.xyzrenderCardCache.keys().next().value);
        return html;
      })
      .catch(error => drawXyzrenderFallback(row, error))
      .finally(() => {
        state.xyzrenderCardRequests.delete(key);
      });
    if (!existing) state.xyzrenderCardRequests.set(key, request);
    request.then(html => {
      if (picture.dataset.xyzrenderKey === key && state.cardRenderer === 'xyzrender') {
        picture.innerHTML = html;
      }
    });
  }

  function enqueueXyzrenderCard(row, cfg) {
    return new Promise((resolve, reject) => {
      state.xyzrenderCardQueue.push({ row, cfg, resolve, reject });
      pumpXyzrenderCardQueue();
    });
  }

  function pumpXyzrenderCardQueue() {
    while (state.xyzrenderCardActive < XYZRENDER_CARD_CONCURRENCY && state.xyzrenderCardQueue.length) {
      const task = state.xyzrenderCardQueue.shift();
      state.xyzrenderCardActive += 1;
      requestXyzrenderCard(task.row, task.cfg)
        .then(task.resolve, task.reject)
        .finally(() => {
          state.xyzrenderCardActive = Math.max(0, state.xyzrenderCardActive - 1);
          pumpXyzrenderCardQueue();
        });
    }
  }

  async function requestXyzrenderCard(row, cfg) {
    const input = xyzrenderInputForRow(row);
    const response = await fetch(String(cfg.xyzrenderEndpoint || '/__burette/xyzrender'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: `${slug(row.name || `molecule-${Number(row.index) + 1}`)}.${input.extension}`,
        inputExtension: input.extension,
        inputDataBase64: bytesToBase64(new TextEncoder().encode(input.text)),
        preset: state.xyzrenderPreset,
        controls: state.xyzrenderControls
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(typeof payload?.error === 'string' ? payload.error : `xyzrender request failed with status ${response.status}`);
    }
    if (typeof payload?.svg !== 'string' || !payload.svg.trim()) {
      throw new Error('xyzrender endpoint returned no SVG payload');
    }
    return sanitizeSVG(payload.svg);
  }

  function xyzrenderInputForRow(row) {
    if (row.molblock) {
      const text = String(row.molblock).trimEnd();
      return { extension: 'sdf', text: text.endsWith('$$$$') ? `${text}\n` : `${text}\n$$$$\n` };
    }
    const text = molblockForRow(row).trimEnd();
    return { extension: 'sdf', text: text.endsWith('$$$$') ? `${text}\n` : `${text}\n$$$$\n` };
  }

  function molblockForRow(row) {
    const smiles = String(row.smiles || '').trim();
    if (!smiles) throw new Error('No SDF molblock or SMILES data for xyzrender.');
    const key = `${row.index}|${smiles}`;
    const cached = state.molblockCache.get(key);
    if (cached) return cached;
    if (!state.rdkit || typeof state.rdkit.get_mol !== 'function') {
      throw new Error('RDKit is not ready to prepare xyzrender input.');
    }
    let mol = null;
    try {
      mol = state.rdkit.get_mol(smiles);
      if (!mol || (typeof mol.is_valid === 'function' && !mol.is_valid())) throw new Error('invalid molecule');
      const molblock = String(
        typeof mol.get_molblock === 'function'
          ? mol.get_molblock()
          : typeof mol.get_v3Kmolblock === 'function'
            ? mol.get_v3Kmolblock()
            : ''
      ).trim();
      if (!molblock) throw new Error('RDKit returned no molblock.');
      state.molblockCache.set(key, molblock);
      while (state.molblockCache.size > 360) state.molblockCache.delete(state.molblockCache.keys().next().value);
      return molblock;
    } finally {
      try { mol?.delete?.(); } catch {}
    }
  }

  function xyzrenderCardKey(row) {
    return [
      row.index,
      row.smiles || '',
      hash(row.molblock || ''),
      state.xyzrenderPreset,
      JSON.stringify(state.xyzrenderControls)
    ].join('|');
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    }
    return btoa(binary);
  }

  function slug(value) {
    const normalized = String(value || 'molecule').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return normalized || 'molecule';
  }

  function metadata(row) {
    const entries = Object.entries(row.props || {}).filter(([, value]) => String(value || '').length).slice(0, 6);
    if (!entries.length) return '<div class="buret-no-metadata">No metadata</div>';
    return `<dl class="buret-metadata">${entries.map(([key, value]) => `<dt>${escapeHTML(key)}</dt><dd>${escapeHTML(value)}</dd>`).join('')}</dl>`;
  }

  function selectedOrFiltered() {
    const pool = state.remoteMode ? state.rows : state.all;
    return state.selected.size ? pool.filter(row => state.selected.has(Number(row.index))) : state.rows;
  }

  function shouldCollectAllRemoteRows() {
    return state.remoteMode && state.selected.size === 0 && !state.smarts.trim();
  }

  async function copySelected() {
    const sourceRows = shouldCollectAllRemoteRows() ? await collectAllRemoteRows(config()) : selectedOrFiltered();
    const text = sourceRows.map(row => `${row.smiles || ''}\t${row.name || ''}`.trim()).join('\n');
    if (canUseNativeBridge()) {
      post('copyText', '[grid] Copy selected molecules.', { text });
      setStatus('[grid] Copy requested.');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setStatus('[grid] Copied molecules.');
    } catch (_) {
      setStatus('Clipboard is unavailable in this WebView.', 'error');
    }
  }

  async function exportSmiles(cfg) {
    const rows = shouldCollectAllRemoteRows() ? await collectAllRemoteRows(cfg) : selectedOrFiltered();
    const text = rows
      .map(row => `${row.smiles || ''}\t${row.name || `mol_${Number(row.index) + 1}`}`.trim())
      .filter(Boolean)
      .join('\n') + '\n';
    download(text, baseName(cfg.label) + '.smi', 'chemical/x-daylight-smiles');
  }

  async function exportCSV(cfg) {
    const rows = shouldCollectAllRemoteRows() ? await collectAllRemoteRows(cfg) : selectedOrFiltered();
    const props = [...new Set(rows.flatMap(row => Object.keys(row.props || {})))];
    const data = [
      ['index', 'name', 'smiles', ...props],
      ...rows.map(row => [row.index, row.name || '', row.smiles || '', ...props.map(prop => (row.props || {})[prop] || '')])
    ];
    download(data.map(row => row.map(csv).join(',')).join('\n') + '\n', baseName(cfg.label) + '.csv', 'text/csv');
  }

  function download(text, name, type) {
    if (canUseNativeBridge()) {
      post('exportText', `[grid] Export ${name}.`, { text, name, mimeType: type });
      setStatus(`[grid] Export requested: ${name}`);
      return;
    }
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
  }

  function csv(value) {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function baseName(value) {
    return String(value || 'molecules').replace(/\.[^.]+$/, '').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 80) || 'molecules';
  }

  async function collectAllRemoteRows(cfg) {
    if (!state.remoteMode) return state.rows;
    if (state.rows.length >= state.totalRows && state.totalRows > 0) return state.rows.slice();
    const rows = [];
    let offset = 0;
    let total = null;
    const limit = Math.max(120, loadBatchSize(cfg));
    setStatus('[grid] Preparing export...');
    while (total === null || offset < total) {
      const result = await hostRequest('gridFetchPage', {
        query: state.query || '',
        sort: state.sort || 'index',
        offset,
        limit
      });
      const pageRows = Array.isArray(result.rows) ? result.rows : [];
      total = Number(result.totalRows || 0);
      rows.push(...pageRows);
      offset += pageRows.length;
      if (!pageRows.length) break;
      setStatus(`[grid] Preparing export ${Math.min(offset, total).toLocaleString()} / ${total.toLocaleString()} rows...`);
    }
    return rows;
  }

  function normalize(value) {
    return String(value || '').toLowerCase().normalize('NFKD');
  }

  function hash(value) {
    let h = 0;
    for (let i = 0; i < value.length; i++) h = ((h << 5) - h + value.charCodeAt(i)) | 0;
    return h >>> 0;
  }

  function canUseNativeBridge() {
    return !!window.webkit?.messageHandlers?.burrete;
  }

  function sanitizeSVG(svg) {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return '';
    for (const node of [...doc.querySelectorAll('script, foreignObject')]) node.remove();
    for (const node of [...doc.querySelectorAll('*')]) {
      for (const attr of [...node.attributes]) {
        const name = attr.name.toLowerCase();
        const value = String(attr.value || '').trim().toLowerCase();
        if (name.startsWith('on') || value.startsWith('javascript:')) node.removeAttribute(attr.name);
      }
    }
    return new XMLSerializer().serializeToString(doc.documentElement);
  }

  function escapeHTML(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHTML(value).replace(/`/g, '&#96;');
  }

  async function main() {
    try {
      const cfg = config();
      state.remoteMode = isRemoteMode(cfg);
      state.totalRows = state.remoteMode ? 0 : state.all.length;
      applyTheme(cfg);
      installThemeListener(cfg);
      installHostMessageListener();
      buildUI(cfg);
      await initRDKit();
      refresh(cfg);
    } catch (error) {
      const message = error && error.stack ? error.stack : String(error);
      setStatus(message, 'error');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main, { once: true });
  else main();
})();
