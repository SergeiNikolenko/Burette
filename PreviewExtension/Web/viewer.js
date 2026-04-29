(() => {
  'use strict';

  const status = document.getElementById('status');
  try { window.__mqlDebug && window.__mqlDebug('[viewer.js] top-level IIFE entered; readyState=' + document.readyState); } catch (_) {}

  function post(type, message) {
    try {
      if (window.__mqlPost) window.__mqlPost(type, message || '');
      else window.webkit?.messageHandlers?.molstarQuickLook?.postMessage({ type, message: message || '' });
    } catch (_) {
      // Browser-only testing, not WKWebView.
    }
  }

  function setStatus(message, kind = 'info') {
    const text = String(message || '');
    if (status) {
      status.textContent = text;
      status.classList.toggle('error', kind === 'error');
      status.classList.toggle('hidden', kind !== 'error' && !window.MolstarQuickLookDebug);
    }
    if (shouldReportStatus(text, kind)) {
      post(kind === 'error' ? 'error' : 'status', text);
    }
  }

  function shouldReportStatus(text, kind) {
    if (kind === 'error' || window.MolstarQuickLookDebug) return true;
    return text.startsWith('[web] Loading Mol* engine') ||
      text.startsWith('[web] Mol* engine loaded') ||
      text.startsWith('[web] WebGL viewer created') ||
      text.startsWith('[web] Parsing structure') ||
      text.startsWith('[web] Rendered ');
  }

  function debug(message) {
    if (!window.MolstarQuickLookDebug) return;
    post('debug', message);
  }

  const layoutState = {
    left: 'collapsed',
    right: 'hidden',
    top: 'hidden',
    bottom: 'hidden'
  };

  let panelControlsVisible = window.MolstarQuickLookPanelControlsVisible !== false;

  function applyConfigOptions(config) {
    panelControlsVisible = config.showPanelControls !== undefined ? !!config.showPanelControls : panelControlsVisible;
    const nextLayoutState = config.defaultLayoutState;
    if (nextLayoutState && typeof nextLayoutState === 'object') {
      for (const key of ['left', 'right', 'top', 'bottom']) {
        if (['full', 'collapsed', 'hidden'].includes(nextLayoutState[key])) {
          layoutState[key] = nextLayoutState[key];
        }
      }
    }
    updateToolbarVisibility();
  }

  function updateToolbarVisibility() {
    const toolbar = document.getElementById('buret-toolbar');
    if (!toolbar) return;
    toolbar.querySelectorAll('.buret-panel-toggle').forEach(button => {
      button.classList.toggle('hidden', !panelControlsVisible);
    });
  }

  function initBuretToolbar(viewer) {
    const toolbar = document.getElementById('buret-toolbar');
    if (!toolbar) return;

    toolbar.querySelectorAll('[data-buret-action]').forEach(button => {
      button.addEventListener('click', () => {
        const action = button.getAttribute('data-buret-action');
        if (action === 'fit') {
          post('action', 'fit');
        }
      });
    });

    toolbar.querySelectorAll('[data-buret-toggle]').forEach(button => {
      button.addEventListener('click', () => {
        toggleLayoutRegion(button.getAttribute('data-buret-toggle'), viewer);
      });
    });

    initToolbarDrag(toolbar);
    updateToolbarVisibility();
    applyLayoutState(viewer);
  }

  function initToolbarDrag(toolbar) {
    try {
      const raw = window.localStorage && window.localStorage.getItem('buret.toolbar.position');
      if (raw) {
        const saved = JSON.parse(raw);
        if (Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
          toolbar.style.left = saved.left + 'px';
          toolbar.style.top = saved.top + 'px';
          toolbar.style.right = 'auto';
        }
      }
    } catch (_) {}

    let drag = null;
    toolbar.addEventListener('pointerdown', event => {
      if (!event.target.closest('[data-drag-handle]')) return;
      const rect = toolbar.getBoundingClientRect();
      drag = {
        dx: event.clientX - rect.left,
        dy: event.clientY - rect.top,
        pointerId: event.pointerId
      };
      toolbar.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    toolbar.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      moveToolbar(toolbar, event.clientX - drag.dx, event.clientY - drag.dy);
    });
    toolbar.addEventListener('pointerup', event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      drag = null;
      saveToolbarPosition(toolbar);
    });
    toolbar.addEventListener('pointercancel', () => { drag = null; });
    window.addEventListener('resize', () => {
      const rect = toolbar.getBoundingClientRect();
      moveToolbar(toolbar, rect.left, rect.top);
      saveToolbarPosition(toolbar);
    });
  }

  function moveToolbar(toolbar, left, top) {
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - toolbar.offsetWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - toolbar.offsetHeight - margin);
    toolbar.style.left = Math.min(Math.max(margin, left), maxLeft) + 'px';
    toolbar.style.top = Math.min(Math.max(margin, top), maxTop) + 'px';
    toolbar.style.right = 'auto';
  }

  function saveToolbarPosition(toolbar) {
    try {
      const rect = toolbar.getBoundingClientRect();
      window.localStorage && window.localStorage.setItem('buret.toolbar.position', JSON.stringify({ left: rect.left, top: rect.top }));
    } catch (_) {}
  }

  function toggleLayoutRegion(region, viewer) {
    if (region === 'left') layoutState.left = layoutState.left === 'full' ? 'collapsed' : 'full';
    if (region === 'right') layoutState.right = layoutState.right === 'full' ? 'hidden' : 'full';
    if (region === 'sequence') layoutState.top = layoutState.top === 'full' ? 'hidden' : 'full';
    if (region === 'log') layoutState.bottom = layoutState.bottom === 'full' ? 'hidden' : 'full';
    applyLayoutState(viewer);
  }

  function applyLayoutState(viewer) {
    try {
      viewer?.plugin?.layout?.setProps?.({ regionState: { ...layoutState } });
    } catch (error) {
      debug('layout.setProps failed: ' + (error && error.message || String(error)));
    }

    const root = document.querySelector('.msp-layout-expanded, .msp-layout-standard, .msp-layout-standard-reactive, .msp-layout-standard-landscape, .msp-layout-standard-portrait');
    if (root) {
      root.classList.toggle('msp-layout-collapse-left', layoutState.left === 'collapsed');
      root.classList.toggle('msp-layout-hide-left', layoutState.left === 'hidden');
      root.classList.toggle('msp-layout-hide-right', layoutState.right === 'hidden');
      root.classList.toggle('msp-layout-hide-top', layoutState.top === 'hidden');
      root.classList.toggle('msp-layout-hide-bottom', layoutState.bottom === 'hidden');
    }

    updateToolbarButtons();
    requestAnimationFrame(() => {
      try { viewer?.handleResize?.(); } catch (_) {}
      try { viewer?.plugin?.layout?.events?.updated?.next?.(); } catch (_) {}
    });
  }

  function updateToolbarButtons() {
    const toolbar = document.getElementById('buret-toolbar');
    if (!toolbar) return;
    toolbar.querySelector('[data-buret-toggle="left"]')?.classList.toggle('active', layoutState.left === 'full');
    toolbar.querySelector('[data-buret-toggle="right"]')?.classList.toggle('active', layoutState.right === 'full');
    toolbar.querySelector('[data-buret-toggle="sequence"]')?.classList.toggle('active', layoutState.top === 'full');
    toolbar.querySelector('[data-buret-toggle="log"]')?.classList.toggle('active', layoutState.bottom === 'full');
  }

  function loadScript(src, label, timeoutMs) {
    return new Promise(function (resolve, reject) {
      setStatus('Loading ' + label + '…');
      var script = document.createElement('script');
      var finished = false;
      var timer = setTimeout(function () {
        if (finished) return;
        finished = true;
        reject(new Error(label + ' did not finish loading within ' + Math.round(timeoutMs / 1000) + ' seconds (' + src + ').'));
      }, timeoutMs);
      script.async = false;
      script.onload = function () {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        debug('loaded ' + src);
        resolve();
      };
      script.onerror = function () {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        reject(new Error('Could not load ' + label + ' from ' + src + '.'));
      };
      script.src = src;
      document.head.appendChild(script);
    });
  }


  function hideStatus() {
    post('ready', 'ready');
    if (window.MolstarQuickLookDebug) return;
    if (status) status.classList.add('hidden');
  }

  function describeBytes(n) {
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  }

  function describeFormat(format, isBinary) {
    if (format === 'mmcif' && isBinary) return 'BinaryCIF';
    if (format === 'mmcif') return 'mmCIF';
    if (format === 'cifCore') return 'core-CIF fallback';
    return String(format || 'auto').toUpperCase();
  }

  function base64ToBytes(base64) {
    const raw = atob(base64 || '');
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  function base64ToText(base64) {
    const bytes = base64ToBytes(base64);
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }

  function normalizeFormat(format) {
    const value = String(format || 'auto').toLowerCase();
    if (value === 'cifcore' || value === 'corecif' || value === 'core-cif') return 'cifCore';
    if (value === 'cif' || value === 'mmcif' || value === 'mcif') return 'mmcif';
    if (value === 'bcif' || value === 'binarycif') return 'mmcif';
    if (value === 'sd') return 'sdf';
    return value;
  }

  function requireConfig() {
    const config = window.MolstarQuickLookConfig;
    if (!config || typeof config !== 'object') {
      throw new Error('preview-config.js did not define window.MolstarQuickLookConfig.');
    }
    if (!config.format) throw new Error('preview-config.js is missing format.');
    return config;
  }

  function rawStructureData(config) {
    const base64 = window.MolstarQuickLookDataBase64;
    if (!base64 || typeof base64 !== 'string') {
      throw new Error('preview-data.js did not define window.MolstarQuickLookDataBase64.');
    }
    return config.binary ? Array.from(base64ToBytes(base64)) : base64ToText(base64);
  }

  function structureDataForMolstar(config) {
    const normalized = normalizeFormat(config.format);
    if (normalized === 'cifCore') {
      const pdb = coreCifToPdb(rawStructureData({ ...config, binary: false }));
      return {
        data: pdb,
        format: 'pdb',
        label: `${config.label || 'structure'} (core-CIF asymmetric unit)`
      };
    }

    return {
      data: rawStructureData(config),
      format: normalized,
      label: config.label || 'structure'
    };
  }

  function withTimeout(promise, timeoutMs, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  function createViewerOptions() {
    return {
      // Keep the real Mol* application UI, not a minimal canvas-only preview.
      // This is intentionally close to https://molstar.org/viewer/: right controls,
      // sequence strip, import/session panels, toolbar buttons and full interactivity.
      layoutIsExpanded: true,
      layoutShowControls: true,
      layoutShowRemoteState: false,
      layoutShowSequence: true,
      layoutShowLog: true,
      layoutShowLeftPanel: true,
      viewportShowReset: false,
      viewportShowScreenshotControls: false,
      viewportShowControls: false,
      viewportShowExpand: false,
      viewportShowToggleFullscreen: false,
      viewportShowSelectionMode: false,
      viewportShowAnimation: false,
      viewportShowTrajectoryControls: false,
      viewportShowSettings: false,
      collapseLeftPanel: true,
      collapseRightPanel: true,
      pdbProvider: 'rcsb',
      emdbProvider: 'rcsb',
      preferWebgl1: true,
      disableAntialiasing: true,
      powerPreference: 'high-performance'
    };
  }

  async function createViewer() {
    debug('createViewer(): typeof molstar=' + typeof window.molstar + '; typeof Viewer=' + (window.molstar && typeof window.molstar.Viewer));
    if (!window.molstar || !window.molstar.Viewer) {
      throw new Error(
        'Mol* did not define window.molstar.Viewer. The vendored molstar.js file either did not load or is not build/viewer/molstar.js.'
      );
    }

    if (typeof window.molstar.Viewer.create === 'function') {
      return window.molstar.Viewer.create('app', createViewerOptions());
    }

    return new window.molstar.Viewer('app', createViewerOptions());
  }

  async function start() {
    debug('viewer.js executed');
    setStatus('[web] Booting Mol* Quick Look JavaScript…');

    const cb = window.MolstarQuickLookCacheBuster || String(Date.now());
    if (!window.MolstarQuickLookConfig) {
      await loadScript('./preview-config.js?v=' + encodeURIComponent(cb), 'preview config', 10000);
    }
    if (!window.MolstarQuickLookDataBase64) {
      await loadScript('./preview-data.js?v=' + encodeURIComponent(cb), 'structure data', 30000);
    }

    const config = requireConfig();
    applyConfigOptions(config);
    debug('config=' + JSON.stringify(config));
    const size = describeBytes(config.byteCount);
    const formatLabel = describeFormat(config.format, config.binary);

    if (!window.molstar) {
      setStatus(`[web] Loading Mol* engine…
${config.label || 'structure'} (${formatLabel}${size ? `, ${size}` : ''})`);
      await loadScript('./molstar.js?v=' + encodeURIComponent(cb), 'Mol* engine', 120000);
    }

    setStatus(`[web] Mol* engine loaded. Creating WebGL viewer…
${config.label || 'structure'} (${formatLabel}${size ? `, ${size}` : ''})`);
    await waitForFirstPaint();
    const viewer = await withTimeout(
      createViewer(),
      25000,
      'Mol* timed out while creating the WebGL viewer. This usually means WebKit/WebGL failed inside Quick Look.'
    );
    setStatus(`[web] WebGL viewer created. Parsing structure…
${config.label || 'structure'} (${formatLabel}${size ? `, ${size}` : ''})`);
    window.MolstarQuickLookViewer = viewer;
    window.MolstarQuickLookHandleResize = () => {
      try { viewer.handleResize(); } catch (_) {}
    };
    initBuretToolbar(viewer);

    await waitForAnimationFrame();
    applyLayoutState(viewer);
    try { viewer.handleResize(); } catch (_) {}

    debug('before structureDataForMolstar: base64 chars=' + (window.MolstarQuickLookDataBase64 ? window.MolstarQuickLookDataBase64.length : -1));
    const prepared = structureDataForMolstar(config);
    debug('prepared format=' + prepared.format + '; data type=' + (prepared.data && prepared.data.constructor ? prepared.data.constructor.name : typeof prepared.data) + '; data length=' + (prepared.data ? prepared.data.length : -1));
    setStatus(`[web] Parsing structure…\n${prepared.label} (${describeFormat(prepared.format, config.binary)})`);

    await withTimeout(
      viewer.loadStructureFromData(prepared.data, prepared.format, { dataLabel: prepared.label }),
      45000,
      `Mol* timed out while parsing/rendering ${prepared.label} as ${prepared.format}.`
    );

    window.addEventListener('resize', () => {
      try { viewer.handleResize(); } catch (_) {}
    });
    await waitForAnimationFrame();
    try { viewer.handleResize(); } catch (_) {}

    setStatus(`[web] Rendered ${config.label || 'structure'}`);
    setTimeout(hideStatus, 700);
  }

  function waitForFirstPaint() {
    return new Promise(resolve => {
      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };
      setTimeout(finish, 150);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setTimeout(finish, 50));
      });
    });
  }

  function waitForAnimationFrame(timeoutMs = 150) {
    return new Promise(resolve => {
      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };
      setTimeout(finish, timeoutMs);
      requestAnimationFrame(finish);
    });
  }

  function tokenizeCif(text) {
    const out = [];
    let i = 0;
    const n = text.length;
    while (i < n) {
      while (i < n && /\s/.test(text[i])) i++;
      if (i >= n) break;
      if (text[i] === '#') { while (i < n && text[i] !== '\n') i++; continue; }
      if ((i === 0 || text[i - 1] === '\n') && text[i] === ';') {
        i++;
        const start = i;
        let end = text.indexOf('\n;', i);
        if (end < 0) end = n;
        out.push(text.slice(start, end).trim());
        i = end < n ? end + 2 : n;
        continue;
      }
      const quote = text[i] === '"' || text[i] === "'" ? text[i] : null;
      if (quote) {
        i++;
        let value = '';
        while (i < n) {
          if (text[i] === quote && (i + 1 === n || /\s/.test(text[i + 1]))) { i++; break; }
          value += text[i++];
        }
        out.push(value);
        continue;
      }
      const start = i;
      while (i < n && !/\s/.test(text[i])) i++;
      out.push(text.slice(start, i));
    }
    return out;
  }

  function parseCif(text) {
    const tokens = tokenizeCif(text);
    const scalars = new Map();
    const loops = [];
    let i = 0;
    while (i < tokens.length) {
      const token = tokens[i];
      const lower = token.toLowerCase();
      if (lower === 'loop_') {
        i++;
        const tags = [];
        while (i < tokens.length && tokens[i].startsWith('_')) { tags.push(tokens[i].toLowerCase()); i++; }
        const values = [];
        while (i < tokens.length) {
          const t = tokens[i];
          const l = t.toLowerCase();
          if (l === 'loop_' || l.startsWith('data_')) break;
          if (t.startsWith('_') && values.length % Math.max(tags.length, 1) === 0) break;
          values.push(t);
          i++;
        }
        loops.push({ tags, values });
        continue;
      }
      if (token.startsWith('_') && i + 1 < tokens.length) { scalars.set(lower, tokens[i + 1]); i += 2; continue; }
      i++;
    }
    return { scalars, loops };
  }

  function parseFloatLoose(value) {
    if (value == null || value === '?' || value === '.') return NaN;
    return Number(String(value).replace(/\([^)]*\)$/u, ''));
  }

  function coreCifToPdb(text) {
    const cif = parseCif(text);
    const atomLoop = cif.loops.find(loop => {
      const tags = new Set(loop.tags);
      return (tags.has('_atom_site_fract_x') || tags.has('_atom_site_cartn_x')) &&
             (tags.has('_atom_site_label') || tags.has('_atom_site_type_symbol') || tags.has('_atom_site_label_atom_id'));
    });
    if (!atomLoop) throw new Error('Core-CIF fallback could not find an _atom_site loop with coordinates. This may be a crystallographic file that needs VESTA rather than Mol*.');

    const idx = Object.fromEntries(atomLoop.tags.map((tag, i) => [tag, i]));
    const width = atomLoop.tags.length;
    const atoms = [];
    const a = parseFloatLoose(cif.scalars.get('_cell_length_a'));
    const b = parseFloatLoose(cif.scalars.get('_cell_length_b'));
    const c = parseFloatLoose(cif.scalars.get('_cell_length_c'));
    const alpha = deg2rad(parseFloatLoose(cif.scalars.get('_cell_angle_alpha')) || 90);
    const beta = deg2rad(parseFloatLoose(cif.scalars.get('_cell_angle_beta')) || 90);
    const gamma = deg2rad(parseFloatLoose(cif.scalars.get('_cell_angle_gamma')) || 90);
    const haveCell = Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c);

    for (let rowStart = 0; rowStart + width <= atomLoop.values.length; rowStart += width) {
      const get = tag => {
        const j = idx[tag];
        return j == null ? undefined : atomLoop.values[rowStart + j];
      };
      const label = get('_atom_site_label') || get('_atom_site_label_atom_id') || get('_atom_site_auth_atom_id') || 'X';
      const element = cleanElement(get('_atom_site_type_symbol') || label);
      let x = parseFloatLoose(get('_atom_site_cartn_x'));
      let y = parseFloatLoose(get('_atom_site_cartn_y'));
      let z = parseFloatLoose(get('_atom_site_cartn_z'));
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        const fx = parseFloatLoose(get('_atom_site_fract_x'));
        const fy = parseFloatLoose(get('_atom_site_fract_y'));
        const fz = parseFloatLoose(get('_atom_site_fract_z'));
        if (!haveCell || !Number.isFinite(fx) || !Number.isFinite(fy) || !Number.isFinite(fz)) continue;
        [x, y, z] = fracToCart(fx, fy, fz, a, b, c, alpha, beta, gamma);
      }
      atoms.push({ label, element, x, y, z });
    }
    if (!atoms.length) throw new Error('Core-CIF fallback found an atom_site loop but no usable atom coordinates.');
    const lines = atoms.slice(0, 99999).map((atom, i) => pdbAtomLine(i + 1, atom));
    lines.push('END');
    return lines.join('\n') + '\n';
  }

  function deg2rad(x) { return x * Math.PI / 180; }

  function fracToCart(fx, fy, fz, a, b, c, alpha, beta, gamma) {
    const cosA = Math.cos(alpha), cosB = Math.cos(beta), cosG = Math.cos(gamma);
    const sinG = Math.sin(gamma) || 1;
    const ax = a, ay = 0, az = 0;
    const bx = b * cosG, by = b * sinG, bz = 0;
    const cx = c * cosB;
    const cy = c * (cosA - cosB * cosG) / sinG;
    const cz2 = c * c - cx * cx - cy * cy;
    const cz = Math.sqrt(Math.max(0, cz2));
    return [fx * ax + fy * bx + fz * cx, fx * ay + fy * by + fz * cy, fx * az + fy * bz + fz * cz];
  }

  function cleanElement(value) {
    const match = String(value || 'X').match(/[A-Za-z]{1,2}/u);
    if (!match) return 'X';
    const raw = match[0];
    return raw.length === 1 ? raw.toUpperCase() : raw[0].toUpperCase() + raw[1].toLowerCase();
  }

  function pdbAtomLine(serial, atom) {
    const elem = cleanElement(atom.element);
    const atomName = (atom.label || elem).replace(/[^A-Za-z0-9]/gu, '').slice(0, 4) || elem;
    return ['HETATM', String(serial).padStart(5, ' '), ' ', atomName.padStart(4, ' ').slice(0, 4), ' ', 'MOL', ' A', String(1).padStart(4, ' '), '    ', atom.x.toFixed(3).padStart(8, ' '), atom.y.toFixed(3).padStart(8, ' '), atom.z.toFixed(3).padStart(8, ' '), '  1.00', ' 10.00', '          ', elem.padStart(2, ' ')].join('');
  }

  function showError(error) {
    const message = error && (error.stack || error.message) ? (error.stack || error.message) : String(error);
    setStatus(`[web] Mol* failed to load this file.\n\n${message}\n\nCheck: ./scripts/tail-log.sh`, 'error');
    // eslint-disable-next-line no-console
    console.error(error);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => start().catch(showError));
  } else {
    start().catch(showError);
  }
})();
