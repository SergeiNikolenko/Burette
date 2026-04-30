(() => {
  'use strict';

  const status = document.getElementById('status');
  const MAX_SDF_GRID_MOLECULES = 64;
  const MAX_SDF_GRID_ATOMS = 900;
  const MAX_SDF_GRID_BONDS = 900;
  const SDF_GRID_PADDING = 4.0;
  const TOOLBAR_POSITION_VERSION = '7';
  const TOOLBAR_MARGIN = 12;
  const VIEWER_THEME_STORAGE_KEY = 'buret.viewer.theme';
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
  try { window.__mqlDebug && window.__mqlDebug('[viewer.js] top-level IIFE entered; readyState=' + document.readyState); } catch (_) {}

  function post(type, message) {
    try {
      if (window.__mqlPost) window.__mqlPost(type, message || '');
      else postHostMessage({ type, message: message || '' });
    } catch (_) {
      // Browser-only testing, not WKWebView.
    }
  }

  function postHostMessage(payload) {
    try {
      window.webkit?.messageHandlers?.burrete?.postMessage(payload);
      return !!window.webkit?.messageHandlers?.burrete;
    } catch (_) {
      return false;
    }
  }

  function setStatus(message, kind = 'info') {
    const text = String(message || '');
    if (status) {
      status.textContent = text;
      status.classList.toggle('error', kind === 'error');
      status.classList.toggle('hidden', kind !== 'error' && !window.BurreteDebug);
    }
    if (shouldReportStatus(text, kind)) {
      post(kind === 'error' ? 'error' : 'status', text);
    }
  }

  function shouldReportStatus(text, kind) {
    if (kind === 'error' || window.BurreteDebug) return true;
    return text.startsWith('[web] Loading Mol* engine') ||
      text.startsWith('[web] Mol* engine loaded') ||
      text.startsWith('[web] Loading Fast XYZ renderer') ||
      text.startsWith('[web] Fast XYZ renderer loaded') ||
      text.startsWith('[web] Loading xyzrender artifact') ||
      text.startsWith('[web] WebGL viewer created') ||
      text.startsWith('[web] Parsing structure') ||
      text.startsWith('[web] Rendered ');
  }

  function debug(message) {
    if (!window.BurreteDebug) return;
    post('debug', message);
  }

  const layoutState = {
    left: 'collapsed',
    right: 'hidden',
    top: 'hidden',
    bottom: 'hidden'
  };
  const resizeState = {
    viewer: null,
    frame: 0,
    timer: 0
  };

  function scheduleViewerResize(viewer, delayMs = 80) {
    if (!viewer) return;
    resizeState.viewer = viewer;
    if (resizeState.frame) return;
    resizeState.frame = requestAnimationFrame(() => {
      resizeState.frame = 0;
      clearTimeout(resizeState.timer);
      resizeState.timer = setTimeout(() => {
        const target = resizeState.viewer;
        if (!target) return;
        let handled = false;
        try {
          if (typeof target.handleResize === 'function') {
            target.handleResize();
            handled = true;
          }
        } catch (_) {}
        if (!handled) {
          try { target.plugin?.layout?.events?.updated?.next?.(); } catch (_) {}
        }
      }, delayMs);
    });
  }

  const DEFAULT_VIEWER_UI_SCALE = 1.0;
  const MIN_VIEWER_UI_SCALE = 1.0;
  const MAX_VIEWER_UI_SCALE = 1.0;
  const VIEWER_UI_SCALE_STEP = 0.08;

  let panelControlsVisible = window.BurretePanelControlsVisible !== false;
  let transparentBackground = false;
  let viewerTheme = 'auto';
  let canvasBackground = 'auto';
  let overlayOpacity = 0.90;
  let viewerUIScale = DEFAULT_VIEWER_UI_SCALE;
  let activeViewer = null;
  let keyboardShortcutsInstalled = false;
  let themeListenerInstalled = false;

  function applyConfigOptions(config) {
    panelControlsVisible = config.showPanelControls !== undefined ? !!config.showPanelControls : panelControlsVisible;
    viewerTheme = normalizeViewerTheme(config.theme);
    canvasBackground = normalizeCanvasBackground(config.canvasBackground);
    overlayOpacity = normalizeOverlayOpacity(config.overlayOpacity);
    transparentBackground = canvasBackground === 'transparent' || config.transparentBackground === true;
    applyDocumentBackground();
    viewerUIScale = resolveInitialViewerScale(config);
    applyViewerUIScale();
    const nextLayoutState = config.defaultLayoutState;
    if (nextLayoutState && typeof nextLayoutState === 'object') {
      for (const key of ['left', 'right', 'top', 'bottom']) {
        if (['full', 'collapsed', 'hidden'].includes(nextLayoutState[key])) {
          layoutState[key] = nextLayoutState[key];
        }
      }
    }
    applyBackgroundMode();
    installThemeListener();
    updateToolbarVisibility();
    configureRendererControls(config);
  }

  function applyBackgroundMode() {
    if (!document.body) return;
    const resolvedTheme = resolveViewerTheme();
    document.documentElement.dataset.buretTheme = resolvedTheme;
    document.body.dataset.buretTheme = resolvedTheme;
    document.body.classList.toggle('buret-theme-dark', resolvedTheme === 'dark');
    document.body.classList.toggle('buret-theme-light', resolvedTheme === 'light');
    document.body.classList.toggle('burette-transparent-background', transparentBackground);
    document.body.classList.toggle('burette-opaque-background', !transparentBackground);
    document.documentElement.style.setProperty('--buret-canvas-background', canvasBackgroundCSS());
    document.documentElement.style.setProperty('--buret-overlay-opacity', overlayOpacity.toFixed(2));
    document.documentElement.style.setProperty('--buret-overlay-strong-opacity', Math.min(overlayOpacity + 0.06, 0.99).toFixed(2));
    updateThemeButton();
  }

  function normalizeViewerTheme(value) {
    return ['dark', 'light', 'auto'].includes(value) ? value : 'auto';
  }

  function readStoredViewerTheme() {
    try {
      const storedTheme = window.localStorage && window.localStorage.getItem(VIEWER_THEME_STORAGE_KEY);
      return storedTheme === 'dark' || storedTheme === 'light' ? storedTheme : null;
    } catch (_) {
      return null;
    }
  }

  function resolveViewerTheme() {
    if (viewerTheme === 'dark' || viewerTheme === 'light') return viewerTheme;
    try {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    } catch (_) {
      return 'dark';
    }
  }

  function installThemeListener() {
    if (themeListenerInstalled || !window.matchMedia) return;
    themeListenerInstalled = true;
    try {
      const media = window.matchMedia('(prefers-color-scheme: light)');
      const update = () => {
        if (viewerTheme !== 'auto') return;
        applyBackgroundMode();
        applyViewerBackground();
      };
      if (typeof media.addEventListener === 'function') media.addEventListener('change', update);
      else if (typeof media.addListener === 'function') media.addListener(update);
    } catch (_) {}
  }

  function normalizeCanvasBackground(value) {
    return ['auto', 'black', 'graphite', 'white', 'transparent'].includes(value) ? value : 'auto';
  }

  function normalizeOverlayOpacity(value) {
    const opacity = Number(value);
    if (!Number.isFinite(opacity)) return 0.90;
    return Math.min(Math.max(opacity, 0.72), 0.98);
  }

  function resolvedCanvasBackground() {
    if (canvasBackground === 'auto') return resolveViewerTheme() === 'light' ? 'white' : 'black';
    return canvasBackground;
  }

  function canvasBackgroundCSS() {
    const background = resolvedCanvasBackground();
    if (background === 'white') return '#f7f7f2';
    if (background === 'graphite') return '#111317';
    if (background === 'transparent') return 'transparent';
    return '#000000';
  }

  function canvasBackgroundColor() {
    const background = resolvedCanvasBackground();
    if (background === 'white') return 0xf7f7f2;
    if (background === 'graphite') return 0x111317;
    return 0x000000;
  }

  function resolveInitialViewerScale(config) {
    const scale = Number(config.uiScale);
    return clampViewerScale(Number.isFinite(scale) ? scale : DEFAULT_VIEWER_UI_SCALE);
  }

  function clampViewerScale(scale) {
    return Math.min(Math.max(scale, MIN_VIEWER_UI_SCALE), MAX_VIEWER_UI_SCALE);
  }

  function applyViewerUIScale(viewer = activeViewer) {
    // Mol* WebGL picking uses unscaled client coordinates; page/body zoom makes
    // hover and click loci drift away from the visible cursor position.
    postHostMessage({ type: 'viewerZoom', value: DEFAULT_VIEWER_UI_SCALE });
    document.documentElement.style.setProperty('--buret-viewer-ui-scale', '1');
    if (document.body) {
      document.body.style.zoom = '';
    }

    const pluginRoot = document.querySelector('.msp-plugin');
    if (pluginRoot) {
      pluginRoot.style.zoom = '';
      pluginRoot.style.width = '100%';
      pluginRoot.style.height = '100%';
    }

    requestAnimationFrame(() => {
      try { viewer?.handleResize?.(); } catch (_) {}
      try { viewer?.plugin?.layout?.events?.updated?.next?.(); } catch (_) {}
    });
  }

  function applyDocumentBackground() {
    document.documentElement.classList.toggle('buret-transparent-background', transparentBackground);
    if (document.body) {
      document.body.classList.toggle('buret-transparent-background', transparentBackground);
    }
  }

  function applyViewerBackground(viewer = activeViewer) {
    applyDocumentBackground();
    const canvas3d = viewer?.plugin?.canvas3d;
    if (!canvas3d) return;
    try {
      if (transparentBackground) {
        canvas3d.setProps({ transparentBackground: true });
      } else {
        canvas3d.setProps({ transparentBackground: false, renderer: { backgroundColor: canvasBackgroundColor() } });
      }
    } catch (error) {
      debug('canvas3d background mode failed: ' + (error && error.message || String(error)));
    }
    try { canvas3d.requestDraw?.(); } catch (_) {}
  }

  function setViewerTheme(theme, viewer = activeViewer, persist = true) {
    viewerTheme = normalizeViewerTheme(theme);
    if (viewerTheme === 'dark') {
      canvasBackground = 'black';
      transparentBackground = false;
    } else if (viewerTheme === 'light') {
      canvasBackground = 'white';
      transparentBackground = false;
    }
    if (persist) {
      try {
        window.localStorage && window.localStorage.setItem(VIEWER_THEME_STORAGE_KEY, viewerTheme);
      } catch (_) {}
    }
    applyBackgroundMode();
    applyViewerBackground(viewer);
    updateThemeButton();
    scheduleViewerResize(viewer, 40);
  }

  function toggleViewerTheme(viewer = activeViewer) {
    setViewerTheme(resolveViewerTheme() === 'dark' ? 'light' : 'dark', viewer);
  }

  function setViewerUIScale(scale, viewer = activeViewer) {
    viewerUIScale = clampViewerScale(scale);
    applyViewerUIScale(viewer);
  }

  function initViewerKeyboardShortcuts(viewer) {
    if (keyboardShortcutsInstalled) return;
    keyboardShortcutsInstalled = true;

    document.addEventListener('keydown', event => {
      if (event.defaultPrevented || !event.metaKey || event.ctrlKey || event.altKey) return;
      const tagName = event.target?.tagName?.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return;

      if (event.key === '+' || event.key === '=' || event.key === 'Add') {
        event.preventDefault();
        setViewerUIScale(viewerUIScale + VIEWER_UI_SCALE_STEP, viewer);
        return;
      }

      if (event.key === '-' || event.key === '_' || event.key === 'Subtract') {
        event.preventDefault();
        setViewerUIScale(viewerUIScale - VIEWER_UI_SCALE_STEP, viewer);
        return;
      }

      if (event.key === '0') {
        event.preventDefault();
        setViewerUIScale(DEFAULT_VIEWER_UI_SCALE, viewer);
      }
    }, true);
  }

  function updateToolbarVisibility() {
    const toolbar = document.getElementById('buret-toolbar');
    if (!toolbar) return;
    toolbar.querySelectorAll('.buret-panel-toggle').forEach(button => {
      button.classList.toggle('hidden', !panelControlsVisible);
    });
  }

  function configureRendererControls(config) {
    const control = document.querySelector('[data-buret-renderer-control]');
    if (!control) return;
    const format = normalizeFormat(config.molstarFormat || config.format);
    const canSwitchRenderer = config.appViewer === true && (format === 'xyz' || format === 'sdf');
    control.classList.toggle('visible', canSwitchRenderer);
    if (!canSwitchRenderer) return;

    const renderer = normalizeRenderer(config.renderer);
    control.querySelectorAll('[data-buret-renderer]').forEach(button => {
      const value = button.getAttribute('data-buret-renderer');
      const isFastXYZOnly = value === 'xyz-fast';
      button.classList.toggle('hidden', isFastXYZOnly && format !== 'xyz');
      button.classList.toggle('active', value === renderer);
      if (control.dataset.rendererBound !== '1') {
        button.addEventListener('click', () => requestRendererSwitch(value));
      }
    });

    const select = control.querySelector('[data-buret-xyzrender-preset]');
    if (select) {
      populateXyzrenderPresetSelect(select, config.xyzrenderPresetOptions);
      select.value = normalizeXyzrenderPreset(config.externalArtifact?.preset || config.xyzrenderPreset || 'default');
      select.disabled = renderer !== 'xyzrender-external';
      if (control.dataset.presetBound !== '1') {
        select.addEventListener('change', () => requestXyzrenderPreset(select.value));
      }
    }
    control.dataset.rendererBound = '1';
    control.dataset.presetBound = '1';
  }

  function populateXyzrenderPresetSelect(select, options) {
    if (select.dataset.populated === '1') return;
    const rows = Array.isArray(options) && options.length ? options : DEFAULT_XYZRENDER_PRESETS;
    select.innerHTML = '';
    for (const row of rows) {
      const value = normalizeXyzrenderPreset(row.value);
      const option = document.createElement('option');
      option.value = value;
      option.textContent = String(row.label || value);
      select.appendChild(option);
    }
    select.dataset.populated = '1';
  }

  function normalizeXyzrenderPreset(value) {
    const raw = String(value || 'default').trim().toLowerCase();
    return DEFAULT_XYZRENDER_PRESETS.some(row => row.value === raw) ? raw : 'default';
  }

  function requestRendererSwitch(renderer) {
    const value = normalizeRenderer(renderer);
    const sent = postHostMessage({ type: 'setRenderer', value });
    if (!sent) setStatus('Renderer switching is available only in the standalone app viewer.', 'error');
  }

  function requestXyzrenderPreset(preset) {
    const value = normalizeXyzrenderPreset(preset);
    const sent = postHostMessage({ type: 'setXyzrenderPreset', value });
    if (!sent) setStatus('xyzrender preset switching is available only in the standalone app viewer.', 'error');
  }

  function initBuretToolbar(viewer) {
    const toolbar = document.getElementById('buret-toolbar');
    if (!toolbar) return;

    toolbar.querySelectorAll('[data-buret-toggle]').forEach(button => {
      button.addEventListener('click', () => {
        toggleLayoutRegion(button.getAttribute('data-buret-toggle'), viewer);
      });
    });
    toolbar.querySelector('[data-buret-action="theme"]')?.addEventListener('click', () => {
      toggleViewerTheme(viewer);
    });

    initToolbarDrag(toolbar);
    restoreToolbarCollapsed(toolbar, viewer);
    updateToolbarVisibility();
    updateThemeButton();
    applyLayoutState(viewer);
  }

  function restoreToolbarCollapsed(toolbar, viewer) {
    let collapsed = false;
    try {
      collapsed = window.localStorage && window.localStorage.getItem('buret.toolbar.collapsed') === '1';
    } catch (_) {}
    setToolbarCollapsed(toolbar, collapsed, viewer, false);
  }

  function setToolbarCollapsed(toolbar, collapsed, viewer, persist = true) {
    toolbar.classList.toggle('collapsed', collapsed);
    const grip = toolbar.querySelector('[data-drag-handle]');
    if (grip) {
      grip.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      grip.setAttribute('aria-label', collapsed ? 'Expand controls' : 'Collapse controls');
      grip.setAttribute('title', collapsed ? 'Expand controls' : 'Collapse controls');
    }
    if (persist) {
      try {
        window.localStorage && window.localStorage.setItem('buret.toolbar.collapsed', collapsed ? '1' : '0');
      } catch (_) {}
    }
    repositionToolbar(toolbar);
    scheduleViewerResize(viewer, 40);
  }

  function initToolbarDrag(toolbar) {
    let hasSavedPosition = false;
    try {
      const raw = window.localStorage && window.localStorage.getItem('buret.toolbar.position');
      const version = window.localStorage && window.localStorage.getItem('buret.toolbar.position.version');
      if (raw && version === TOOLBAR_POSITION_VERSION) {
        const saved = JSON.parse(raw);
        if (saved.mode === 'custom' && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
          toolbar.style.left = saved.left + 'px';
          toolbar.style.top = saved.top + 'px';
          toolbar.style.right = 'auto';
          toolbar.dataset.defaultPosition = '0';
          hasSavedPosition = true;
        }
      } else if (raw) {
        window.localStorage && window.localStorage.removeItem('buret.toolbar.position');
      }
    } catch (_) {}
    if (!hasSavedPosition) applyDefaultToolbarPosition(toolbar);

    let drag = null;
    toolbar.addEventListener('pointerdown', event => {
      if (event.target.closest('[data-buret-toggle]')) return;
      if (event.target.closest('select, input, textarea')) return;
      if (!event.target.closest('[data-drag-handle]') && event.target.closest('.buret-button')) return;
      const rect = toolbar.getBoundingClientRect();
      drag = {
        dx: event.clientX - rect.left,
        dy: event.clientY - rect.top,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startedOnHandle: !!event.target.closest('[data-drag-handle]'),
        moved: false
      };
      toolbar.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    toolbar.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!drag.moved) {
        drag.moved = Math.abs(event.clientX - drag.startX) > 4 || Math.abs(event.clientY - drag.startY) > 4;
      }
      if (drag.moved) {
        moveToolbar(toolbar, event.clientX - drag.dx, event.clientY - drag.dy);
      }
    });
    toolbar.addEventListener('pointerup', event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const shouldToggle = !drag.moved && drag.startedOnHandle;
      try { toolbar.releasePointerCapture(event.pointerId); } catch (_) {}
      drag = null;
      if (shouldToggle) {
        setToolbarCollapsed(toolbar, !toolbar.classList.contains('collapsed'), resizeState.viewer);
      } else {
        toolbar.dataset.defaultPosition = '0';
        saveToolbarPosition(toolbar);
      }
    });
    toolbar.addEventListener('pointercancel', () => { drag = null; });
    window.addEventListener('resize', () => {
      repositionToolbar(toolbar);
    });
  }

  function repositionToolbar(toolbar) {
    if (toolbar.dataset.defaultPosition === '1') {
      applyDefaultToolbarPosition(toolbar);
      return;
    }

    const rect = toolbar.getBoundingClientRect();
    moveToolbar(toolbar, rect.left, rect.top);
    saveToolbarPosition(toolbar);
  }

  function applyDefaultToolbarPosition(toolbar) {
    const main = document.querySelector('.msp-plugin .msp-layout-main');
    const rect = main && main.getBoundingClientRect();
    const viewportControls = document.querySelector('.msp-plugin .msp-viewport-controls');
    const controlsRect = viewportControls && viewportControls.getBoundingClientRect();
    const controlsVisible = controlsRect &&
      controlsRect.width > 0 &&
      controlsRect.height > 0 &&
      window.getComputedStyle(viewportControls).display !== 'none';
    const right = controlsVisible ? controlsRect.left - TOOLBAR_MARGIN : window.innerWidth - TOOLBAR_MARGIN;
    const left = right - toolbar.offsetWidth;
    const top = Math.max(toolbarSafeTop(), rect && rect.height > 0 ? rect.top + TOOLBAR_MARGIN : TOOLBAR_MARGIN);
    toolbar.dataset.defaultPosition = '1';
    moveToolbar(toolbar, left, top);
  }

  function moveToolbar(toolbar, left, top) {
    const margin = TOOLBAR_MARGIN;
    const safeTop = toolbarSafeTop();
    const maxLeft = Math.max(margin, window.innerWidth - toolbar.offsetWidth - margin);
    const maxTop = Math.max(safeTop, window.innerHeight - toolbar.offsetHeight - margin);
    toolbar.style.left = Math.min(Math.max(margin, left), maxLeft) + 'px';
    toolbar.style.top = Math.min(Math.max(safeTop, top), maxTop) + 'px';
    toolbar.style.right = 'auto';
  }

  function toolbarSafeTop() {
    const raw = window.getComputedStyle(document.documentElement).getPropertyValue('--buret-toolbar-safe-top');
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? Math.max(TOOLBAR_MARGIN, parsed) : TOOLBAR_MARGIN;
  }

  function saveToolbarPosition(toolbar) {
    try {
      const rect = toolbar.getBoundingClientRect();
      window.localStorage && window.localStorage.setItem('buret.toolbar.position', JSON.stringify({ left: rect.left, top: rect.top, mode: 'custom' }));
      window.localStorage && window.localStorage.setItem('buret.toolbar.position.version', TOOLBAR_POSITION_VERSION);
    } catch (_) {}
  }

  function toggleLayoutRegion(region, viewer) {
    if (region === 'left') layoutState.left = layoutState.left === 'full' ? 'hidden' : 'full';
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
    scheduleViewerResize(viewer, 40);
    const toolbar = document.getElementById('buret-toolbar');
    if (toolbar?.dataset.defaultPosition === '1') {
      requestAnimationFrame(() => applyDefaultToolbarPosition(toolbar));
      setTimeout(() => applyDefaultToolbarPosition(toolbar), 120);
    }
  }

  function updateToolbarButtons() {
    const toolbar = document.getElementById('buret-toolbar');
    if (!toolbar) return;
    toolbar.querySelector('[data-buret-toggle="left"]')?.classList.toggle('active', layoutState.left === 'full');
    toolbar.querySelector('[data-buret-toggle="right"]')?.classList.toggle('active', layoutState.right === 'full');
    toolbar.querySelector('[data-buret-toggle="sequence"]')?.classList.toggle('active', layoutState.top === 'full');
    toolbar.querySelector('[data-buret-toggle="log"]')?.classList.toggle('active', layoutState.bottom === 'full');
  }

  function updateThemeButton() {
    const button = document.querySelector('#buret-toolbar [data-buret-action="theme"]');
    if (!button) return;
    const isDark = resolveViewerTheme() === 'dark';
    button.textContent = isDark ? 'Light' : 'Dark';
    button.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
    button.setAttribute('title', isDark ? 'Switch to light theme' : 'Switch to dark theme');
    button.classList.toggle('active', !isDark);
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
    if (window.BurreteDebug) return;
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
    const config = window.BurreteConfig;
    if (!config || typeof config !== 'object') {
      throw new Error('preview-config.js did not define window.BurreteConfig.');
    }
    if (!config.format) throw new Error('preview-config.js is missing format.');
    return config;
  }

  function rawStructureData(config) {
    const base64 = window.BurreteDataBase64;
    if (!base64 || typeof base64 !== 'string') {
      throw new Error('preview-data.js did not define window.BurreteDataBase64.');
    }
    return config.binary ? Array.from(base64ToBytes(base64)) : base64ToText(base64);
  }

  function normalizeRenderer(renderer) {
    const value = String(renderer || 'molstar').toLowerCase();
    if (value === 'xyz-fast' || value === 'fast-xyz' || value === 'xyzfast') return 'xyz-fast';
    if (value === 'xyzrender-external' || value === 'external-xyzrender') return 'xyzrender-external';
    return 'molstar';
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
    if (normalized === 'sdf') {
      return prepareSdfStructure(rawStructureData(config), config);
    }

    return {
      data: rawStructureData(config),
      format: normalized,
      label: config.label || 'structure'
    };
  }

  async function startXYZFast(config, cb) {
    const label = config.label || 'structure';
    const size = describeBytes(config.byteCount);
    setStatus(`[web] Loading Fast XYZ renderer…\n${label} (XYZ${size ? `, ${size}` : ''})`);
    if (!window.BurreteXYZFast) {
      await loadScript('./xyz-fast.js?v=' + encodeURIComponent(cb), 'Fast XYZ renderer', 10000);
    }
    if (!window.BurreteXYZFast || typeof window.BurreteXYZFast.render !== 'function') {
      throw new Error('xyz-fast.js did not define window.BurreteXYZFast.render.');
    }

    setStatus(`[web] Fast XYZ renderer loaded. Rendering static preview…\n${label}`);
    const container = document.getElementById('app');
    const result = window.BurreteXYZFast.render({
      container,
      text: rawStructureData({ ...config, binary: false }),
      config
    });
    initStaticRendererToolbar();
    const fallback = config.externalRendererStatus?.status === 'fallback' ? `\nExternal xyzrender fallback: ${config.externalRendererStatus.message || 'not available'}` : '';
    setStatus(`[web] Rendered ${label} with Fast XYZ SVG (${result.atoms} atoms, ${result.bonds} bonds)${fallback}`);
    setTimeout(hideStatus, 450);
  }

  async function startExternalArtifact(config) {
    const artifact = config.externalArtifact;
    if (!artifact || !artifact.path) {
      throw new Error('External xyzrender renderer was selected, but no externalArtifact path was provided.');
    }
    const path = safeRelativeArtifactPath(artifact.path);
    setStatus(`[web] Loading xyzrender artifact…\n${config.label || 'structure'}`);
    installExternalArtifactStyles();
    const container = document.getElementById('app');
    const preset = artifact.preset ? ` · ${escapeHTML(artifact.preset)}` : '';
    const elapsed = Number.isFinite(Number(artifact.elapsedMs)) ? ` · ${Number(artifact.elapsedMs)} ms` : '';
    container.innerHTML = `
      <div class="buret-external-artifact-root">
        <object class="buret-external-artifact-object" data="${path}" type="image/svg+xml" aria-label="${escapeHTML(config.label || 'xyzrender artifact')}"></object>
        <div class="buret-xyz-badge"><strong>External xyzrender</strong><span>SVG${preset}${elapsed}</span></div>
      </div>`;
    initStaticRendererToolbar();
    setStatus(`[web] Rendered ${config.label || 'structure'} with external xyzrender`);
    setTimeout(hideStatus, 450);
  }

  function initStaticRendererToolbar() {
    const toolbar = document.getElementById('buret-toolbar');
    if (!toolbar) return;
    toolbar.querySelectorAll('.buret-panel-toggle').forEach(button => { button.classList.add('hidden'); });
    initToolbarDrag(toolbar);
    restoreToolbarCollapsed(toolbar, null);
  }

  function safeRelativeArtifactPath(path) {
    const value = String(path || '').trim();
    if (!value || value.includes('..') || value.startsWith('/') || !/^[A-Za-z0-9_.\/-]+$/u.test(value)) {
      throw new Error('Unsafe external artifact path: ' + value);
    }
    return value;
  }

  function escapeHTML(value) {
    return String(value == null ? '' : value)
      .replace(/&/gu, '&amp;')
      .replace(/</gu, '&lt;')
      .replace(/>/gu, '&gt;')
      .replace(/"/gu, '&quot;')
      .replace(/'/gu, '&#39;');
  }

  function installExternalArtifactStyles() {
    if (document.getElementById('buret-external-artifact-style')) return;
    const style = document.createElement('style');
    style.id = 'buret-external-artifact-style';
    style.textContent = `
      .buret-external-artifact-root { position: absolute; inset: 0; overflow: hidden; background: var(--buret-shell-background, #000); }
      body.burette-transparent-background .buret-external-artifact-root { background: transparent; }
      .buret-external-artifact-object { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block; }
      .buret-xyz-badge { position: absolute; left: 14px; bottom: 14px; z-index: 30; max-width: calc(100vw - 28px); box-sizing: border-box; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--buret-toolbar-border, rgba(255,255,255,0.12)); color: var(--buret-toolbar-color, rgba(255,255,255,0.92)); background: var(--buret-toolbar-background, rgba(12,13,14,0.9)); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); box-shadow: 0 8px 22px rgba(0,0,0,0.20); font: 11px/1.35 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; pointer-events: none; }
      .buret-xyz-badge strong { display: block; font-size: 11px; }
      .buret-xyz-badge span { display: block; opacity: 0.76; }
    `;
    document.head.appendChild(style);
  }

  function prepareSdfStructure(text, config) {
    const label = config.label || 'structure';
    const records = splitSdfRecords(text);
    if (records.length > 1 && config.sdfGrid !== false) {
      const grid = buildSdfGrid(records, label);
      if (grid) return grid;
    }
    return {
      data: text,
      format: 'sdf',
      label: records.length > 1 ? `${label} (${records.length} SDF records)` : label,
      loadPreset: records.length > 1 ? 'all-models' : 'default'
    };
  }

  function splitSdfRecords(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const records = [];
    let current = [];
    for (const line of lines) {
      if (line.trim() === '$$$$') {
        const record = current.join('\n').trimEnd();
        if (record.trim()) records.push(record);
        current = [];
      } else {
        current.push(line);
      }
    }
    const tail = current.join('\n').trimEnd();
    if (tail.trim()) records.push(tail);
    return records;
  }

  function buildSdfGrid(records, label) {
    const molecules = [];
    let totalAtoms = 0;
    let totalBonds = 0;
    for (const record of records) {
      if (molecules.length >= MAX_SDF_GRID_MOLECULES) break;
      const molecule = parseV2000SdfRecord(record);
      if (!molecule) continue;
      if (totalAtoms + molecule.atomCount > MAX_SDF_GRID_ATOMS ||
          totalBonds + molecule.bondCount > MAX_SDF_GRID_BONDS) {
        break;
      }
      molecules.push(molecule);
      totalAtoms += molecule.atomCount;
      totalBonds += molecule.bondCount;
    }
    if (molecules.length <= 1 || totalAtoms > 999 || totalBonds > 999) return null;

    const columns = Math.max(1, Math.ceil(Math.sqrt(molecules.length)));
    const rows = Math.ceil(molecules.length / columns);
    const cellWidth = Math.max(2, ...molecules.map(m => Math.max(2, m.width))) + SDF_GRID_PADDING;
    const cellHeight = Math.max(2, ...molecules.map(m => Math.max(2, m.height))) + SDF_GRID_PADDING;
    const gridWidth = (columns - 1) * cellWidth;
    const gridHeight = (rows - 1) * cellHeight;

    const atoms = [];
    const bonds = [];
    let atomOffset = 0;
    molecules.forEach((molecule, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const targetX = column * cellWidth - gridWidth / 2;
      const targetY = gridHeight / 2 - row * cellHeight;
      const dx = targetX - molecule.centerX;
      const dy = targetY - molecule.centerY;
      for (const atom of molecule.atoms) {
        atoms.push(formatSdfAtomLine(atom, atom.x + dx, atom.y + dy, atom.z));
      }
      for (const bond of molecule.bonds) {
        bonds.push(formatSdfBondLine(bond, atomOffset));
      }
      atomOffset += molecule.atomCount;
    });

    return {
      data: [
        'Burrete SDF Grid',
        '  Burrete',
        `${molecules.length} of ${records.length} SDF records`,
        formatSdfCountsLine(totalAtoms, totalBonds),
        ...atoms,
        ...bonds,
        'M  END',
        '$$$$',
        ''
      ].join('\n'),
      format: 'sdf',
      label: `${label} (grid: ${molecules.length}${records.length > molecules.length ? ` of ${records.length}` : ''} molecules)`,
      loadPreset: 'default'
    };
  }

  function parseV2000SdfRecord(record) {
    const lines = String(record || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (lines.length < 4 || !lines[3].includes('V2000')) return null;
    const atomCount = parseInt(lines[3].slice(0, 3), 10);
    const bondCount = parseInt(lines[3].slice(3, 6), 10);
    if (!Number.isFinite(atomCount) || !Number.isFinite(bondCount) || atomCount <= 0 ||
        lines.length < 4 + atomCount + bondCount) {
      return null;
    }

    const atoms = [];
    for (let i = 0; i < atomCount; i++) {
      const line = lines[4 + i] || '';
      const atom = parseSdfAtomLine(line);
      if (!atom) return null;
      atoms.push(atom);
    }
    const bonds = [];
    for (let i = 0; i < bondCount; i++) {
      const bond = parseSdfBondLine(lines[4 + atomCount + i] || '');
      if (!bond) return null;
      bonds.push(bond);
    }

    const xs = atoms.map(atom => atom.x);
    const ys = atoms.map(atom => atom.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return {
      atomCount,
      bondCount,
      atoms,
      bonds,
      width: maxX - minX,
      height: maxY - minY,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2
    };
  }

  function parseSdfAtomLine(line) {
    let x = Number(line.slice(0, 10));
    let y = Number(line.slice(10, 20));
    let z = Number(line.slice(20, 30));
    let tail = line.length >= 30 ? line.slice(30) : '';
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      const parts = line.trim().split(/\s+/);
      x = Number(parts[0]);
      y = Number(parts[1]);
      z = Number(parts[2]);
      tail = ` ${parts[3] || 'C'}   0  0  0  0  0  0  0  0  0  0  0  0`;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return { x, y, z, tail: tail || ' C   0  0  0  0  0  0  0  0  0  0  0  0' };
  }

  function parseSdfBondLine(line) {
    let a = parseInt(line.slice(0, 3), 10);
    let b = parseInt(line.slice(3, 6), 10);
    let tail = line.length >= 6 ? line.slice(6) : '';
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      const parts = line.trim().split(/\s+/);
      a = parseInt(parts[0], 10);
      b = parseInt(parts[1], 10);
      tail = ` ${parts[2] || '1'}  0  0  0  0`;
    }
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return { a, b, tail: tail || '  1  0  0  0  0' };
  }

  function formatSdfCountsLine(atomCount, bondCount) {
    return `${padSdfInt(atomCount)}${padSdfInt(bondCount)}  0  0  0  0            999 V2000`;
  }

  function formatSdfAtomLine(atom, x, y, z) {
    return `${formatSdfCoord(x)}${formatSdfCoord(y)}${formatSdfCoord(z)}${atom.tail}`;
  }

  function formatSdfBondLine(bond, offset) {
    return `${padSdfInt(bond.a + offset)}${padSdfInt(bond.b + offset)}${bond.tail}`;
  }

  function formatSdfCoord(value) {
    return value.toFixed(4).padStart(10, ' ');
  }

  function padSdfInt(value) {
    return String(value).padStart(3, ' ');
  }

  async function loadPreparedStructure(viewer, prepared) {
    if (prepared.loadPreset === 'all-models') {
      const plugin = viewer.plugin;
      const data = await plugin.builders.data.rawData({ data: prepared.data, label: prepared.label });
      const trajectory = await plugin.builders.structure.parseTrajectory(data, prepared.format);
      await plugin.builders.structure.hierarchy.applyPreset(trajectory, 'all-models', { useDefaultIfSingleModel: true });
      return;
    }
    await viewer.loadStructureFromData(prepared.data, prepared.format, { dataLabel: prepared.label });
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
      viewportShowReset: true,
      viewportShowScreenshotControls: true,
      viewportShowControls: true,
      viewportShowExpand: false,
      viewportShowToggleFullscreen: false,
      viewportShowSelectionMode: true,
      viewportShowAnimation: false,
      viewportShowTrajectoryControls: false,
      viewportShowSettings: true,
      collapseLeftPanel: true,
      collapseRightPanel: true,
      pdbProvider: 'rcsb',
      emdbProvider: 'rcsb',
      preferWebgl1: true,
      disableAntialiasing: true,
      viewportBackgroundColor: transparentBackground ? undefined : canvasBackgroundCSS(),
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
    setStatus('[web] Booting Burrete viewer JavaScript…');

    const cb = window.BurreteCacheBuster || String(Date.now());
    if (!window.BurreteConfig) {
      await loadScript('./preview-config.js?v=' + encodeURIComponent(cb), 'preview config', 10000);
    }
    if (!window.BurreteDataBase64) {
      await loadScript('./preview-data.js?v=' + encodeURIComponent(cb), 'structure data', 30000);
    }

    const config = requireConfig();
    applyConfigOptions(config);
    debug('config=' + JSON.stringify(config));
    const renderer = normalizeRenderer(config.renderer);
    if (renderer === 'xyz-fast') {
      await startXYZFast(config, cb);
      return;
    }
    if (renderer === 'xyzrender-external') {
      await startExternalArtifact(config);
      return;
    }

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
    applyViewerBackground(viewer);
    window.BurreteViewer = viewer;
    window.BuretteViewer = viewer;
    try {
      window.BurreteAgent?.attach?.({ viewer, plugin: viewer.plugin, config });
    } catch (error) {
      debug('BurreteAgent attach failed: ' + (error && error.message || String(error)));
    }
    activeViewer = viewer;
    window.BurreteHandleResize = () => scheduleViewerResize(viewer, 60);
    applyViewerUIScale(viewer);
    initViewerKeyboardShortcuts(viewer);
    initBuretToolbar(viewer);

    await waitForAnimationFrame();
    applyLayoutState(viewer);
    try { viewer.handleResize(); } catch (_) {}

    debug('before structureDataForMolstar: base64 chars=' + (window.BurreteDataBase64 ? window.BurreteDataBase64.length : -1));
    const prepared = structureDataForMolstar(config);
    debug('prepared format=' + prepared.format + '; data type=' + (prepared.data && prepared.data.constructor ? prepared.data.constructor.name : typeof prepared.data) + '; data length=' + (prepared.data ? prepared.data.length : -1));
    setStatus(`[web] Parsing structure…\n${prepared.label} (${describeFormat(prepared.format, config.binary)})`);

    await withTimeout(
      loadPreparedStructure(viewer, prepared),
      45000,
      `Mol* timed out while parsing/rendering ${prepared.label} as ${prepared.format}.`
    );

    try {
      window.BurreteAgent?.notifyStructureLoaded?.({ viewer, plugin: viewer.plugin, config, prepared });
    } catch (error) {
      debug('BurreteAgent notifyStructureLoaded failed: ' + (error && error.message || String(error)));
    }

    window.addEventListener('resize', () => scheduleViewerResize(viewer, 100));
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
    setStatus(`[web] Burrete web renderer failed to load this file.\n\n${message}\n\nCheck: ./scripts/tail-log.sh`, 'error');
    // eslint-disable-next-line no-console
    console.error(error);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => start().catch(showError));
  } else {
    start().catch(showError);
  }
})();
