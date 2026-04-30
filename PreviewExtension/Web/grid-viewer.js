(() => {
  'use strict';

  const root = document.getElementById('app');
  const status = document.getElementById('status');
  const state = {
    rdkit: null,
    all: Array.isArray(window.BurreteGridRecords) ? window.BurreteGridRecords : [],
    rows: [],
    page: 0,
    query: '',
    sort: 'index',
    selected: new Set(),
    svgCache: new Map(),
    token: 0
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
    return { selection: !!caps.selection, export: !!caps.export };
  }

  async function initRDKit() {
    if (state.rdkit) return state.rdkit;
    if (typeof window.initRDKitModule !== 'function') {
      throw new Error('RDKit_minimal.js is missing. Run npm run vendor:rdkit and rebuild.');
    }
    setStatus('[grid] Loading RDKit.js...');
    state.rdkit = await window.initRDKitModule({ locateFile: file => `../assets/rdkit/${file}` });
    return state.rdkit;
  }

  function pageSize(cfg) {
    const value = Number(cfg.pageSize || 72);
    return Number.isFinite(value) ? Math.max(12, Math.min(180, Math.floor(value))) : 72;
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
          <label>Search <input id="search" type="search" placeholder="name, SMILES, metadata" /></label>
          <label>Sort <select id="sort"><option value="index">File order</option><option value="name">Name</option><option value="smiles">SMILES</option>${propertyOptions()}</select></label>
          <div class="buret-pager"><button id="prev" type="button" aria-label="Previous page">&lsaquo;</button><span id="page-label"></span><button id="next" type="button" aria-label="Next page">&rsaquo;</button></div>
        </div>
        <main id="grid" class="buret-grid"></main>
        <footer id="footer" class="buret-grid-footer"></footer>
      </section>`;
    document.getElementById('search').addEventListener('input', event => {
      state.query = event.target.value || '';
      state.page = 0;
      refresh(cfg);
    });
    document.getElementById('sort').addEventListener('change', event => {
      state.sort = event.target.value || 'index';
      refresh(cfg);
    });
    document.getElementById('prev').addEventListener('click', () => {
      if (state.page > 0) {
        state.page--;
        render(cfg);
      }
    });
    document.getElementById('next').addEventListener('click', () => {
      if (state.page + 1 < pages(cfg)) {
        state.page++;
        render(cfg);
      }
    });
    document.getElementById('copy-selected')?.addEventListener('click', copySelected);
    document.getElementById('export-smi')?.addEventListener('click', () => exportSmiles(cfg));
    document.getElementById('export-csv')?.addEventListener('click', () => exportCSV(cfg));
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

  function refresh(cfg) {
    const query = normalize(state.query);
    state.rows = query
      ? state.all.filter(row => normalize([row.name, row.smiles, ...Object.entries(row.props || {}).flat()].join('\n')).includes(query))
      : state.all.slice();
    state.rows.sort((a, b) => compare(a, b, state.sort));
    if (state.page >= pages(cfg)) state.page = Math.max(0, pages(cfg) - 1);
    render(cfg);
  }

  function compare(a, b, key) {
    const get = row => key.startsWith('prop:') ? (row.props || {})[key.slice(5)] : row[key];
    if (key === 'index') return Number(a.index) - Number(b.index);
    return String(get(a) || '').localeCompare(String(get(b) || ''), undefined, {
      numeric: true,
      sensitivity: 'base'
    }) || Number(a.index) - Number(b.index);
  }

  function pages(cfg) {
    return Math.max(1, Math.ceil(state.rows.length / pageSize(cfg)));
  }

  async function render(cfg) {
    const token = ++state.token;
    const grid = document.getElementById('grid');
    const start = state.page * pageSize(cfg);
    const rows = state.rows.slice(start, start + pageSize(cfg));
    grid.innerHTML = '';
    if (!rows.length) grid.innerHTML = '<div class="buret-empty">No molecules match this search.</div>';
    for (const row of rows) {
      if (token !== state.token) return;
      grid.appendChild(card(row, cfg));
      if (grid.children.length % 16 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    updateChrome(cfg);
    post('ready', 'ready');
    if (status && !window.BurreteDebug) status.classList.add('hidden');
  }

  function updateChrome(cfg) {
    const total = Number(cfg.recordsTotal || state.all.length);
    const included = Number(cfg.recordsIncluded || state.all.length);
    document.getElementById('summary').textContent = [
      `${state.rows.length.toLocaleString()} visible`,
      `${included.toLocaleString()} loaded`,
      `${total.toLocaleString()} in file`,
      state.selected.size ? `${state.selected.size.toLocaleString()} selected` : ''
    ].filter(Boolean).join(' · ');
    document.getElementById('page-label').textContent = `Page ${state.page + 1} / ${pages(cfg)}`;
    document.getElementById('prev').disabled = state.page <= 0;
    document.getElementById('next').disabled = state.page + 1 >= pages(cfg);
    document.getElementById('footer').textContent = total > included
      ? `Showing first ${included.toLocaleString()} of ${total.toLocaleString()} records.`
      : 'Offline RDKit.js rendering. No network access required.';
  }

  function card(row, cfg) {
    const caps = capabilities(cfg);
    const el = document.createElement('article');
    el.className = 'buret-card';
    el.dataset.index = String(row.index);
    if (state.selected.has(Number(row.index))) el.classList.add('selected');
    el.innerHTML = `
      <div class="buret-molecule-picture">${draw(row)}</div>
      <div class="buret-card-body">
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
    const key = `${row.index}|${row.smiles || ''}|${hash(row.molblock || '')}`;
    if (state.svgCache.has(key)) return state.svgCache.get(key);
    let mol = null;
    let html = '';
    try {
      mol = state.rdkit.get_mol(row.molblock || row.smiles || '');
      if (!mol || (typeof mol.is_valid === 'function' && !mol.is_valid())) throw new Error('invalid molecule');
      try {
        html = mol.get_svg(260, 190);
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
