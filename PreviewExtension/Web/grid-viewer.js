(() => {
  'use strict';

  const root = document.getElementById('app');
  const status = document.getElementById('status');
  const CARD_MIN_STORAGE_KEY = 'buret.grid.cardMin';
  const CARD_RENDERER_STORAGE_KEY = 'buret.grid.cardRenderer';
  const RDKIT_USE_INPUT_COORDS_STORAGE_KEY = 'buret.grid.rdkitUseInputCoords';
  const MIN_CARD_MIN = 86;
  const MAX_CARD_MIN = 360;
  const DEFAULT_CARD_MIN = 174;
  const RDKIT_SVG_SIZE = 260;
  const SVG_FIT_MIN_PADDING = 12;
  const SVG_FIT_PADDING_FRACTION = 0.08;
  const XYZRENDER_CARD_CONCURRENCY = 4;
  const RDKIT_CARD_ROOT_MARGIN = '900px 0px';
  const XYZRENDER_CARD_ROOT_MARGIN = '720px 0px';
  const STRUCTURE_DRAG_MIME = 'application/x-burrete-structure-paths';
  const state = {
    rdkit: null,
    rdkitError: '',
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
    cardRenderer: storedCardRenderer(),
    rdkitUseInputCoords: storedBoolean(RDKIT_USE_INPUT_COORDS_STORAGE_KEY, false),
    cardMin: storedOptionalInteger(CARD_MIN_STORAGE_KEY, MIN_CARD_MIN, MAX_CARD_MIN),
    hiddenRows: new Set(),
    selected: new Set(),
    selectionAnchorIndex: null,
    selectionKeydownHandler: null,
    svgCache: new Map(),
    rdkitCardQueue: [],
    rdkitCardRendering: false,
    rdkitCardPending: new Map(),
    rdkitCardSeq: 0,
    rdkitCardObserver: null,
    rdkitCardLazyJobs: new WeakMap(),
    xyzrenderCardCache: new Map(),
    xyzrenderCardQueue: [],
    xyzrenderCardsRunning: 0,
    xyzrenderCardSeq: 0,
    xyzrenderCardObserver: null,
    xyzrenderCardLazyJobs: new WeakMap(),
    hostRequests: new Map(),
    remoteMode: false,
    remoteLoading: false,
    requestSeq: 0,
    token: 0,
    rendering: false,
    pendingLoad: false,
    loadObserver: null,
    scrollHandler: null,
    contextMenuOutsideHandler: null,
    contextMenuKeyHandler: null,
    railOutsideHandler: null,
    railKeyHandler: null,
    railCloseTimer: null,
    railHoverIndex: null,
    railDragging: false,
    pendingGridScrollIndex: null,
    pendingGridRailPosition: null
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
      rendererSwitch: cfg.appViewer === true && !!caps.rendererSwitch
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
      if (body.type === 'gridPage' || body.type === 'xyzrenderCard') pending.resolve(body.result || {});
      else if (body.type === 'xyzrenderSheetItemRendered') pending.resolve(body);
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
    let response;
    try {
      response = await fetch(String(path));
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      throw new Error(`Failed to fetch RDKit wasm from ${path}: ${message}`);
    }
    if (!response.ok) {
      throw new Error(`Failed to load RDKit wasm from ${path}: ${response.status} ${response.statusText}`.trim());
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
    const value = Number(cfg.pageSize || 48);
    return Number.isFinite(value) ? Math.max(12, Math.min(48, Math.floor(value))) : 48;
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

  function storedCardRenderer() {
    try {
      return window.localStorage?.getItem(CARD_RENDERER_STORAGE_KEY) === 'xyzrender' ? 'xyzrender' : 'rdkit';
    } catch (_) {
      return 'rdkit';
    }
  }

  function supportsXyzrenderCards(cfg) {
    return (cfg?.appViewer === true && cfg?.gridDataMode === 'bridge')
      || (typeof cfg?.xyzrenderEndpoint === 'string' && cfg.xyzrenderEndpoint.trim().length > 0);
  }

  function normalizeCardRenderer(cfg) {
    if (state.cardRenderer !== 'xyzrender' || supportsXyzrenderCards(cfg)) return;
    state.cardRenderer = 'rdkit';
    store(CARD_RENDERER_STORAGE_KEY, 'rdkit');
  }

  function storedBoolean(key, fallback) {
    try {
      const value = window.localStorage?.getItem(key);
      if (value === 'true') return true;
      if (value === 'false') return false;
      return fallback;
    } catch (_) {
      return fallback;
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
    if (background === 'white') return '#ffffff';
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
            <label class="buret-search-control buret-filter-control">
              Search
              <input id="search" type="search" aria-label="Search molecules and SMARTS" spellcheck="false" autocapitalize="off" placeholder="${caps.substructureSearch ? 'name, SMILES, metadata, SMARTS' : 'name, SMILES, metadata'}" />
            </label>
            <label class="buret-sort-control">Sort <select id="sort"><option value="index">File order</option><option value="name">Name</option><option value="smiles">SMILES</option>${propertyOptions(cfg)}</select></label>
            <div id="load-status" class="buret-load-status"></div>
          </div>
          <div class="buret-toolbar-row buret-toolbar-row-view">
            <button id="show-properties" class="buret-toggle-button" type="button" aria-pressed="false">Properties</button>
            <button id="clear-smarts" class="buret-toggle-button buret-clear-smarts" type="button" hidden>Clear search</button>
            <div class="buret-selection-actions" ${caps.selection ? '' : 'hidden'}>
              <button id="select-all" class="buret-toggle-button" type="button">Select all</button>
              <button id="clear-selection" class="buret-toggle-button" type="button">Clear selection</button>
            </div>
            <div class="buret-grid-card-renderer-switch" role="group" aria-label="Grid card renderer">
              <span>Cards</span>
              <button type="button" data-buret-grid-card-renderer="rdkit" aria-pressed="false">RDKit</button>
              ${supportsXyzrenderCards(cfg) ? '<button type="button" data-buret-grid-card-renderer="xyzrender" aria-pressed="false">xyzrender</button>' : ''}
            </div>
            ${rdkitCoordinatesControlHTML()}
            ${caps.rendererSwitch ? rendererSwitchHTML() : ''}
          </div>
        </div>
        <nav class="buret-grid-rail" data-buret-grid-rail aria-label="Molecule navigation">
          <div class="buret-grid-rail-hover-target" data-buret-grid-rail-hover-target aria-hidden="true"></div>
          <span class="buret-grid-rail-active-marker" data-buret-grid-rail-active aria-hidden="true"></span>
          <div class="buret-grid-rail-ticks" data-buret-grid-rail-ticks></div>
          <div class="buret-grid-rail-popover buret-floating-surface" data-buret-grid-rail-popover data-state="closed" role="dialog" aria-label="Molecule navigation" aria-hidden="true" hidden inert></div>
        </nav>
        <main id="grid" class="buret-grid"></main>
        <div id="load-sentinel" class="buret-load-sentinel" aria-hidden="true"></div>
        <footer id="footer" class="buret-grid-footer"></footer>
      </section>`;
    document.getElementById('search').addEventListener('input', event => {
      setUnifiedSearchQuery(event.target.value || '', cfg);
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
      state.query = '';
      state.smarts = '';
      const input = document.getElementById('search');
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
    if (root.dataset.contextMenuBound !== '1') {
      root.addEventListener('contextmenu', handleGridShellContextMenu);
      root.dataset.contextMenuBound = '1';
    }
    initRdkitCoordinatesControl(cfg);
    if (state.selectionKeydownHandler) {
      document.removeEventListener('keydown', state.selectionKeydownHandler);
    }
    state.selectionKeydownHandler = event => handleGridSelectionKeydown(event, cfg);
    document.addEventListener('keydown', state.selectionKeydownHandler);
    applyGridPreferences();
    initGridRail(cfg);
    initInfiniteLoading(cfg);
  }

  function applyGridPreferences() {
    document.body.classList.add('buret-grid-size-compact');
    document.body.classList.toggle('buret-hide-properties', !state.showProperties);
    if (state.cardMin == null) {
      document.body.classList.remove('buret-grid-manual-size');
      document.documentElement.style.removeProperty('--buret-card-effective-min');
      document.documentElement.style.removeProperty('--buret-card-min');
    } else {
      document.body.classList.add('buret-grid-manual-size');
      document.documentElement.style.setProperty('--buret-card-effective-min', `${state.cardMin}px`);
      document.documentElement.style.setProperty('--buret-card-min', `${state.cardMin}px`);
    }
    const propertiesToggle = document.getElementById('show-properties');
    if (propertiesToggle) {
      propertiesToggle.classList.toggle('active', state.showProperties);
      propertiesToggle.setAttribute('aria-pressed', state.showProperties ? 'true' : 'false');
    }
    syncCardRendererSwitch();
    syncRdkitCoordinatesControl();
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
    return `
      <div class="buret-grid-renderer-controls">
        <div class="buret-grid-renderer-switch" aria-label="3D renderer">
          <button type="button" data-buret-grid-renderer="molstar" data-buret-grid-sdf-poses data-buret-grid-docking>Poses</button>
        </div>
      </div>`;
  }

  function rdkitCoordinatesControlHTML() {
    return `
      <label id="rdkit-use-input-coords-control" class="buret-rdkit-coords-control" hidden>
        <input id="rdkit-use-input-coords" type="checkbox" />
        <span>Use file coords</span>
      </label>`;
  }

  function setCardRenderer(value, cfg) {
    const next = value === 'xyzrender' && supportsXyzrenderCards(cfg) ? 'xyzrender' : 'rdkit';
    if (state.cardRenderer === next) return;
    state.cardRenderer = next;
    store(CARD_RENDERER_STORAGE_KEY, next);
    syncCardRendererSwitch();
    syncRdkitCoordinatesControl();
    render(cfg);
  }

  function syncCardRendererSwitch() {
    document.body.dataset.buretGridCardRenderer = state.cardRenderer;
    root.querySelectorAll('[data-buret-grid-card-renderer]').forEach(button => {
      const active = button.getAttribute('data-buret-grid-card-renderer') === state.cardRenderer;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function initRdkitCoordinatesControl(cfg) {
    const input = document.getElementById('rdkit-use-input-coords');
    if (!input) return;
    input.checked = state.rdkitUseInputCoords;
    input.addEventListener('change', event => {
      state.rdkitUseInputCoords = event.target.checked === true;
      store(RDKIT_USE_INPUT_COORDS_STORAGE_KEY, state.rdkitUseInputCoords ? 'true' : 'false');
      state.svgCache.clear();
      render(cfg);
    });
    syncRdkitCoordinatesControl();
  }

  function syncRdkitCoordinatesControl() {
    const control = document.getElementById('rdkit-use-input-coords-control');
    const input = document.getElementById('rdkit-use-input-coords');
    if (!control || !input) return;
    control.hidden = state.cardRenderer !== 'rdkit' || !hasInputCoordinateRows();
    input.checked = state.rdkitUseInputCoords;
  }

  function hasInputCoordinateRows() {
    const rows = state.rows.length ? state.rows : state.all;
    return rows.some(row => hasMolblockInputCoordinates(row.molblock));
  }

  function requestRendererSwitch(renderer, cfg) {
    const value = normalizeRenderer(renderer);
    if (value === 'molstar') {
      requestSdfPoseDocument(cfg);
      return;
    }
    post('setRenderer', `[grid] Switch renderer to ${value}.`, {
      value,
      documentId: cfg?.documentId || null
    });
  }

  function requestSdfPoseDocument(cfg) {
    const sourcePath = String(cfg?.sourcePath || '').trim();
    const receptorPath = String(cfg?.dockingReceptorPath || '').trim();
    post('openSdfPoseDocument', '[grid] Open SDF poses in Mol*.', {
      documentId: cfg?.documentId || null,
      path: sourcePath || null,
      receptorPath: receptorPath || null
    });
  }

  function requestOpenInKetcher(row, cfg) {
    const record = gridDragRecord(row);
    const label = row?.name || `Molecule ${Number(row?.index) + 1 || 1}`;
    if (!record) {
      setStatus(`[grid] ${label} has no structure data for Ketcher.`, 'error');
      return;
    }
    post('openInKetcher', `[grid] Open ${label} in Ketcher.`, {
      title: record.path,
      extension: record.inputExtension,
      textBase64: textToBase64(ketcherFragmentText(record)),
      documentId: cfg?.documentId || null
    });
  }

  function ketcherFragmentText(record) {
    const text = String(record?.text || '').trim();
    const extension = String(record?.inputExtension || '').toLowerCase();
    if (extension === 'sdf' || extension === 'sd') {
      return text.replace(/\n?\$\$\$\$\s*$/u, '').trimEnd() + '\n';
    }
    return text;
  }

  function xyzrenderFragmentText(record) {
    const text = String(record?.text || '').trim();
    const extension = String(record?.inputExtension || '').toLowerCase();
    if (extension === 'smi' || extension === 'smiles') {
      const firstLine = text.split(/\r?\n/u).find(line => line.trim()) || '';
      const smiles = firstLine.trim().split(/\s+/u)[0] || '';
      return smiles ? `${smiles}\n` : text;
    }
    return text;
  }

  function normalizeRenderer(renderer) {
    const value = String(renderer || 'molstar').toLowerCase();
    return value === 'xyzrender-external' || value === 'xyzrender' ? 'xyzrender-external' : 'molstar';
  }

  function queryLooksLikeExplicitSMARTS(value) {
    const text = String(value || '').trim();
    return !!text && !/\s/u.test(text) && /[\[\]#@:+\\/$()=~!;]/u.test(text);
  }

  function queryLooksLikeSMILESFragment(value) {
    const text = String(value || '').trim();
    if (!text || /\s/u.test(text) || queryLooksLikeExplicitSMARTS(text)) return false;
    const withoutAtomsAndBonds = text.replace(/Cl|Br|[BCNOFPSIbcHnops]|\d|%[0-9]{2}|[.=#\-+:\\/\\\\@*]/gu, '');
    return withoutAtomsAndBonds === '' && /Cl|Br|[BCNOFPSIbcHnops]/u.test(text);
  }

  function queryLooksLikeSMARTS(value) {
    return queryLooksLikeExplicitSMARTS(value) || queryLooksLikeSMILESFragment(value);
  }

  function shouldFallbackSMARTSToTextSearch() {
    return !!state.smartsError && !!state.smarts.trim() && !queryLooksLikeExplicitSMARTS(state.query);
  }

  function setUnifiedSearchQuery(value, cfg) {
    state.query = value || '';
    state.smarts = capabilities(cfg).substructureSearch && queryLooksLikeSMARTS(value) ? value || '' : '';
  }

  function refresh(cfg) {
    if (state.remoteMode) {
      void refreshRemote(cfg);
      return;
    }
    const query = state.smarts.trim() ? '' : normalize(state.query);
    const allRows = state.all.filter(row => !state.hiddenRows.has(Number(row.index)));
    const textRows = query
      ? allRows.filter(row => normalize([row.name, row.smiles, ...Object.entries(row.props || {}).flat()].join('\n')).includes(query))
      : allRows.slice();
    state.rows = filterBySMARTS(textRows);
    if (shouldFallbackSMARTSToTextSearch()) {
      const fallbackQuery = normalize(state.query);
      state.smartsError = '';
      state.smartsMatches = new Map();
      state.rows = fallbackQuery
        ? allRows.filter(row => normalize([row.name, row.smiles, ...Object.entries(row.props || {}).flat()].join('\n')).includes(fallbackQuery))
        : allRows.slice();
    }
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
    resetRdkitCardObserver();
    resetXyzrenderCardObserver();
    resetCardRenderQueues();
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
        if (!shouldFallbackSMARTSToTextSearch()) {
          state.rows = matches;
          state.totalRows = matches.length;
          state.visibleCount = Math.min(loadBatchSize(cfg), state.rows.length);
          await appendVisibleRows(cfg, token);
          return;
        }
        state.smartsError = '';
        state.smartsMatches = new Map();
      }
      const result = await hostRequest('gridFetchPage', {
        query: state.query || '',
        sort: state.sort || 'index',
        offset: 0,
        limit: loadBatchSize(cfg)
      });
      if (token !== state.token) return;
      state.rows = filterHiddenRows(Array.isArray(result.rows) ? result.rows : []);
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
          query: '',
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

  function pumpXyzrenderCardQueue() {
    while (state.xyzrenderCardsRunning < XYZRENDER_CARD_CONCURRENCY && state.xyzrenderCardQueue.length) {
      state.xyzrenderCardQueue.sort(compareCardRenderJobs);
      const job = state.xyzrenderCardQueue.shift();
      state.xyzrenderCardsRunning++;
      void requestXyzrenderCard(job.row, job.cfg, job.record, job.key).finally(() => {
        state.xyzrenderCardsRunning--;
        pumpXyzrenderCardQueue();
      });
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
      const nextRows = filterHiddenRows(Array.isArray(result.rows) ? result.rows : []);
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

  function filterHiddenRows(rows) {
    return rows.filter(row => !state.hiddenRows.has(Number(row.index)));
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
        scheduleRdkitCard(nextCard, row);
        scheduleXyzrenderCard(nextCard, row, cfg);
        state.renderedCount++;
        if (state.renderedCount % 8 === 0) await new Promise(resolve => requestAnimationFrame(resolve));
      }
      updateChrome(cfg);
      scrollPendingGridRow();
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
    if (clearSMARTS) clearSMARTS.hidden = !state.query.trim();
    const searchInput = document.getElementById('search');
    if (searchInput) searchInput.classList.toggle('invalid', !!state.smartsError);
    const selectableIndexes = selectableRowIndexes();
    const allCurrentSelected = selectableIndexes.length > 0 && selectableIndexes.every(index => state.selected.has(index));
    const selectAllButton = document.getElementById('select-all');
    if (selectAllButton) selectAllButton.disabled = selectableIndexes.length === 0 || allCurrentSelected;
    const clearSelectionButton = document.getElementById('clear-selection');
    if (clearSelectionButton) clearSelectionButton.disabled = state.selected.size === 0;
    document.getElementById('footer').textContent = state.smartsError
      ? `SMARTS error: ${state.smartsError}`
      : (total > included && !state.remoteMode
        ? `Showing first ${included.toLocaleString()} of ${total.toLocaleString()} records.`
        : (hasMoreRows()
          ? `Scroll to load more. ${state.renderedCount.toLocaleString()} of ${visible.toLocaleString()} visible molecules are rendered.`
          : (state.remoteMode
            ? 'Desktop grid runtime is loading rows on demand.'
            : (state.cardRenderer === 'xyzrender'
              ? 'External xyzrender card rendering.'
              : 'Offline RDKit.js rendering. No network access required.'))));
    updateGridRail();
  }

  function initGridRail(cfg) {
    const rail = root.querySelector('[data-buret-grid-rail]');
    const hoverTarget = root.querySelector('[data-buret-grid-rail-hover-target]');
    const marker = root.querySelector('[data-buret-grid-rail-active]');
    const ticks = root.querySelector('[data-buret-grid-rail-ticks]');
    const popover = root.querySelector('[data-buret-grid-rail-popover]');
    if (!rail || !ticks || !popover) return;
    ticks.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target.closest('[data-buret-grid-rail-position], [data-buret-grid-rail-index]') : null;
      if (!target) return;
      const position = Number(target.getAttribute('data-buret-grid-rail-position'));
      const index = Number(target.getAttribute('data-buret-grid-rail-index'));
      setGridRailOpen(false);
      if (Number.isFinite(position)) scrollToGridPosition(position, cfg);
      else scrollToGridRow(index, cfg);
    });
    if (state.railOutsideHandler) {
      document.removeEventListener('click', state.railOutsideHandler, true);
      window.removeEventListener('scroll', state.railOutsideHandler, true);
      window.removeEventListener('resize', state.railOutsideHandler, true);
      state.railOutsideHandler = null;
    }
    if (state.railKeyHandler) {
      document.removeEventListener('keydown', state.railKeyHandler);
      state.railKeyHandler = null;
    }
    state.railOutsideHandler = event => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest?.('[data-buret-grid-rail]')) return;
      setGridRailOpen(false);
    };
    state.railKeyHandler = event => {
      if (event.key !== 'Escape' || popover.dataset.state !== 'open') return;
      setGridRailOpen(false);
    };
    document.addEventListener('click', state.railOutsideHandler, true);
    document.addEventListener('keydown', state.railKeyHandler);
    marker?.addEventListener('pointerdown', event => startGridRailDrag(event, cfg));
    hoverTarget?.addEventListener('click', () => setGridRailOpen(true));
    popover.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target.closest('[data-buret-grid-rail-index]') : null;
      if (!target) return;
      const index = Number(target.getAttribute('data-buret-grid-rail-index'));
      scrollToGridRow(index, cfg);
      setGridRailOpen(false);
    });
    popover.addEventListener('pointerdown', event => {
      if (event.button != null && event.button !== 0) return;
      const target = event.target instanceof Element ? event.target.closest('[data-buret-grid-rail-index]') : null;
      if (!target || !popover.contains(target)) return;
      event.preventDefault();
      event.stopPropagation();
      const index = Number(target.getAttribute('data-buret-grid-rail-index'));
      state.railHoverIndex = index;
      updateGridRailHoverHighlight();
      scrollToGridRow(index, cfg);
      setGridRailOpen(false);
    });
    const handlePopoverHover = event => {
      if (event.buttons) return;
      const target = event.target instanceof Element ? event.target.closest('[data-buret-grid-rail-index]') : null;
      if (!target || !popover.contains(target)) return;
      const index = Number(target.getAttribute('data-buret-grid-rail-index'));
      if (state.railHoverIndex === index) return;
      state.railHoverIndex = index;
      updateGridRailHoverHighlight();
      scrollToGridRow(index, cfg);
    };
    popover.addEventListener('pointerover', handlePopoverHover);
    popover.addEventListener('pointermove', handlePopoverHover);
    popover.addEventListener('mouseover', handlePopoverHover);
    popover.addEventListener('mousemove', handlePopoverHover);
    window.addEventListener('scroll', updateGridRailActive, { passive: true });
    window.addEventListener('resize', updateGridRailActive, { passive: true });
    updateGridRail();
  }

  function setGridRailOpen(open) {
    if (state.railCloseTimer) {
      clearTimeout(state.railCloseTimer);
      state.railCloseTimer = null;
    }
    const ticks = root.querySelector('[data-buret-grid-rail-ticks]');
    const popover = root.querySelector('[data-buret-grid-rail-popover]');
    if (!ticks || !popover) return;
    ticks.dataset.open = open ? 'true' : 'false';
    popover.dataset.state = open ? 'open' : 'closed';
    popover.setAttribute('aria-hidden', open ? 'false' : 'true');
    popover.hidden = !open;
    popover.inert = !open;
    if (!open) {
      state.railHoverIndex = null;
      updateGridRailHoverHighlight();
    }
    if (open) updateGridRailActive();
  }

  function updateGridRail() {
    const rail = root.querySelector('[data-buret-grid-rail]');
    const ticks = root.querySelector('[data-buret-grid-rail-ticks]');
    const popover = root.querySelector('[data-buret-grid-rail-popover]');
    if (!rail || !ticks || !popover) return;
    const rows = state.rows || [];
    rail.hidden = gridRailTotalRows() < 2;
    if (rail.hidden) return;
    const wasOpen = popover.dataset.state === 'open';
    const list = popover.querySelector('.buret-grid-rail-popover-list');
    const listScrollTop = wasOpen && list ? list.scrollTop : 0;
    const railRows = gridRailRows(rows);
    ticks.innerHTML = railRows.map(({ row, position, active }) => {
      const index = row ? Number(row.index) : null;
      const title = escapeAttr(row?.name || `Molecule ${position + 1}`);
      const indexAttr = Number.isFinite(index) ? ` data-buret-grid-rail-index="${index}"` : '';
      return `<button type="button" class="buret-grid-rail-tick${active ? ' is-active' : ''}" data-buret-grid-rail-position="${position}"${indexAttr} title="${title}" aria-label="${title}"></button>`;
    }).join('');
    popover.innerHTML = `
      <div class="buret-grid-rail-popover-title" id="buret-grid-rail-popover-title">Molecules</div>
      <div class="buret-grid-rail-popover-list" role="listbox" aria-labelledby="buret-grid-rail-popover-title">
        ${rows.map(row => {
          const index = Number(row.index);
          const name = escapeHTML(row.name || `Molecule ${index + 1}`);
          const detail = escapeHTML(row.smiles || `#${index + 1}`);
          return `<button type="button" class="buret-grid-rail-popover-row" role="option" aria-selected="false" data-buret-grid-rail-index="${index}"><span>${name}</span><small>${detail}</small></button>`;
        }).join('')}
      </div>`;
    if (wasOpen && list) {
      const nextList = popover.querySelector('.buret-grid-rail-popover-list');
      if (nextList) nextList.scrollTop = listScrollTop;
    }
    updateGridRailActive();
  }

  function gridRailRows(rows) {
    const total = gridRailTotalRows();
    const limit = 96;
    if (total <= limit) {
      return Array.from({ length: total }, (_, position) => ({ row: rows[position] || null, position, active: false }));
    }
    const step = total / limit;
    const sampled = [];
    for (let i = 0; i < limit; i++) {
      const position = Math.min(total - 1, Math.floor(i * step));
      sampled.push({ row: rows[position] || null, position, active: false });
    }
    return sampled;
  }

  function gridRailTotalRows() {
    return state.remoteMode ? Math.max(state.totalRows, state.rows.length) : state.rows.length;
  }

  function updateGridRailActive() {
    const cards = [...document.querySelectorAll('.buret-card[data-index]')];
    if (!cards.length) return;
    const threshold = Math.max(96, window.innerHeight * 0.24);
    let activeIndex = Number(cards[0].getAttribute('data-index'));
    for (const card of cards) {
      if (card.getBoundingClientRect().top <= threshold) activeIndex = Number(card.getAttribute('data-index'));
      else break;
    }
    updateGridRailActiveMarker(activeIndex);
    root.querySelectorAll('.buret-grid-rail-popover-row[data-buret-grid-rail-index]').forEach(item => {
      const active = Number(item.getAttribute('data-buret-grid-rail-index')) === activeIndex;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    updateGridRailHoverHighlight();
  }

  function updateGridRailActiveMarker(activeIndex) {
    const marker = root.querySelector('[data-buret-grid-rail-active]');
    const ticks = root.querySelector('[data-buret-grid-rail-ticks]');
    const rows = state.rows || [];
    const total = gridRailTotalRows();
    if (!marker || !ticks || total < 2 || !Number.isFinite(activeIndex)) {
      if (marker) marker.hidden = true;
      return;
    }
    let rowPosition = rows.findIndex(row => Number(row.index) === activeIndex);
    if (rowPosition < 0) {
      rowPosition = rows.reduce((nearest, row, position) => {
        return Math.abs(Number(row.index) - activeIndex) < Math.abs(Number(rows[nearest].index) - activeIndex) ? position : nearest;
      }, 0);
    }
    const ticksRect = ticks.getBoundingClientRect();
    const height = ticksRect.height || Math.min(window.innerHeight * 0.58, 420);
    const progress = rowPosition / Math.max(1, total - 1);
    const offset = (progress - 0.5) * height;
    marker.hidden = false;
    marker.style.setProperty('--buret-grid-rail-active-offset', `${offset.toFixed(2)}px`);
  }

  function updateGridRailHoverHighlight() {
    root.querySelectorAll('.buret-card.buret-card-rail-hover').forEach(card => {
      const active = state.railHoverIndex != null && Number(card.getAttribute('data-index')) === state.railHoverIndex;
      card.classList.toggle('buret-card-rail-hover', active);
    });
    if (state.railHoverIndex == null) return;
    const card = root.querySelector(`.buret-card[data-index="${state.railHoverIndex}"]`);
    card?.classList.add('buret-card-rail-hover');
  }

  function scrollToGridRow(index, cfg) {
    let card = document.querySelector(`.buret-card[data-index="${index}"]`);
    if (card) {
      state.pendingGridScrollIndex = null;
      scrollGridCardIntoView(card, state.railDragging ? 'auto' : 'smooth');
      return;
    }
    if (hasMoreRows()) {
      const rowIndex = state.rows.findIndex(row => Number(row.index) === index);
      if (rowIndex >= 0) {
        state.pendingGridScrollIndex = index;
        state.visibleCount = Math.min(state.rows.length, Math.max(state.visibleCount, rowIndex + 1));
        if (state.rendering) {
          state.pendingLoad = true;
          return;
        }
        void appendVisibleRows(cfg, state.token);
      }
      return;
    }
    state.pendingGridScrollIndex = null;
  }

  async function scrollToGridPosition(position, cfg) {
    if (!Number.isFinite(position)) return;
    const total = gridRailTotalRows();
    const target = Math.max(0, Math.min(total - 1, Math.round(position)));
    if (state.remoteMode && target >= state.rows.length) {
      await loadRemoteRowsThrough(target, cfg);
    }
    const row = state.rows[target];
    if (row) scrollToGridRow(Number(row.index), cfg);
  }

  async function loadRemoteRowsThrough(position, cfg) {
    if (!state.remoteMode || state.remoteLoading) {
      state.pendingGridRailPosition = position;
      return;
    }
    const token = state.token;
    state.remoteLoading = true;
    try {
      while (token === state.token && state.rows.length <= position && state.rows.length < state.totalRows) {
        const result = await hostRequest('gridFetchPage', {
          query: state.query || '',
          sort: state.sort || 'index',
          offset: state.rows.length,
          limit: Math.max(loadBatchSize(cfg), 240)
        });
        if (token !== state.token) return;
        const nextRows = filterHiddenRows(Array.isArray(result.rows) ? result.rows : []);
        state.totalRows = Number(result.totalRows || state.totalRows);
        if (!nextRows.length) break;
        state.rows.push(...nextRows);
      }
      if (position < state.rows.length) {
        const row = state.rows[position];
        if (row) state.pendingGridScrollIndex = Number(row.index);
        state.visibleCount = Math.min(state.rows.length, Math.max(state.visibleCount, position + 1));
        if (state.rendering) {
          state.pendingLoad = true;
          return;
        }
        await appendVisibleRows(cfg, state.token);
      }
    } catch (error) {
      setStatus(error?.message || String(error), 'error');
    } finally {
      state.remoteLoading = false;
      const pending = state.pendingGridRailPosition;
      state.pendingGridRailPosition = null;
      if (pending != null && pending !== position) void scrollToGridPosition(pending, cfg);
    }
  }

  function scrollPendingGridRow() {
    if (state.pendingGridScrollIndex == null) return false;
    const card = document.querySelector(`.buret-card[data-index="${state.pendingGridScrollIndex}"]`);
    if (!card) return false;
    state.pendingGridScrollIndex = null;
    scrollGridCardIntoView(card, 'auto');
    return true;
  }

  function scrollGridCardIntoView(card, behavior = 'smooth') {
    card.scrollIntoView({ block: 'center', behavior });
    updateGridRailActive();
  }

  function startGridRailDrag(event, cfg) {
    if (event.button != null && event.button !== 0) return;
    const marker = event.currentTarget;
    const ticks = root.querySelector('[data-buret-grid-rail-ticks]');
    if (!marker || !ticks) return;
    event.preventDefault();
    event.stopPropagation();
    state.railDragging = true;
    state.railHoverIndex = null;
    updateGridRailHoverHighlight();
    document.body.classList.add('buret-grid-rail-dragging');
    const pointerId = event.pointerId;
    try { marker.setPointerCapture(pointerId); } catch (_) {}
    const updateFromPoint = clientY => {
      const position = gridRailIndexFromPointer(clientY, ticks);
      if (position == null) return;
      scrollToGridPosition(position, cfg);
    };
    updateFromPoint(event.clientY);
    const onMove = moveEvent => {
      if (moveEvent.pointerId !== pointerId) return;
      updateFromPoint(moveEvent.clientY);
    };
    const onEnd = () => {
      state.railDragging = false;
      document.body.classList.remove('buret-grid-rail-dragging');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      updateGridRailActive();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd, { once: true });
    window.addEventListener('pointercancel', onEnd, { once: true });
  }

  function gridRailIndexFromPointer(clientY, ticks) {
    const total = gridRailTotalRows();
    if (!total) return null;
    const rect = ticks.getBoundingClientRect();
    if (!rect.height) return null;
    const y = Math.max(rect.top, Math.min(clientY, rect.bottom));
    const progress = (y - rect.top) / Math.max(1, rect.height);
    return Math.max(0, Math.min(total - 1, Math.round(progress * (total - 1))));
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
      <div class="buret-molecule-picture" data-buret-molecule-picture>${draw(row, cfg)}</div>
      <div class="buret-card-body">
        ${state.smartsMatches.has(index) ? '<div class="buret-match-badge">SMARTS match</div>' : ''}
        <h2>${escapeHTML(row.name || `Molecule ${index + 1}`)}</h2>
        ${row.smiles ? `<div class="buret-smiles">${escapeHTML(row.smiles)}</div>` : ''}
        ${metadata(row)}
      </div>
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
    el.addEventListener('contextmenu', event => showMoleculeContextMenu(event, row));
    installCardHover(el);
    installCardResizeHandle(el);
    installCardDrag(el, row);
    return el;
  }

  function installCardDrag(el, row) {
    const record = gridDragRecord(row);
    if (!record) return;
    el.draggable = true;
    el.addEventListener('dragstart', event => {
      if (event.target?.closest?.('[data-buret-card-resize]')) {
        event.preventDefault();
        return;
      }
      const payload = { paths: [], records: [record] };
      try {
        event.dataTransfer?.setData(STRUCTURE_DRAG_MIME, JSON.stringify(payload));
        event.dataTransfer?.setData('text/plain', record.text);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
      } catch (_) {}
    });
  }

  function gridDragRecord(row) {
    const label = String(row?.name || `Molecule ${Number(row?.index) + 1 || 1}`).trim() || 'Molecule';
    const baseName = safeStructureFileStem(label, Number(row?.index));
    const molblock = String(row?.molblock || '').trim();
    if (molblock) {
      const text = molblock.includes('$$$$') ? molblock : `${molblock}\n$$$$`;
      return {
        path: `${baseName}.sdf`,
        inputExtension: 'sdf',
        text: `${text.trimEnd()}\n`
      };
    }
    const smiles = String(row?.smiles || '').trim();
    if (smiles) {
      return {
        path: `${baseName}.smi`,
        inputExtension: 'smi',
        text: `${smiles} ${label}\n`
      };
    }
    return null;
  }

  function safeStructureFileStem(value, index) {
    const fallback = Number.isFinite(index) ? `molecule-${index + 1}` : 'molecule';
    const stem = String(value || fallback)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 80);
    return stem || fallback;
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

  function hideMoleculeContextMenu() {
    root.querySelector('.buret-grid-molecule-context-menu')?.remove();
    if (state.contextMenuOutsideHandler) {
      document.removeEventListener('pointerdown', state.contextMenuOutsideHandler, true);
      window.removeEventListener('scroll', state.contextMenuOutsideHandler, true);
      window.removeEventListener('resize', state.contextMenuOutsideHandler, true);
      state.contextMenuOutsideHandler = null;
    }
    if (state.contextMenuKeyHandler) {
      document.removeEventListener('keydown', state.contextMenuKeyHandler);
      state.contextMenuKeyHandler = null;
    }
  }

  function handleGridShellContextMenu(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.buret-grid-molecule-context-menu')) return;
    if (target.closest('button, input, select, textarea, [contenteditable="true"]')) return;
    if (target.closest('.buret-card')) return;
    event.preventDefault();
    event.stopPropagation();
    hideMoleculeContextMenu();
  }

  function positionMoleculeContextMenu(menu, clientX, clientY) {
    const margin = 8;
    menu.style.left = margin + 'px';
    menu.style.top = margin + 'px';
    const rect = menu.getBoundingClientRect();
    const left = Math.min(Math.max(margin, clientX), Math.max(margin, window.innerWidth - rect.width - margin));
    const top = Math.min(Math.max(margin, clientY), Math.max(margin, window.innerHeight - rect.height - margin));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }

  function isMoleculeGraphicContextTarget(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest('[data-buret-card-resize], .buret-card-body, button, input, select, textarea, [contenteditable="true"]')) return false;
    const picture = target.closest('[data-buret-molecule-picture]');
    if (!picture) return false;
    if (target.closest('.buret-molecule-error')) return true;
    return !!target.closest('path, line, circle, ellipse, polygon, polyline, text, image, img');
  }

  function removeGridRow(row) {
    const index = Number(row.index);
    state.selected.delete(index);
    state.hiddenRows.add(index);
    if (!state.remoteMode) {
      const allIndex = state.all.findIndex(candidate => Number(candidate.index) === index);
      if (allIndex >= 0) state.all.splice(allIndex, 1);
    }
    state.rows = state.rows.filter(candidate => Number(candidate.index) !== index);
    state.totalRows = Math.max(0, state.totalRows - 1);
  }

  function describeGridRow(row) {
    const props = Object.entries(row.props || {});
    const parts = [
      row.name || `Molecule ${Number(row.index) + 1}`,
      row.smiles ? `SMILES: ${row.smiles}` : '',
      props.length ? `${props.length} properties` : 'no properties'
    ].filter(Boolean);
    return parts.join(' · ');
  }

  function moleculeContextMenuAction(action, row) {
    const cfg = config();
    const label = row.name || `Molecule ${Number(row.index) + 1}`;
    if (action === 'inspect') {
      setStatus(`[grid] ${describeGridRow(row)}`);
    } else if (action === 'select') {
      state.selected.add(Number(row.index));
      state.selectionAnchorIndex = Number(row.index);
      syncRenderedSelection();
      updateChrome(cfg);
      setStatus(`[grid] Selected ${label}.`);
    } else if (action === 'hide') {
      state.hiddenRows.add(Number(row.index));
      state.selected.delete(Number(row.index));
      refresh(cfg);
      setStatus(`[grid] Hidden ${label}.`);
    } else if (action === 'remove') {
      removeGridRow(row);
      void render(cfg);
      setStatus(`[grid] Deleted ${label} from this view.`);
    } else if (action === 'molstar') {
      state.selected.clear();
      state.selected.add(Number(row.index));
      requestSdfPoseDocument(cfg);
      setStatus(`[grid] Opening ${label} in Mol* pose view.`);
    } else if (action === 'ketcher') {
      requestOpenInKetcher(row, cfg);
      setStatus(`[grid] Opening ${label} in Ketcher.`);
    } else {
      setStatus(`[grid] Molecule action is unavailable for ${label}.`);
    }
    hideMoleculeContextMenu();
  }

  function showMoleculeContextMenu(event, row) {
    if (event.target?.closest?.('[data-buret-card-resize]')) return;
    if (!isMoleculeGraphicContextTarget(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      hideMoleculeContextMenu();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    hideMoleculeContextMenu();
    const index = Number(row.index);
    const menu = document.createElement('div');
    menu.className = 'buret-grid-molecule-context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Molecule actions');
    const title = document.createElement('div');
    title.className = 'buret-grid-molecule-context-menu-title';
    title.textContent = row.name || `Molecule ${index + 1}`;
    const subtitle = document.createElement('div');
    subtitle.className = 'buret-grid-molecule-context-menu-subtitle';
    subtitle.textContent = row.smiles || 'SDF molecule';
    const actions = [
      ['select', 'Select molecule'],
      ['remove', 'Delete molecule'],
      ['ketcher', 'Open in Ketcher'],
      ['molstar', 'Open in Mol*'],
      ['hide', 'Hide molecule'],
      ['inspect', 'Inspect properties']
    ];
    menu.append(title, subtitle);
    actions.forEach(([action, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.dataset.buretMoleculeAction = action;
      button.textContent = label;
      button.addEventListener('click', () => moleculeContextMenuAction(action, row));
      menu.appendChild(button);
    });
    root.appendChild(menu);
    positionMoleculeContextMenu(menu, event.clientX, event.clientY);
    menu.querySelector('button')?.focus();
    state.contextMenuOutsideHandler = outsideEvent => {
      if (outsideEvent.target instanceof Element && outsideEvent.target.closest('.buret-grid-molecule-context-menu')) return;
      hideMoleculeContextMenu();
    };
    state.contextMenuKeyHandler = keyEvent => {
      if (keyEvent.key === 'Escape') hideMoleculeContextMenu();
    };
    document.addEventListener('pointerdown', state.contextMenuOutsideHandler, true);
    window.addEventListener('scroll', state.contextMenuOutsideHandler, true);
    window.addEventListener('resize', state.contextMenuOutsideHandler, true);
    document.addEventListener('keydown', state.contextMenuKeyHandler);
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
    let pendingWidth = startWidth;
    let resizeFrame = 0;
    const applyPendingWidth = () => {
      resizeFrame = 0;
      if (state.cardMin === pendingWidth) return;
      state.cardMin = pendingWidth;
      applyGridPreferences();
    };
    try { event.currentTarget.setPointerCapture(pointerId); } catch (_) {}
    const onMove = moveEvent => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      const delta = axis === 'x'
        ? deltaX
        : (axis === 'y' ? deltaY : (Math.abs(deltaX) >= Math.abs(deltaY) ? deltaX : deltaY));
      pendingWidth = clampInteger(startWidth + delta, limits.min, limits.max, DEFAULT_CARD_MIN);
      if (!resizeFrame) resizeFrame = requestAnimationFrame(applyPendingWidth);
    };
    const onUp = () => {
      if (resizeFrame) {
        cancelAnimationFrame(resizeFrame);
        applyPendingWidth();
      }
      store(CARD_MIN_STORAGE_KEY, state.cardMin || pendingWidth);
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
    return state.cardRenderer === 'xyzrender' ? drawXyzrenderCard(row, cfg) : drawRdkitPlaceholder(row);
  }

  function rdkitCardKey(row) {
    const match = state.smartsMatches.get(Number(row.index));
    const useInputCoords = state.rdkitUseInputCoords && hasMolblockInputCoordinates(row.molblock);
    return `${row.index}|${row.smiles || ''}|${hash(row.molblock || '')}|${state.smarts}|${useInputCoords ? 'file-coords' : 'new-coords'}|${match ? `${match.atoms.join(',')}:${match.bonds.join(',')}` : ''}`;
  }

  function drawRdkitPlaceholder(row) {
    const key = rdkitCardKey(row);
    if (state.svgCache.has(key)) return state.svgCache.get(key);
    return `<div class="buret-molecule-loading" data-buret-rdkit-card-key="${escapeAttr(key)}">Rendering molecule...</div>`;
  }

  function drawRdkit(row) {
    if (!state.rdkit) {
      const label = row.smiles || row.name || 'Molecule';
      const message = state.rdkitError || 'RDKit renderer is unavailable.';
      const denseClass = String(label).length > 36 ? ' buret-molecule-error-dense' : '';
      return `<div class="buret-molecule-error${denseClass}"><strong>${escapeHTML(label)}</strong><span>${escapeHTML(message)}</span></div>`;
    }
    const match = state.smartsMatches.get(Number(row.index));
    const useInputCoords = state.rdkitUseInputCoords && hasMolblockInputCoordinates(row.molblock);
    const key = rdkitCardKey(row);
    if (state.svgCache.has(key)) return state.svgCache.get(key);
    let mol = null;
    let html = '';
    try {
      mol = state.rdkit.get_mol(row.molblock || row.smiles || '');
      if (!mol || (typeof mol.is_valid === 'function' && !mol.is_valid())) throw new Error('invalid molecule');
      try {
        if (!useInputCoords) {
          try { mol.set_new_coords?.(); } catch (_) {}
        }
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

  function scheduleRdkitCard(card, row) {
    const target = card.querySelector('[data-buret-rdkit-card-key]');
    if (!target) return;
    const key = target.getAttribute('data-buret-rdkit-card-key');
    if (!key) return;
    const start = () => enqueueRdkitCard(row, key, target);
    state.rdkitCardLazyJobs.set(target, start);
    const observer = ensureRdkitCardObserver();
    if (observer) {
      observer.observe(target);
      return;
    }
    window.setTimeout(() => startLazyRdkitCard(target), 0);
  }

  function ensureRdkitCardObserver() {
    if (typeof IntersectionObserver !== 'function') return null;
    if (state.rdkitCardObserver) return state.rdkitCardObserver;
    state.rdkitCardObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        startLazyRdkitCard(entry.target);
      }
    }, { root: null, rootMargin: RDKIT_CARD_ROOT_MARGIN });
    return state.rdkitCardObserver;
  }

  function startLazyRdkitCard(target) {
    state.rdkitCardObserver?.unobserve?.(target);
    const start = state.rdkitCardLazyJobs.get(target);
    if (!start) return;
    state.rdkitCardLazyJobs.delete(target);
    start();
  }

  function enqueueRdkitCard(row, key, target) {
    if (state.svgCache.has(key)) return;
    const existing = state.rdkitCardPending.get(key);
    if (existing) {
      existing.target = target || existing.target;
      return;
    }
    const job = { row, key, target, seq: state.rdkitCardSeq++ };
    state.rdkitCardPending.set(key, job);
    state.rdkitCardQueue.push(job);
    pumpRdkitCardQueue();
  }

  function pumpRdkitCardQueue() {
    if (state.rdkitCardRendering || !state.rdkitCardQueue.length) return;
    state.rdkitCardQueue.sort(compareCardRenderJobs);
    const job = state.rdkitCardQueue.shift();
    state.rdkitCardRendering = true;
    requestAnimationFrame(() => {
      try {
        updateRdkitCard(job.key, drawRdkit(job.row));
      } finally {
        state.rdkitCardPending.delete(job.key);
        state.rdkitCardRendering = false;
        window.setTimeout(pumpRdkitCardQueue, 0);
      }
    });
  }

  function compareCardRenderJobs(a, b) {
    const delta = cardRenderPriority(a.target) - cardRenderPriority(b.target);
    return delta || ((a.seq || 0) - (b.seq || 0));
  }

  function cardRenderPriority(target) {
    if (!target || typeof target.getBoundingClientRect !== 'function') return Number.MAX_SAFE_INTEGER;
    const rect = target.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    if (!Number.isFinite(rect.top) || !Number.isFinite(rect.bottom)) return Number.MAX_SAFE_INTEGER;
    if (rect.bottom >= 0 && rect.top <= viewportHeight) return 0;
    if (rect.top > viewportHeight) return rect.top - viewportHeight;
    return Math.abs(rect.bottom);
  }

  function updateRdkitCard(key, html) {
    root.querySelectorAll('[data-buret-rdkit-card-key]').forEach(target => {
      if (target.getAttribute('data-buret-rdkit-card-key') !== key) return;
      target.classList.remove('buret-molecule-loading');
      target.removeAttribute('data-buret-rdkit-card-key');
      target.innerHTML = html;
    });
  }

  function resetRdkitCardObserver() {
    state.rdkitCardObserver?.disconnect?.();
    state.rdkitCardObserver = null;
    state.rdkitCardLazyJobs = new WeakMap();
  }

  function drawXyzrenderCard(row, cfg) {
    const record = gridDragRecord(row);
    if (!record) return '<div class="buret-molecule-error"><strong>Molecule</strong><span>No structure data</span></div>';
    const key = xyzrenderCardKey(row, record);
    const cached = state.xyzrenderCardCache.get(key);
    if (cached?.html) return cached.html;
    if (cached?.error) return `<div class="buret-molecule-error"><strong>${escapeHTML(row.name || `Molecule ${Number(row.index) + 1}`)}</strong><span>${escapeHTML(cached.error)}</span></div>`;
    const preview = drawRdkitPlaceholder(row);
    return `<div class="buret-xyzrender-preview" data-buret-xyzrender-card-key="${escapeAttr(key)}">${preview}</div>`;
  }

  function xyzrenderCardKey(row, record) {
    return `${row.index}|${record.inputExtension}|${hash(record.text || '')}|${state.smarts}`;
  }

  function scheduleXyzrenderCard(card, row, cfg) {
    if (state.cardRenderer !== 'xyzrender') return;
    const target = card.querySelector('[data-buret-xyzrender-card-key]');
    if (!target) return;
    const record = gridDragRecord(row);
    if (!record) return;
    const key = xyzrenderCardKey(row, record);
    const start = () => enqueueXyzrenderCard(row, cfg, record, key, target);
    state.xyzrenderCardLazyJobs.set(target, start);
    const observer = ensureXyzrenderCardObserver();
    if (observer) {
      observer.observe(target);
      return;
    }
    window.setTimeout(() => startLazyXyzrenderCard(target), 0);
  }

  function ensureXyzrenderCardObserver() {
    if (typeof IntersectionObserver !== 'function') return null;
    if (state.xyzrenderCardObserver) return state.xyzrenderCardObserver;
    state.xyzrenderCardObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        startLazyXyzrenderCard(entry.target);
      }
    }, { root: null, rootMargin: XYZRENDER_CARD_ROOT_MARGIN });
    return state.xyzrenderCardObserver;
  }

  function startLazyXyzrenderCard(target) {
    state.xyzrenderCardObserver?.unobserve?.(target);
    const start = state.xyzrenderCardLazyJobs.get(target);
    if (!start) return;
    state.xyzrenderCardLazyJobs.delete(target);
    start();
  }

  function resetXyzrenderCardObserver() {
    state.xyzrenderCardObserver?.disconnect?.();
    state.xyzrenderCardObserver = null;
    state.xyzrenderCardLazyJobs = new WeakMap();
  }

  function resetCardRenderQueues() {
    state.rdkitCardQueue = [];
    state.rdkitCardPending.clear();
    state.xyzrenderCardQueue = [];
    state.xyzrenderCardCache.forEach((value, key) => {
      if (value?.pending) state.xyzrenderCardCache.delete(key);
    });
  }

  function enqueueXyzrenderCard(row, cfg, record, key, target) {
    const cached = state.xyzrenderCardCache.get(key);
    if (cached?.html || cached?.error) return;
    if (cached?.pending) {
      cached.target = target || cached.target;
      return;
    }
    const job = { row, cfg, record, key, target, seq: state.xyzrenderCardSeq++ };
    state.xyzrenderCardCache.set(key, { pending: true, target, job });
    state.xyzrenderCardQueue.push(job);
    pumpXyzrenderCardQueue();
  }

  async function requestXyzrenderCard(row, cfg, record, key) {
    const endpoint = String(cfg.xyzrenderEndpoint || '/__burette/xyzrender');
    try {
      const request = {
        path: record.path,
        preset: 'default',
        inputDataBase64: textToBase64(xyzrenderFragmentText(record)),
        inputExtension: record.inputExtension
      };
      let payload;
      if (cfg.appViewer === true && cfg.gridDataMode === 'bridge') {
        payload = await hostRequest('renderXyzrenderCard', request);
      } else {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: request.path,
            preset: request.preset,
            inputDataBase64: request.inputDataBase64,
            inputExtension: request.inputExtension
          })
        });
        payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : `xyzrender request failed with status ${response.status}`);
      }
      if (typeof payload?.svg !== 'string' || !payload.svg.trim()) throw new Error('xyzrender endpoint returned no SVG payload');
      const html = prepareXyzrenderCardSVG(payload.svg);
      if (!html.includes('<svg')) throw new Error('empty xyzrender drawing');
      state.xyzrenderCardCache.set(key, { html });
      updateXyzrenderCard(key, html);
    } catch (error) {
      const message = error?.message || String(error);
      state.xyzrenderCardCache.set(key, { error: message });
      updateXyzrenderCard(key, `<div class="buret-molecule-error"><strong>${escapeHTML(row.name || `Molecule ${Number(row.index) + 1}`)}</strong><span>${escapeHTML(message)}</span></div>`);
    }
  }

  async function fetchXyzrenderCard(endpoint, request) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(typeof payload?.error === 'string' ? payload.error : `xyzrender request failed with status ${response.status}`);
    }
    return payload;
  }

  function prepareXyzrenderCardSVG(svg) {
    let html = sanitizeSVG(String(svg || ''));
    html = stripSVGClipping(html);
    html = markSVGForFitting(html, 'data-buret-xyzrender-svg');
    return html;
  }

  function markSVGForFitting(svg, marker) {
    return String(svg || '').replace(/<svg\b([^>]*)>/i, (tag, attrs) => {
      let next = tag;
      if (!new RegExp(`\\s${marker}=`, 'i').test(attrs)) {
        next = next.replace('<svg', `<svg ${marker}="true"`);
      }
      if (!/\spreserveAspectRatio=/i.test(attrs)) {
        next = next.replace('<svg', '<svg preserveAspectRatio="xMidYMid meet"');
      }
      return next;
    });
  }

  function updateXyzrenderCard(key, html) {
    root.querySelectorAll('[data-buret-xyzrender-card-key]').forEach(target => {
      if (target.getAttribute('data-buret-xyzrender-card-key') !== key) return;
      target.classList.remove('buret-molecule-loading');
      target.classList.remove('buret-xyzrender-preview');
      target.removeAttribute('data-buret-xyzrender-card-key');
      target.innerHTML = html;
      const card = target.closest('.buret-card');
      if (card) fitCardSVGs(card);
    });
  }

  function hasMolblockInputCoordinates(value) {
    const text = String(value || '');
    if (!text.includes('\n')) return false;
    const lines = text.split(/\r?\n/u);
    const countsIndex = lines.findIndex(line => /\bV(2000|3000)\b/u.test(line) || /^\s*\d+\s+\d+\s+/u.test(line));
    if (countsIndex < 0) return false;
    if (/\bV3000\b/u.test(lines[countsIndex])) {
      return lines.some(line => {
        if (!/^\s*M\s+V30\s+\d+\s+\S+\s+/u.test(line)) return false;
        const parts = line.trim().split(/\s+/u);
        const x = Number(parts[4]);
        const y = Number(parts[5]);
        const z = Number(parts[6]);
        return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) && Math.abs(z) > 1e-6;
      });
    }
    const countText = lines[countsIndex].slice(0, 3).trim() || lines[countsIndex].trim().split(/\s+/u)[0];
    const atomCount = Number.parseInt(countText, 10);
    if (!Number.isFinite(atomCount) || atomCount <= 0) return false;
    return lines.slice(countsIndex + 1, countsIndex + 1 + atomCount).some(line => {
      const parts = line.trim().split(/\s+/u);
      if (parts.length < 4) return false;
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      const z = Number(parts[2]);
      return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) && Math.abs(z) > 1e-6;
    });
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
    if (!card) return;
    card.querySelectorAll('svg[data-buret-rdkit-svg="true"], svg[data-buret-xyzrender-svg="true"]').forEach(svg => fitSVGToContent(svg));
  }

  function fitRenderedGridSVGs() {
    root.querySelectorAll('svg[data-buret-rdkit-svg="true"], svg[data-buret-xyzrender-svg="true"]').forEach(svg => fitSVGToContent(svg));
  }

  function fitSVGToContent(svg) {
    const bounds = contentBounds(svg) || svgBounds(svg);
    if (!bounds) return;
    const width = bounds.x2 - bounds.x1;
    const height = bounds.y2 - bounds.y1;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    const size = Math.max(width, height);
    const padding = Math.max(SVG_FIT_MIN_PADDING, size * SVG_FIT_PADDING_FRACTION);
    const centerX = bounds.x1 + width / 2;
    const centerY = bounds.y1 + height / 2;
    const viewSize = size + padding * 2;
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

  function textToBase64(value) {
    const bytes = new TextEncoder().encode(String(value || ''));
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
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
      normalizeCardRenderer(cfg);
      buildUI(cfg);
      refresh(cfg);
      try {
        await initRDKit();
        state.rdkitError = '';
        if (state.cardRenderer === 'rdkit') render(cfg);
      } catch (rdkitError) {
        state.rdkitError = rdkitError?.message || String(rdkitError);
        setStatus(`RDKit renderer unavailable: ${state.rdkitError}`, 'error');
      }
    } catch (error) {
      const message = error && error.stack ? error.stack : String(error);
      setStatus(message, 'error');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main, { once: true });
  else main();
})();
