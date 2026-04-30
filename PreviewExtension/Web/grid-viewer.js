(() => {
  'use strict';

  const root = document.getElementById('app');
  const status = document.getElementById('status');
  const GRID_COLUMNS_STORAGE_KEY = 'buret.grid.columns';
  const LOAD_BATCH_STORAGE_KEY = 'buret.grid.loadBatch';
  const SHOW_PROPERTIES_STORAGE_KEY = 'buret.grid.showProperties';
  const GRID_COLUMNS_MIN = 4;
  const GRID_COLUMNS_MAX = 16;
  const LOAD_BATCH_OPTIONS = ['auto', '24', '60', '120', '240'];
  const state = {
    rdkit: null,
    all: Array.isArray(window.BurreteGridRecords) ? window.BurreteGridRecords : [],
    rows: [],
    visibleCount: 0,
    renderedCount: 0,
    query: '',
    smarts: '',
    smartsError: '',
    smartsMatches: new Map(),
    sort: 'index',
    gridColumns: storedNumber(GRID_COLUMNS_STORAGE_KEY, 4, GRID_COLUMNS_MIN, GRID_COLUMNS_MAX),
    loadBatchChoice: storedChoice(LOAD_BATCH_STORAGE_KEY, LOAD_BATCH_OPTIONS, 'auto'),
    showProperties: storedBoolean(SHOW_PROPERTIES_STORAGE_KEY, true),
    selected: new Set(),
    svgCache: new Map(),
    token: 0,
    rendering: false,
    pendingLoad: false,
    loadObserver: null,
    scrollHandler: null
  };

  function post(type, message, payload = {}) {
    try {
      if (window.__mqlPost) window.__mqlPost(type, message || '', payload);
      else window.webkit?.messageHandlers?.burrete?.postMessage({ type, message: String(message || ''), ...payload });
    } catch (_) {}
  }

  function setStatus(message, kind = 'info') {
    if (status) {
      status.textContent = String(message || '');
      status.classList.toggle('error', kind === 'error');
      status.classList.toggle('hidden', kind !== 'error' && !window.BurreteDebug);
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
      rendererSwitch: cfg.appViewer === true && !!caps.rendererSwitch
    };
  }

  async function initRDKit() {
    if (state.rdkit) return state.rdkit;
    if (typeof window.initRDKitModule !== 'function') {
      throw new Error('RDKit_minimal.js is missing. Run npm run vendor:rdkit and rebuild.');
    }
    setStatus('[grid] Loading RDKit.js...');
    const options = { locateFile: file => `../assets/rdkit/${file}` };
    if (window.BurreteRDKitWasmBase64) {
      options.wasmBinary = base64ToBytes(window.BurreteRDKitWasmBase64);
      window.BurreteRDKitWasmBase64 = '';
    }
    state.rdkit = await window.initRDKitModule(options);
    return state.rdkit;
  }

  function base64ToBytes(value) {
    const binary = atob(String(value || ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function loadBatchSize(cfg) {
    if (state.loadBatchChoice !== 'auto') return Number(state.loadBatchChoice);
    const value = Number(cfg.pageSize || 72);
    return Number.isFinite(value) ? Math.max(12, Math.min(180, Math.floor(value))) : 72;
  }

  function storedChoice(key, options, fallback) {
    try {
      const value = window.localStorage?.getItem(key);
      return options.includes(value) ? value : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function storedBoolean(key, fallback) {
    try {
      const value = window.localStorage?.getItem(key);
      if (value === 'true') return true;
      if (value === 'false') return false;
    } catch (_) {}
    return fallback;
  }

  function storedNumber(key, fallback, min, max) {
    try {
      const value = Number(window.localStorage?.getItem(key));
      if (Number.isFinite(value)) return Math.max(min, Math.min(max, Math.round(value)));
    } catch (_) {}
    return fallback;
  }

  function store(key, value) {
    try { window.localStorage?.setItem(key, String(value)); } catch (_) {}
  }

  function applyTheme(cfg) {
    const theme = cfg.theme === 'light' || cfg.theme === 'dark'
      ? cfg.theme
      : (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    const transparent = cfg.transparentBackground === true || cfg.canvasBackground === 'transparent';
    document.documentElement.dataset.buretTheme = theme;
    document.body.dataset.buretTheme = theme;
    document.body.classList.toggle('buret-theme-light', theme === 'light');
    document.body.classList.toggle('buret-theme-dark', theme !== 'light');
    document.body.classList.toggle('burette-transparent-background', transparent);
    document.body.classList.toggle('burette-opaque-background', !transparent);
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
            <label class="buret-smarts-control">SMARTS <input id="smarts" type="search" spellcheck="false" autocapitalize="off" placeholder="[#6]=O" /></label>
            <label class="buret-sort-control">Sort <select id="sort"><option value="index">File order</option><option value="name">Name</option><option value="smiles">SMILES</option>${propertyOptions()}</select></label>
            <label class="buret-load-control">Load batch <select id="load-batch"><option value="auto">Auto</option><option value="24">24</option><option value="60">60</option><option value="120">120</option><option value="240">240</option></select></label>
            <div id="load-status" class="buret-load-status"></div>
          </div>
          <div class="buret-toolbar-row buret-toolbar-row-view">
            <label class="buret-columns-control">Grid columns <span><input id="grid-columns" type="range" min="${GRID_COLUMNS_MIN}" max="${GRID_COLUMNS_MAX}" step="1" /><output id="grid-columns-label"></output></span></label>
            <div class="buret-stepper-control" aria-label="Adjust grid columns">
              <button id="grid-columns-decrease" type="button" aria-label="Fewer columns">-</button>
              <button id="grid-columns-increase" type="button" aria-label="More columns">+</button>
            </div>
            <button id="show-properties" class="buret-toggle-button" type="button" aria-pressed="true">Properties</button>
            <button id="clear-smarts" class="buret-toggle-button buret-clear-smarts" type="button" hidden>Clear SMARTS</button>
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
    document.getElementById('smarts').addEventListener('input', event => {
      state.smarts = event.target.value || '';
      refresh(cfg);
    });
    document.getElementById('sort').addEventListener('change', event => {
      state.sort = event.target.value || 'index';
      refresh(cfg);
    });
    document.getElementById('load-batch').addEventListener('change', event => {
      state.loadBatchChoice = LOAD_BATCH_OPTIONS.includes(event.target.value) ? event.target.value : 'auto';
      store(LOAD_BATCH_STORAGE_KEY, state.loadBatchChoice);
      render(cfg);
    });
    document.getElementById('grid-columns').addEventListener('input', event => {
      setGridColumns(event.target.value);
      applyGridPreferences();
    });
    document.getElementById('grid-columns-decrease').addEventListener('click', () => updateGridColumns(-1));
    document.getElementById('grid-columns-increase').addEventListener('click', () => updateGridColumns(1));
    document.getElementById('show-properties').addEventListener('click', () => {
      state.showProperties = !state.showProperties;
      store(SHOW_PROPERTIES_STORAGE_KEY, state.showProperties);
      applyGridPreferences();
    });
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
      button.addEventListener('click', () => requestRendererSwitch(button.getAttribute('data-buret-grid-renderer')));
    });
    applyGridPreferences();
    initInfiniteLoading(cfg);
  }

  function applyGridPreferences() {
    document.body.classList.toggle('buret-hide-properties', !state.showProperties);
    document.body.style.setProperty('--buret-grid-columns', String(state.gridColumns));
    const gridColumnsInput = document.getElementById('grid-columns');
    const gridColumnsLabel = document.getElementById('grid-columns-label');
    const gridColumnsDecrease = document.getElementById('grid-columns-decrease');
    const gridColumnsIncrease = document.getElementById('grid-columns-increase');
    const loadBatchSelect = document.getElementById('load-batch');
    const propertiesToggle = document.getElementById('show-properties');
    if (gridColumnsInput) gridColumnsInput.value = String(state.gridColumns);
    if (gridColumnsLabel) gridColumnsLabel.textContent = `${state.gridColumns} per row`;
    if (gridColumnsDecrease) gridColumnsDecrease.disabled = state.gridColumns <= GRID_COLUMNS_MIN;
    if (gridColumnsIncrease) gridColumnsIncrease.disabled = state.gridColumns >= GRID_COLUMNS_MAX;
    if (loadBatchSelect) loadBatchSelect.value = state.loadBatchChoice;
    if (propertiesToggle) {
      propertiesToggle.classList.toggle('active', state.showProperties);
      propertiesToggle.setAttribute('aria-pressed', state.showProperties ? 'true' : 'false');
    }
  }

  function setGridColumns(value) {
    state.gridColumns = storedNumberFromValue(value, state.gridColumns, GRID_COLUMNS_MIN, GRID_COLUMNS_MAX);
    store(GRID_COLUMNS_STORAGE_KEY, state.gridColumns);
  }

  function updateGridColumns(delta) {
    setGridColumns(state.gridColumns + delta);
    applyGridPreferences();
  }

  function storedNumberFromValue(value, fallback, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
  }

  function propertyOptions() {
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
      <div class="buret-grid-renderer-switch" aria-label="3D renderer">
        <button type="button" data-buret-grid-renderer="molstar">Mol*</button>
        <button type="button" data-buret-grid-renderer="xyzrender-external">xyzrender</button>
      </div>`;
  }

  function requestRendererSwitch(renderer) {
    const value = normalizeRenderer(renderer);
    post('setRenderer', `[grid] Switch renderer to ${value}.`, { value });
  }

  function normalizeRenderer(renderer) {
    const value = String(renderer || 'molstar').toLowerCase();
    return value === 'xyzrender-external' || value === 'xyzrender' ? 'xyzrender-external' : 'molstar';
  }

  function refresh(cfg) {
    const query = normalize(state.query);
    const textRows = query
      ? state.all.filter(row => normalize([row.name, row.smiles, ...Object.entries(row.props || {}).flat()].join('\n')).includes(query))
      : state.all.slice();
    state.rows = filterBySMARTS(textRows);
    state.rows.sort((a, b) => compare(a, b, state.sort));
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
      try { mol?.delete?.(); } catch (_) {}
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
    if (state.rendering) {
      state.pendingLoad = hasMoreRows();
      return;
    }
    if (!hasMoreRows()) return;
    state.visibleCount = Math.min(state.rows.length, state.visibleCount + loadBatchSize(cfg));
    await appendVisibleRows(cfg, state.token);
  }

  async function appendVisibleRows(cfg, token) {
    const grid = document.getElementById('grid');
    const rows = state.rows.slice(state.renderedCount, state.visibleCount);
    state.rendering = true;
    try {
      for (const row of rows) {
        if (token !== state.token) return;
        grid.appendChild(card(row, cfg));
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
    const included = Number(cfg.recordsIncluded || state.all.length);
    document.getElementById('summary').textContent = [
      `${state.rows.length.toLocaleString()} visible`,
      `${state.renderedCount.toLocaleString()} shown`,
      `${included.toLocaleString()} loaded`,
      `${total.toLocaleString()} in file`,
      state.selected.size ? `${state.selected.size.toLocaleString()} selected` : ''
    ].filter(Boolean).join(' · ');
    if (state.smarts.trim() && !state.smartsError) {
      document.getElementById('summary').textContent += ` · SMARTS matches ${state.smartsMatches.size.toLocaleString()}`;
    }
    const loadStatus = document.getElementById('load-status');
    if (loadStatus) {
      loadStatus.textContent = hasMoreRows()
        ? `${state.renderedCount.toLocaleString()} of ${state.rows.length.toLocaleString()} shown`
        : 'All visible molecules loaded';
    }
    const clearSMARTS = document.getElementById('clear-smarts');
    if (clearSMARTS) clearSMARTS.hidden = !state.smarts.trim();
    const smartsInput = document.getElementById('smarts');
    if (smartsInput) smartsInput.classList.toggle('invalid', !!state.smartsError);
    document.getElementById('footer').textContent = state.smartsError
      ? `SMARTS error: ${state.smartsError}`
      : (total > included
        ? `Showing first ${included.toLocaleString()} of ${total.toLocaleString()} records.`
        : (hasMoreRows()
          ? `Scroll to load more. ${state.renderedCount.toLocaleString()} of ${state.rows.length.toLocaleString()} visible molecules are rendered.`
          : 'Offline RDKit.js rendering. No network access required.'));
  }

  function card(row, cfg) {
    const caps = capabilities(cfg);
    const el = document.createElement('article');
    el.className = 'buret-card';
    el.dataset.index = String(row.index);
    if (state.selected.has(Number(row.index))) el.classList.add('selected');
    if (state.smartsMatches.has(Number(row.index))) el.classList.add('smarts-match');
    el.innerHTML = `
      <div class="buret-molecule-picture">${draw(row)}</div>
      <div class="buret-card-body">
        ${state.smartsMatches.has(Number(row.index)) ? '<div class="buret-match-badge">SMARTS match</div>' : ''}
        <h2>${escapeHTML(row.name || `Molecule ${Number(row.index) + 1}`)}</h2>
        ${row.smiles ? `<div class="buret-smiles">${escapeHTML(row.smiles)}</div>` : ''}
        ${metadata(row)}
      </div>`;
    if (caps.selection) {
      el.tabIndex = 0;
      el.role = 'button';
      const toggle = () => {
        const index = Number(row.index);
        if (state.selected.has(index)) state.selected.delete(index);
        else state.selected.add(index);
        el.classList.toggle('selected', state.selected.has(index));
        updateChrome(cfg);
      };
      el.addEventListener('click', toggle);
      el.addEventListener('keydown', event => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          toggle();
        }
      });
    }
    return el;
  }

  function draw(row) {
    const match = state.smartsMatches.get(Number(row.index));
    const key = `${row.index}|${row.smiles || ''}|${hash(row.molblock || '')}|${state.smarts}|${match ? `${match.atoms.join(',')}:${match.bonds.join(',')}` : ''}`;
    if (state.svgCache.has(key)) return state.svgCache.get(key);
    let mol = null;
    let html = '';
    try {
      mol = state.rdkit.get_mol(row.molblock || row.smiles || '');
      if (!mol || (typeof mol.is_valid === 'function' && !mol.is_valid())) throw new Error('invalid molecule');
      try {
        html = match && typeof mol.get_svg_with_highlights === 'function'
          ? mol.get_svg_with_highlights(JSON.stringify({
              atoms: match.atoms,
              bonds: match.bonds,
              width: 260,
              height: 190
            }))
          : mol.get_svg(260, 190);
      } catch (_) {
        html = mol.get_svg();
      }
      html = sanitizeSVG(String(html || ''));
      if (!html.includes('<svg')) throw new Error('empty drawing');
    } catch (error) {
      html = `<div class="buret-molecule-error"><strong>${escapeHTML(row.smiles || row.name || 'Molecule')}</strong><span>${escapeHTML(error.message || String(error))}</span></div>`;
    } finally {
      try { mol?.delete?.(); } catch (_) {}
    }
    state.svgCache.set(key, html);
    while (state.svgCache.size > 360) state.svgCache.delete(state.svgCache.keys().next().value);
    return html;
  }

  function metadata(row) {
    const entries = Object.entries(row.props || {}).filter(([, value]) => String(value || '').length).slice(0, 6);
    if (!entries.length) return '<div class="buret-no-metadata">No metadata</div>';
    return `<dl class="buret-metadata">${entries.map(([key, value]) => `<dt>${escapeHTML(key)}</dt><dd>${escapeHTML(value)}</dd>`).join('')}</dl>`;
  }

  function selectedOrFiltered() {
    return state.selected.size ? state.all.filter(row => state.selected.has(Number(row.index))) : state.rows;
  }

  async function copySelected() {
    const text = selectedOrFiltered().map(row => `${row.smiles || ''}\t${row.name || ''}`.trim()).join('\n');
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

  function exportSmiles(cfg) {
    const text = selectedOrFiltered()
      .map(row => `${row.smiles || ''}\t${row.name || `mol_${Number(row.index) + 1}`}`.trim())
      .filter(Boolean)
      .join('\n') + '\n';
    download(text, baseName(cfg.label) + '.smi', 'chemical/x-daylight-smiles');
  }

  function exportCSV(cfg) {
    const rows = selectedOrFiltered();
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
      applyTheme(cfg);
      buildUI(cfg);
      await initRDKit();
      refresh(cfg);
    } catch (error) {
      const message = error && error.stack ? error.stack : String(error);
      setStatus(message, 'error');
      post('error', message);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main, { once: true });
  else main();
})();
