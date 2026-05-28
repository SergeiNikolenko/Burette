(() => {
  'use strict';

  const status = document.getElementById('status');
  const MAX_SDF_GRID_MOLECULES = 64;
  const MAX_SDF_GRID_ATOMS = 900;
  const MAX_SDF_GRID_BONDS = 900;
  const SDF_GRID_PADDING = 4.0;
  const TOOLBAR_POSITION_VERSION = '13';
  const TOOLBAR_COLLAPSED_VERSION = '5';
  const DOCKING_POSE_POSITION_VERSION = '1';
  const TOOLBAR_MARGIN = 12;
  const FLOATING_LAYOUT_GAP = 12;
  const PANEL_CLOSE_HIT_WIDTH = 38;
  const VIEWER_THEME_STORAGE_KEY = 'buret.viewer.theme';
  const DEFAULT_MOLSTAR_STYLE = 'illustrative';
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
    transparentBackground: false,
    canvasSize: null,
    atomScale: null,
    bondWidth: null,
    atomStrokeWidth: null,
    molColor: null,
    gradients: null,
    fog: null,
    fogStrength: null,
    showVdw: false,
    vdwOpacity: null,
    vdwScale: null,
    hideBonds: false,
    showCell: null,
    showGhosts: null,
    showAxes: null,
    cellWidth: null,
    supercell: null,
    fieldMode: null,
    fieldIso: null,
    fieldOpacity: null,
    fieldSurfaceStyle: null,
    fieldMoPositiveColor: null,
    fieldMoNegativeColor: null,
    fieldDensityColor: null,
    fieldCmapPalette: null,
    fieldCmapMin: null,
    fieldCmapMax: null,
    customConfigPath: null,
    extraArguments: null
  };
  const XYZRENDER_POPOVER_OPEN_KEY_PREFIX = 'buret.xyzrender.popover.open';
  let xyzrenderControlsApplyTimer = 0;
  let xyzrenderInlineRequestSerial = 0;
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
      const body = { ...(payload || {}) };
      if (window.BurreteConfig && window.BurreteConfig.documentId) {
        body.documentId = String(window.BurreteConfig.documentId);
      }
      if (window.BurreteConfig && window.BurreteConfig.previewRequestID) {
        body.requestID = String(window.BurreteConfig.previewRequestID);
      }
      window.webkit?.messageHandlers?.burrete?.postMessage(body);
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
    left: 'hidden',
    right: 'hidden',
    top: 'hidden',
    bottom: 'hidden'
  };
  const resizeState = {
    viewer: null,
    frame: 0,
    timer: 0
  };
  let leftPanelVisibilityGuardInstalled = false;

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

  const DEFAULT_VIEWER_UI_SCALE = 0.9;
  const MIN_VIEWER_UI_SCALE = 0.9;
  const MAX_VIEWER_UI_SCALE = 0.9;
  const VIEWER_UI_SCALE_STEP = 0.08;

  let panelControlsVisible = window.BurretePanelControlsVisible !== false;
  let transparentBackground = false;
  let viewerTheme = 'auto';
  let canvasBackground = 'auto';
  let overlayOpacity = 0.90;
  let viewerUIScale = DEFAULT_VIEWER_UI_SCALE;
  let activeViewer = null;
  let activeConfig = null;
  let latestXyzrenderOrientationRef = null;
  let orientationTrackingCleanup = null;
  let externalArtifactInteractionsCleanup = null;
  let keyboardShortcutsInstalled = false;
  let themeListenerInstalled = false;
  let floatingPanelTrackingInstalled = false;
  let floatingLayoutFrame = 0;
  let molstarViewportPanelOpen = false;
  let molstarSelectionControlsOpen = false;
  const draggableViewportPanels = new WeakSet();

  function isQuickLookHost() {
    return !!document.body?.classList.contains('burette-quicklook-host');
  }

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
    applyViewerThemeTokens(resolvedTheme);
    document.documentElement.style.setProperty('--buret-canvas-background', canvasBackgroundCSS());
    document.documentElement.style.setProperty('--buret-overlay-opacity', overlayOpacity.toFixed(2));
    document.documentElement.style.setProperty('--buret-overlay-strong-opacity', Math.min(overlayOpacity + 0.06, 0.99).toFixed(2));
    updateThemeButton();
  }

  function normalizeViewerTheme(value) {
    return ['dark', 'light', 'auto'].includes(value) ? value : 'auto';
  }

  function normalizeMolstarStyle(value) {
    return value === 'default' || value === 'illustrative' ? value : DEFAULT_MOLSTAR_STYLE;
  }

  function configuredMolstarStyle(config) {
    return normalizeMolstarStyle(config && config.molstarStyle);
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

  function themeTokensFor(theme) {
    const tokens = activeConfig && activeConfig.themeTokens && activeConfig.themeTokens[theme];
    return tokens && typeof tokens === 'object' ? tokens : null;
  }

  function clampThemeNumber(value, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(Math.max(number, 0), 100);
  }

  function applyViewerThemeTokens(resolvedTheme = resolveViewerTheme()) {
    const tokens = themeTokensFor(resolvedTheme);
    if (!tokens || !document.body) return;
    const accent = typeof tokens.accent === 'string' ? tokens.accent : '#AF52DE';
    const background = typeof tokens.background === 'string' ? tokens.background : (resolvedTheme === 'light' ? '#FFFFFF' : '#111111');
    const foreground = typeof tokens.foreground === 'string' ? tokens.foreground : (resolvedTheme === 'light' ? '#0D0D0D' : '#FCFCFC');
    const uiFont = typeof tokens.uiFont === 'string' ? tokens.uiFont : '';
    const opacity = 1 - (clampThemeNumber(tokens.translucent, resolvedTheme === 'light' ? 10 : 20) / 100) * 0.95;
    const contrast = 0.2 + (clampThemeNumber(tokens.contrast, resolvedTheme === 'light' ? 20 : 16) / 100) * 0.8;
    const root = document.documentElement;
    root.style.setProperty('--buret-shell-background', `color-mix(in srgb, ${background} ${Math.round(opacity * 100)}%, transparent)`);
    root.style.setProperty('--buret-panel-background', `color-mix(in srgb, ${background} ${Math.round(Math.min(opacity + 0.08, 1) * 100)}%, transparent)`);
    root.style.setProperty('--buret-toolbar-background', `color-mix(in srgb, ${background} ${Math.round(Math.min(opacity + 0.08, 1) * 100)}%, transparent)`);
    root.style.setProperty('--buret-toolbar-border', `color-mix(in srgb, ${foreground} ${Math.round(contrast * 24)}%, transparent)`);
    root.style.setProperty('--buret-toolbar-hover', `color-mix(in srgb, ${foreground} ${Math.round(contrast * 28)}%, transparent)`);
    root.style.setProperty('--buret-toolbar-color', `color-mix(in srgb, ${foreground} 94%, transparent)`);
    root.style.setProperty('--buret-molstar-panel-background', `color-mix(in srgb, ${background} ${Math.round(Math.min(opacity + 0.14, 1) * 100)}%, transparent)`);
    root.style.setProperty('--buret-molstar-row-background', `color-mix(in srgb, ${foreground} ${Math.round(contrast * 18)}%, transparent)`);
    root.style.setProperty('--buret-molstar-field-background', `color-mix(in srgb, ${foreground} ${Math.round(contrast * 24)}%, transparent)`);
    root.style.setProperty('--buret-molstar-hover-background', `color-mix(in srgb, ${foreground} ${Math.round(contrast * 34)}%, transparent)`);
    root.style.setProperty('--buret-molstar-border', `color-mix(in srgb, ${foreground} ${Math.round(contrast * 24)}%, transparent)`);
    root.style.setProperty('--buret-molstar-text', `color-mix(in srgb, ${foreground} 94%, transparent)`);
    root.style.setProperty('--buret-molstar-muted-text', `color-mix(in srgb, ${foreground} 64%, transparent)`);
    root.style.setProperty('--buret-molstar-accent', accent);
    root.style.setProperty('--buret-menu-accent', accent);
    root.style.setProperty('--buret-menu-background', `color-mix(in srgb, ${background} ${Math.round(Math.min(opacity + 0.1, 1) * 100)}%, transparent)`);
    root.style.setProperty('--buret-menu-section-background', `color-mix(in srgb, ${foreground} ${Math.round(contrast * 16)}%, transparent)`);
    root.style.setProperty('--buret-menu-input-background', `color-mix(in srgb, ${foreground} ${Math.round(contrast * 22)}%, transparent)`);
    root.style.setProperty('--buret-menu-input-focus-background', `color-mix(in srgb, ${foreground} ${Math.round(contrast * 30)}%, transparent)`);
    root.style.setProperty('--buret-menu-border', `color-mix(in srgb, ${foreground} ${Math.round(contrast * 18)}%, transparent)`);
    root.style.setProperty('--buret-menu-divider', `color-mix(in srgb, ${foreground} ${Math.round(contrast * 12)}%, transparent)`);
    root.style.setProperty('--buret-menu-toggle-track', `color-mix(in srgb, ${foreground} ${Math.round(contrast * 28)}%, transparent)`);
    if (uiFont) document.body.style.fontFamily = uiFont;
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
    if (canvasBackground === 'auto') return resolveViewerTheme() === 'light' ? 'white' : 'graphite';
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
    // Keep DOM zoom disabled; native hosts apply the fixed viewer scale through
    // WKWebView pageZoom so Mol* keeps its own layout dimensions stable.
    postHostMessage({ type: 'viewerZoom', value: viewerUIScale });
    document.documentElement.style.setProperty('--buret-viewer-ui-scale', String(viewerUIScale));
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
    applyStaticRendererTheme();
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

  function applyStaticRendererTheme() {
    const background = transparentBackground ? 'transparent' : canvasBackgroundCSS();
    const fastRoot = document.querySelector('.buret-xyz-fast-root');
    if (fastRoot) {
      fastRoot.style.background = background;
    }
    const fastRect = document.querySelector('.buret-xyz-svg rect');
    if (fastRect) {
      fastRect.setAttribute('fill', background);
    }
    const artifactRoot = document.querySelector('.buret-external-artifact-root');
    const artifactRect = document.querySelector('.buret-external-artifact-inline > svg > rect');
    const artifactBackgroundFill = resolveExternalArtifactBackgroundFill(artifactRect);
    if (artifactRoot) {
      artifactRoot.style.background = artifactBackgroundFill || background;
    }
    if (artifactRect && artifactRect.getAttribute('width') === '100%' && artifactRect.getAttribute('height') === '100%') {
      artifactRect.setAttribute('fill', artifactBackgroundFill || background);
    }
  }

  function resolveExternalArtifactBackgroundFill(rect) {
    if (!rect || rect.getAttribute('width') !== '100%' || rect.getAttribute('height') !== '100%') return null;
    const originalFill = rect.dataset.buretOriginalFill ?? rect.getAttribute('fill') ?? '';
    rect.dataset.buretOriginalFill = originalFill;
    if (!originalFill || originalFill === 'transparent') return null;
    if (/^var\(/iu.test(originalFill)) return null;
    return originalFill;
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
    const toolbar = document.getElementById('buret-toolbar');
    if (!control || !toolbar) return;
    const format = normalizeFormat(config.molstarFormat || config.format);
    const xyzrenderViewer = config.xyzrenderViewer === true;
    const xyzrenderAvailable = config.xyzrenderAvailable !== false;
    const renderer = normalizeRenderer(config.renderer);
    toolbar.dataset.activeRenderer = renderer;
    const canSwitchRenderer = xyzrenderAvailable && (
      ((config.appViewer === true || config.quickLookViewer === true) && canUseExternalXyzrender(format)) ||
      xyzrenderViewer
    );
    const tuneButton = toolbar.querySelector('[data-buret-action="xyzrender-tune"]');
    const sdfGridButton = toolbar.querySelector('[data-buret-action="sdf-grid"]');
    const popover = toolbar.querySelector('[data-buret-xyzrender-popover]');
    control.classList.toggle('visible', canSwitchRenderer);
    const presetSlot = toolbar.querySelector('[data-buret-xyzrender-preset-slot]');
    presetSlot?.classList.remove('visible');
    const canOpenSdfGrid = canOpenSdfGridFromConfig(config);
    sdfGridButton?.classList.toggle('hidden', !canOpenSdfGrid);
    if (sdfGridButton && toolbar.dataset.sdfGridBound !== '1') {
      sdfGridButton.addEventListener('click', requestSdfGridDocument);
      toolbar.dataset.sdfGridBound = '1';
    }
    const popoverWasOpen = popover?.classList.contains('hidden') === false;
    const popoverScrollTop = popover?.scrollTop || 0;
    control.querySelectorAll('[data-buret-renderer]').forEach(button => {
      const value = button.getAttribute('data-buret-renderer');
      const unavailable = rendererChoiceUnavailable(value, format, config, xyzrenderAvailable);
      button.classList.toggle('hidden', unavailable);
      button.classList.toggle('active', !unavailable && value === renderer);
      button.disabled = unavailable;
      button.setAttribute('aria-disabled', unavailable ? 'true' : 'false');
      if (control.dataset.rendererBound !== '1') {
        button.addEventListener('click', () => {
          if (button.disabled) return;
          applyPendingRendererSelection(toolbar, value);
          requestRendererSwitch(value);
        });
      }
    });
    if (!canSwitchRenderer) {
      tuneButton?.classList.add('hidden');
      setXyzrenderPopoverVisibility(toolbar, false, { persist: false });
      return;
    }

    const select = toolbar.querySelector('[data-buret-xyzrender-preset]');
    if (select) {
      populateXyzrenderPresetSelect(select, config.xyzrenderPresetOptions);
      select.value = normalizeXyzrenderPreset(config.externalArtifact?.preset || config.xyzrenderPreset || 'default');
      select.disabled = renderer !== 'xyzrender-external';
      presetSlot?.classList.toggle('visible', renderer === 'xyzrender-external');
      if (control.dataset.presetBound !== '1') {
        select.addEventListener('change', () => requestXyzrenderPreset(select.value));
      }
    }
    if (tuneButton) {
      tuneButton.classList.toggle('hidden', renderer !== 'xyzrender-external');
      if (renderer !== 'xyzrender-external') {
        setXyzrenderPopoverVisibility(toolbar, false, { persist: false });
      }
      if (renderer === 'xyzrender-external') {
        populateXyzrenderControlsForm(toolbar, normalizeXyzrenderControls(config.xyzrenderControls || DEFAULT_XYZRENDER_CONTROLS, config));
        updateXyzrenderFormVisibility(toolbar);
        if (popoverWasOpen || shouldRestoreXyzrenderPopoverOpen() || (!hasXyzrenderPopoverPreference() && shouldOpenXyzrenderPopoverByDefault(config))) {
          setXyzrenderPopoverVisibility(toolbar, true, { resetScroll: false });
          if (popover) popover.scrollTop = popoverScrollTop;
        }
      }
      if (control.dataset.tuneBound !== '1') {
        tuneButton.addEventListener('click', () => {
          const hidden = popover?.classList.contains('hidden') !== false;
          if (hidden) {
            populateXyzrenderControlsForm(toolbar, normalizeXyzrenderControls((activeConfig && activeConfig.xyzrenderControls) || DEFAULT_XYZRENDER_CONTROLS, activeConfig || {}));
          }
          setXyzrenderPopoverVisibility(toolbar, hidden, { resetScroll: hidden });
        });
      }
    }
    control.dataset.rendererBound = '1';
    control.dataset.presetBound = '1';
    control.dataset.tuneBound = '1';
  }

  function canUseExternalXyzrender(format) {
    return ['xyz', 'sdf', 'pdb', 'pdbqt', 'mmcif', 'cifcore'].includes(normalizeFormat(format));
  }

  function rendererChoiceUnavailable(value, format, config, xyzrenderAvailable) {
    if (value === 'xyz-fast') return format !== 'xyz';
    if (value === 'molstar') return config.molstarAvailable === false;
    if (value === 'xyzrender-external') return !xyzrenderAvailable || !canUseExternalXyzrender(format);
    return false;
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

  function xyzrenderPopoverStorageKey() {
    const documentId = String(window.BurreteConfig?.documentId || '').trim();
    return documentId ? `${XYZRENDER_POPOVER_OPEN_KEY_PREFIX}:${documentId}` : XYZRENDER_POPOVER_OPEN_KEY_PREFIX;
  }

  function setXyzrenderPopoverVisibility(toolbar, open, options = {}) {
    const popover = toolbar?.querySelector('[data-buret-xyzrender-popover]');
    const tuneButton = toolbar?.querySelector('[data-buret-action="xyzrender-tune"]');
    if (!popover) return;
    const resetScroll = options.resetScroll === true;
    const persist = options.persist !== false;
    popover.classList.toggle('hidden', !open);
    toolbar?.classList.toggle('buret-popover-open', open);
    if (tuneButton) {
      tuneButton.classList.toggle('active', open);
      tuneButton.toggleAttribute('data-open', open);
    }
    if (persist) setXyzrenderPopoverOpenPersisted(open);
    if (open) {
      if (resetScroll) popover.scrollTop = 0;
      positionXyzrenderPopover(toolbar);
    }
  }

  function setXyzrenderPopoverOpenPersisted(open) {
    try {
      const key = xyzrenderPopoverStorageKey();
      if (open) window.localStorage?.setItem(key, '1');
      else window.localStorage?.setItem(key, '0');
    } catch (_) {}
  }

  function shouldRestoreXyzrenderPopoverOpen() {
    try {
      return window.localStorage?.getItem(xyzrenderPopoverStorageKey()) === '1';
    } catch (_) {
      return false;
    }
  }

  function hasXyzrenderPopoverPreference() {
    try {
      return window.localStorage?.getItem(xyzrenderPopoverStorageKey()) != null;
    } catch (_) {
      return false;
    }
  }

  function shouldOpenXyzrenderPopoverByDefault(config) {
    const controls = normalizeXyzrenderControls(config?.xyzrenderControls || DEFAULT_XYZRENDER_CONTROLS, config || {});
    return !!(
      controls.fieldMode ||
      controls.fieldIso != null ||
      controls.fieldOpacity != null ||
      controls.fieldSurfaceStyle ||
      controls.fieldMoPositiveColor ||
      controls.fieldMoNegativeColor ||
      controls.fieldDensityColor ||
      controls.fieldCmapPalette ||
      controls.fieldCmapMin != null ||
      controls.fieldCmapMax != null
    );
  }

  function normalizeXyzrenderControls(value, config = {}) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      transparentBackground: source.transparentBackground === true || (source.transparentBackground == null && config.transparentBackground === true),
      canvasSize: positiveNumberOrNull(source.canvasSize),
      atomScale: positiveNumberOrNull(source.atomScale),
      bondWidth: positiveNumberOrNull(source.bondWidth),
      atomStrokeWidth: positiveNumberOrNull(source.atomStrokeWidth),
      molColor: nonEmptyText(source.molColor),
      gradients: triStateBoolean(source.gradients),
      fog: triStateBoolean(source.fog),
      fogStrength: positiveNumberOrNull(source.fogStrength),
      showVdw: source.showVdw === true,
      vdwOpacity: positiveNumberOrNull(source.vdwOpacity),
      vdwScale: positiveNumberOrNull(source.vdwScale),
      hideBonds: source.hideBonds === true,
      showCell: triStateBoolean(source.showCell),
      showGhosts: triStateBoolean(source.showGhosts),
      showAxes: triStateBoolean(source.showAxes),
      cellWidth: positiveNumberOrNull(source.cellWidth),
      supercell: normalizeSupercellValue(source.supercell),
      fieldMode: normalizeFieldMode(source.fieldMode),
      fieldIso: positiveNumberOrNull(source.fieldIso),
      fieldOpacity: nonNegativeNumberOrNull(source.fieldOpacity),
      fieldSurfaceStyle: normalizeFieldSurfaceStyle(source.fieldSurfaceStyle),
      fieldMoPositiveColor: nonEmptyText(source.fieldMoPositiveColor),
      fieldMoNegativeColor: nonEmptyText(source.fieldMoNegativeColor),
      fieldDensityColor: nonEmptyText(source.fieldDensityColor),
      fieldCmapPalette: nonEmptyText(source.fieldCmapPalette),
      fieldCmapMin: finiteNumberOrNull(source.fieldCmapMin),
      fieldCmapMax: finiteNumberOrNull(source.fieldCmapMax),
      customConfigPath: nonEmptyText(source.customConfigPath),
      extraArguments: nonEmptyText(source.extraArguments)
    };
  }

  function positiveNumberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function nonNegativeNumberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function finiteNumberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function triStateBoolean(value) {
    return value === true ? true : value === false ? false : null;
  }

  function nonEmptyText(value) {
    const text = String(value || '').trim();
    return text ? text : null;
  }

  function normalizeFieldMode(value) {
    const text = String(value || '').trim().toLowerCase();
    return ['auto', 'off', 'density', 'mo', 'esp', 'nci'].includes(text) ? text : null;
  }

  function normalizeFieldSurfaceStyle(value) {
    const text = String(value || '').trim().toLowerCase();
    return ['solid', 'mesh', 'contour', 'dot'].includes(text) ? text : null;
  }

  function normalizeSupercellValue(value) {
    const text = Array.isArray(value) ? value.join(' ') : String(value || '').trim();
    const parts = text.split(/[\s,]+/u).filter(Boolean);
    if (parts.length !== 3) return null;
    const values = parts.map(part => Number.parseInt(part, 10));
    return values.every(number => Number.isFinite(number) && number > 0) ? values : null;
  }

  function requestRendererSwitch(renderer) {
    const value = normalizeRenderer(renderer);
    if (requestBrowserDevRendererSwitch(value)) return;
    const orientationRef = value === 'xyzrender-external' ? captureCurrentXyzrenderOrientationRef() : null;
    const payload = { type: 'setRenderer', value };
    if (orientationRef) {
      payload.orientationRef = orientationRef.text;
      payload.orientationAtomCount = orientationRef.atomCount;
    }
    const sent = postHostMessage(payload);
    if (!sent) setStatus('Renderer switching is available only in the app or Quick Look viewer.', 'error');
  }

  function requestBrowserDevRendererSwitch(renderer) {
    const config = activeConfig || window.BurreteConfig || {};
    if (config.tauriViewer !== false) return false;
    const value = normalizeRenderer(renderer);
    if (value === normalizeRenderer(config.renderer)) return true;
    if (value === 'xyzrender-external') {
      return requestBrowserDevXyzrenderUpdate({ rendererSwitch: true });
    }
    if (value === 'molstar') {
      void switchBrowserDevMolstar();
      return true;
    }
    return false;
  }

  async function switchBrowserDevMolstar() {
    const config = activeConfig || window.BurreteConfig || {};
    if (config.tauriViewer !== false) return;
    const nextConfig = {
      ...config,
      renderer: 'molstar',
      xyzrenderViewer: false,
      externalArtifact: null
    };
    activeConfig = nextConfig;
    window.BurreteConfig = nextConfig;
    xyzrenderInlineRequestSerial += 1;
    disposeExternalArtifactInteractions();
    applyConfigOptions(nextConfig);
    try {
      await startMolstar(nextConfig, window.BurreteCacheBuster || String(Date.now()));
    } catch (error) {
      setStatus(`Mol* renderer switch failed.\n\n${error && error.message || String(error)}`, 'error');
    }
  }

  function requestSdfGridDocument() {
    const payload = { type: 'openSdfGridDocument' };
    const gridPath = sdfGridPathForConfig(activeConfig || {});
    if (gridPath) payload.path = gridPath;
    const sent = postHostMessage(payload);
    if (!sent) setStatus('SDF grid switching is available only in the app or Quick Look viewer.', 'error');
  }

  function sdfGridPathForConfig(config) {
    const path = String(config?.sdfGridPath || '').trim();
    if (path) return path;
    const ligands = Array.isArray(config?.docking?.ligands) ? config.docking.ligands : [];
    const sdfLigand = ligands.find((ligand) => (
      normalizeFormat(ligand?.format || ligand?.extension) === 'sdf' &&
      String(ligand?.path || '').trim().length > 0
    ));
    return sdfLigand ? String(sdfLigand.path).trim() : null;
  }

  function canOpenSdfGridFromConfig(config) {
    const format = normalizeFormat(config?.molstarFormat || config?.format);
    return Boolean(sdfGridPathForConfig(config)) ||
      (config?.sdfPosePager === true && config?.sdfGrid !== false && format === 'sdf');
  }

  function applyPendingRendererSelection(toolbar, renderer) {
    if (!toolbar) return;
    const normalized = normalizeRenderer(renderer);
    toolbar.dataset.activeRenderer = normalized;
    toolbar.querySelectorAll('[data-buret-renderer]').forEach(button => {
      button.classList.toggle('active', button.getAttribute('data-buret-renderer') === normalized);
    });
    const presetSlot = toolbar.querySelector('[data-buret-xyzrender-preset-slot]');
    const preset = toolbar.querySelector('[data-buret-xyzrender-preset]');
    const tuneButton = toolbar.querySelector('[data-buret-action="xyzrender-tune"]');
    const popover = toolbar.querySelector('[data-buret-xyzrender-popover]');
    const external = normalized === 'xyzrender-external';
    presetSlot?.classList.toggle('visible', external);
    if (preset) preset.disabled = !external;
    tuneButton?.classList.toggle('hidden', !external);
    if (!external) {
      tuneButton?.classList.remove('active');
      tuneButton?.removeAttribute('data-open');
      popover?.classList.add('hidden');
      setXyzrenderPopoverOpenPersisted(false);
    }
  }

  function requestXyzrenderPreset(preset) {
    const value = normalizeXyzrenderPreset(preset);
    if (requestBrowserDevXyzrenderUpdate({ preset: value })) return;
    const sent = postHostMessage({ type: 'setXyzrenderPreset', value });
    if (!sent) setStatus('xyzrender preset switching is available only in the app or Quick Look viewer.', 'error');
  }

  function requestBrowserDevXyzrenderUpdate(options = {}) {
    const config = activeConfig || window.BurreteConfig || {};
    const endpoint = String(config.xyzrenderEndpoint || '').trim();
    const sourcePath = String(config.xyzrenderSourcePath || config.sourcePath || '').trim();
    const renderer = options.rendererSwitch === true ? 'xyzrender-external' : normalizeRenderer(config.renderer);
    if (config.tauriViewer !== false || !endpoint || !sourcePath || renderer !== 'xyzrender-external') {
      return false;
    }
    const toolbar = document.getElementById('buret-toolbar');
    const controls = options.controls || (toolbar ? readXyzrenderControlsForm(toolbar) : normalizeXyzrenderControls(config.xyzrenderControls || DEFAULT_XYZRENDER_CONTROLS, config));
    const preset = normalizeXyzrenderPreset(options.preset || config.externalArtifact?.preset || config.xyzrenderPreset || 'default');
    const orientationRef = captureCurrentXyzrenderOrientationRef();
    const serial = ++xyzrenderInlineRequestSerial;
    setStatus(`[web] Updating xyzrender artifact…\n${config.label || 'structure'}`);
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: sourcePath,
        preset,
        orientationRef: orientationRef?.text || undefined,
        controls
      })
    })
      .then(response => response.json().catch(() => ({})).then(payload => ({ response, payload })))
      .then(({ response, payload }) => {
        if (serial !== xyzrenderInlineRequestSerial) return;
        if (!response.ok) {
          throw new Error(typeof payload?.error === 'string' ? payload.error : `xyzrender request failed with status ${response.status}`);
        }
        if (typeof payload?.svg !== 'string' || !payload.svg.trim()) {
          throw new Error('xyzrender endpoint returned no SVG payload');
        }
        updateBrowserDevXyzrenderArtifact(payload, controls, preset);
      })
      .catch(error => {
        if (serial !== xyzrenderInlineRequestSerial) return;
        setStatus(error instanceof Error ? error.message : String(error), 'error');
      });
    return true;
  }

  function updateBrowserDevXyzrenderArtifact(payload, requestedControls, requestedPreset) {
    const inline = document.querySelector('.buret-external-artifact-inline');
    const object = document.querySelector('.buret-external-artifact-object');
    if (inline) {
      inline.innerHTML = payload.svg;
    } else if (object) {
      const stage = object.closest('.buret-external-artifact-stage');
      if (stage) {
        stage.innerHTML = `<div class="buret-external-artifact-inline" aria-label="${escapeHTML((activeConfig || {}).label || 'xyzrender artifact')}">${payload.svg}</div>`;
      }
    }
    const preset = normalizeXyzrenderPreset(payload.preset || requestedPreset);
    const controls = normalizeXyzrenderControls(payload.xyzrenderControls || requestedControls || DEFAULT_XYZRENDER_CONTROLS, activeConfig || {});
    const elapsed = Number(payload.elapsedMs) || 0;
    const badge = document.querySelector('.buret-xyz-badge span');
    if (badge) badge.textContent = `SVG · ${preset}${elapsed ? ` · ${elapsed} ms` : ''}`;
    activeConfig = {
      ...(activeConfig || window.BurreteConfig || {}),
      renderer: 'xyzrender-external',
      xyzrenderControls: controls,
      xyzrenderPreset: preset,
      xyzrenderPresetOptions: Array.isArray(payload.xyzrenderPresetOptions)
        ? payload.xyzrenderPresetOptions
        : (activeConfig || {}).xyzrenderPresetOptions,
      externalArtifact: {
        ...((activeConfig || {}).externalArtifact || {}),
        inlineSvg: payload.svg,
        outputType: 'svg',
        preset,
        configArgument: typeof payload.configArgument === 'string' ? payload.configArgument : preset,
        elapsedMs: elapsed,
        log: typeof payload.log === 'string' ? payload.log : ''
      }
    };
    window.BurreteConfig = { ...(window.BurreteConfig || {}), ...activeConfig };
    setStatus(`[web] Rendered ${(activeConfig || {}).label || 'structure'} with external xyzrender`);
    setTimeout(hideStatus, 450);
  }

  function populateXyzrenderControlsForm(toolbar, controls) {
    if (!toolbar) return;
    toolbar.dataset.syncingXyzrenderForm = '1';
    const normalized = normalizeXyzrenderControls(controls, activeConfig || {});
    const setValue = (name, value) => {
      const field = toolbar.querySelector(`[data-buret-xctrl="${name}"]`);
      if (!field) return;
      if (field.type === 'checkbox') {
        field.checked = value === true;
        return;
      }
      if (field.tagName === 'SELECT') {
        field.value = value === true ? 'on' : value === false ? 'off' : value == null ? '' : String(value);
        return;
      }
      field.value = Array.isArray(value) ? value.join(' ') : value == null ? '' : String(value);
    };
    Object.entries(normalized).forEach(([name, value]) => setValue(name, value));
    syncXyzrenderSliders(toolbar);
    updateXyzrenderFormVisibility(toolbar);
    toolbar.dataset.syncingXyzrenderForm = '0';
  }

  function syncXyzrenderSliders(toolbar) {
    toolbar.querySelectorAll('[data-buret-xctrl-slider]').forEach(slider => {
      const name = slider.getAttribute('data-buret-xctrl-slider');
      const field = name ? toolbar.querySelector(`[data-buret-xctrl="${name}"]`) : null;
      if (!field) return;
      const number = Number(field.value);
      const hasValue = Number.isFinite(number);
      slider.toggleAttribute('data-auto', !hasValue);
      if (hasValue) slider.value = String(number);
    });
  }

  function updateXyzrenderFormVisibility(toolbar) {
    const advanced = toolbar.querySelector('[data-buret-xyzrender-appearance]');
    const crystal = toolbar.querySelector('[data-buret-xyzrender-crystal]');
    const controls = toolbar.dataset.syncingXyzrenderForm === '1'
      ? normalizeXyzrenderControls((activeConfig && activeConfig.xyzrenderControls) || DEFAULT_XYZRENDER_CONTROLS, activeConfig || {})
      : readXyzrenderControlsForm(toolbar);
    const looksCrystalLike = shouldShowCrystalControls(activeConfig || {}, controls);
    const crystalActive = controls.showCell != null || controls.showGhosts != null || controls.showAxes != null || Array.isArray(controls.supercell);
    const advancedActive = !!(
      controls.atomScale != null ||
      controls.bondWidth != null ||
      controls.vdwScale != null ||
      controls.molColor
    );
    const field = toolbar.querySelector('[data-buret-xyzrender-field]');
    const fieldActive = !!(
      controls.fieldMode ||
      controls.fieldIso != null ||
      controls.fieldOpacity != null ||
      controls.fieldSurfaceStyle ||
      controls.fieldMoPositiveColor ||
      controls.fieldMoNegativeColor ||
      controls.fieldDensityColor ||
      controls.fieldCmapPalette ||
      controls.fieldCmapMin != null ||
      controls.fieldCmapMax != null
    );
    if (advanced) {
      if (advancedActive) advanced.open = true;
    }
    if (field) {
      if (fieldActive) field.open = true;
    }
    if (crystal) {
      crystal.classList.toggle('hidden', !looksCrystalLike && !crystalActive);
      if (crystalActive) {
        crystal.open = true;
      } else if (crystal.classList.contains('hidden')) {
        crystal.open = false;
      }
    }
    positionXyzrenderPopover(toolbar);
  }

  function shouldShowCrystalControls(config, controls) {
    const hint = [config?.label, config?.documentId, config?.format, config?.molstarFormat]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return /cell|extxyz|cryst|lattice|periodic|supercell/iu.test(hint) ||
      controls.showCell != null ||
      controls.showGhosts != null ||
      controls.showAxes != null ||
      Array.isArray(controls.supercell);
  }

  function readXyzrenderControlsForm(toolbar) {
    const current = normalizeXyzrenderControls((activeConfig && activeConfig.xyzrenderControls) || DEFAULT_XYZRENDER_CONTROLS, activeConfig || {});
    const readField = name => toolbar.querySelector(`[data-buret-xctrl="${name}"]`);
    const readCheckbox = name => {
      const field = readField(name);
      return field ? !!field.checked : current[name];
    };
    const readNumber = name => {
      const field = readField(name);
      return field ? positiveNumberOrNull(field.value) : current[name];
    };
    const readNonNegativeNumber = name => {
      const field = readField(name);
      return field ? nonNegativeNumberOrNull(field.value) : current[name];
    };
    const readFiniteNumber = name => {
      const field = readField(name);
      return field ? finiteNumberOrNull(field.value) : current[name];
    };
    const readText = name => {
      const field = readField(name);
      return field ? nonEmptyText(field.value) : current[name];
    };
    const readTriState = name => {
      const field = readField(name);
      if (!field) return current[name];
      const value = field.value;
      return value === 'on' ? true : value === 'off' ? false : null;
    };
    return normalizeXyzrenderControls({
      transparentBackground: readCheckbox('transparentBackground'),
      canvasSize: current.canvasSize,
      atomScale: readNumber('atomScale'),
      bondWidth: readNumber('bondWidth'),
      atomStrokeWidth: current.atomStrokeWidth,
      molColor: readText('molColor'),
      gradients: readTriState('gradients'),
      fog: readTriState('fog'),
      fogStrength: current.fogStrength,
      showVdw: readCheckbox('showVdw'),
      vdwOpacity: current.vdwOpacity,
      vdwScale: readNumber('vdwScale'),
      hideBonds: readCheckbox('hideBonds'),
      showCell: readTriState('showCell'),
      showGhosts: readTriState('showGhosts'),
      showAxes: readTriState('showAxes'),
      cellWidth: current.cellWidth,
      supercell: normalizeSupercellValue(readField('supercell')?.value),
      fieldMode: normalizeFieldMode(readField('fieldMode')?.value),
      fieldIso: readNumber('fieldIso'),
      fieldOpacity: readNonNegativeNumber('fieldOpacity'),
      fieldSurfaceStyle: normalizeFieldSurfaceStyle(readField('fieldSurfaceStyle')?.value),
      fieldMoPositiveColor: readText('fieldMoPositiveColor'),
      fieldMoNegativeColor: readText('fieldMoNegativeColor'),
      fieldDensityColor: readText('fieldDensityColor'),
      fieldCmapPalette: readText('fieldCmapPalette'),
      fieldCmapMin: readFiniteNumber('fieldCmapMin'),
      fieldCmapMax: readFiniteNumber('fieldCmapMax'),
      customConfigPath: readText('customConfigPath'),
      extraArguments: readText('extraArguments')
    }, activeConfig || {});
  }

  function requestXyzrenderControls(toolbar) {
    const controls = readXyzrenderControlsForm(toolbar);
    if (requestBrowserDevXyzrenderUpdate({ controls })) return;
    const sent = postHostMessage({ type: 'setXyzrenderControls', controls });
    if (!sent) {
      setStatus('xyzrender controls are available only in the app or Quick Look viewer.', 'error');
    }
  }

  function scheduleXyzrenderControlsApply(toolbar, delayMs = 220) {
    if (!toolbar || toolbar.dataset.syncingXyzrenderForm === '1') return;
    if (xyzrenderControlsApplyTimer) clearTimeout(xyzrenderControlsApplyTimer);
    xyzrenderControlsApplyTimer = setTimeout(() => {
      xyzrenderControlsApplyTimer = 0;
      requestXyzrenderControls(toolbar);
    }, delayMs);
  }

  function captureCurrentXyzrenderOrientationRef() {
    const config = activeConfig || {};
    const format = normalizeFormat(config.molstarFormat || config.format);
    if (format !== 'xyz' || config.binary === true || !activeViewer) return null;
    const nextRef = buildXyzrenderOrientationRef(activeViewer, config);
    if (nextRef) latestXyzrenderOrientationRef = nextRef;
    return nextRef || latestXyzrenderOrientationRef;
  }

  function trackMolstarOrientation(viewer, config) {
    if (orientationTrackingCleanup) {
      try { orientationTrackingCleanup(); } catch (_) {}
      orientationTrackingCleanup = null;
    }
    latestXyzrenderOrientationRef = null;
    if (normalizeFormat(config.molstarFormat || config.format) !== 'xyz' || config.binary === true) return;

    const disposers = [];
    const update = debounce(() => {
      const nextRef = buildXyzrenderOrientationRef(viewer, config);
      if (nextRef) latestXyzrenderOrientationRef = nextRef;
    }, 120);

    const changed = viewer?.plugin?.canvas3d?.camera?.changed;
    if (changed && typeof changed.subscribe === 'function') {
      try {
        const subscription = changed.subscribe(update);
        disposers.push(() => subscription?.unsubscribe?.());
      } catch (error) {
        debug('camera subscription failed: ' + (error && error.message || String(error)));
      }
    }

    ['pointerup', 'wheel', 'keyup', 'mouseup'].forEach(eventName => {
      document.addEventListener(eventName, update, true);
      disposers.push(() => document.removeEventListener(eventName, update, true));
    });

    update();
    orientationTrackingCleanup = () => {
      disposers.forEach(dispose => {
        try { dispose(); } catch (_) {}
      });
    };
  }

  function debounce(fn, delayMs) {
    let timer = 0;
    return () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = 0;
        fn();
      }, delayMs);
    };
  }

  function buildXyzrenderOrientationRef(viewer, config) {
    const frame = parseFirstXYZFrame(rawStructureData({ ...config, binary: false }));
    if (!frame || !frame.atoms.length || frame.atoms.length > 50000) return null;
    const snapshot = readCameraSnapshot(viewer);
    const basis = cameraBasis(snapshot, frame.atoms);
    if (!basis) return null;

    const lines = [
      String(frame.atoms.length),
      `Burrete Mol* orientation reference for ${config.label || 'structure'}`
    ];
    for (const atom of frame.atoms) {
      const x = atom.x - basis.origin.x;
      const y = atom.y - basis.origin.y;
      const z = atom.z - basis.origin.z;
      lines.push([
        atom.symbol,
        formatCoordinate(dot3({ x, y, z }, basis.right)),
        formatCoordinate(dot3({ x, y, z }, basis.up)),
        formatCoordinate(dot3({ x, y, z }, basis.forward))
      ].join(' '));
    }
    const text = lines.join('\n') + '\n';
    if (text.length > 4 * 1024 * 1024) return null;
    return { text, atomCount: frame.atoms.length };
  }

  function parseFirstXYZFrame(text) {
    const lines = String(text || '').replace(/\r\n?/gu, '\n').split('\n');
    let start = 0;
    while (start < lines.length && !lines[start].trim()) start += 1;
    const atomCount = Number.parseInt(lines[start]?.trim().split(/\s+/u)[0] || '', 10);
    if (!Number.isFinite(atomCount) || atomCount <= 0 || start + atomCount + 1 >= lines.length) return null;
    const atoms = [];
    for (let i = start + 2; i < Math.min(lines.length, start + 2 + atomCount); i += 1) {
      const parts = lines[i].trim().split(/\s+/u);
      if (parts.length < 4) return null;
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const z = Number(parts[3]);
      if (![x, y, z].every(Number.isFinite)) return null;
      atoms.push({ symbol: normalizeElementSymbol(parts[0]), x, y, z });
    }
    return atoms.length === atomCount ? { atoms } : null;
  }

  function normalizeElementSymbol(value) {
    const match = String(value || 'X').trim().match(/[A-Za-z]{1,3}/u);
    if (!match) return 'X';
    return match[0].slice(0, 1).toUpperCase() + match[0].slice(1).toLowerCase();
  }

  function readCameraSnapshot(viewer) {
    const camera = viewer?.plugin?.canvas3d?.camera;
    if (!camera) return null;
    let snapshot = null;
    try { snapshot = typeof camera.getSnapshot === 'function' ? camera.getSnapshot() : null; } catch (_) {}
    snapshot = snapshot || camera.state || camera;
    const position = vectorFrom(snapshot.position || camera.position);
    const target = vectorFrom(snapshot.target || camera.target);
    const up = vectorFrom(snapshot.up || camera.up);
    return position && target && up ? { position, target, up } : null;
  }

  function cameraBasis(snapshot, atoms) {
    const centroidValue = centroid(atoms);
    if (!snapshot) return null;
    const origin = snapshot.target || centroidValue;
    const forward = normalize3(sub3(snapshot.position, origin));
    if (!forward) return null;
    const rawUp = normalize3(snapshot.up) || { x: 0, y: 1, z: 0 };
    const right = normalize3(cross3(rawUp, forward));
    if (!right) return null;
    const up = normalize3(cross3(forward, right));
    if (!up) return null;
    return { origin, right, up, forward };
  }

  function vectorFrom(value) {
    if (!value) return null;
    if (Array.isArray(value) || typeof value.length === 'number') {
      const x = Number(value[0]);
      const y = Number(value[1]);
      const z = Number(value[2]);
      return [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
    }
    const x = Number(value.x);
    const y = Number(value.y);
    const z = Number(value.z);
    return [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
  }

  function centroid(atoms) {
    const sum = atoms.reduce((acc, atom) => ({ x: acc.x + atom.x, y: acc.y + atom.y, z: acc.z + atom.z }), { x: 0, y: 0, z: 0 });
    const count = Math.max(1, atoms.length);
    return { x: sum.x / count, y: sum.y / count, z: sum.z / count };
  }

  function sub3(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  }

  function dot3(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  function cross3(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    };
  }

  function normalize3(v) {
    const length = Math.hypot(v.x, v.y, v.z);
    if (!Number.isFinite(length) || length < 1e-8) return null;
    return { x: v.x / length, y: v.y / length, z: v.z / length };
  }

  function formatCoordinate(value) {
    return Number(value).toFixed(6).replace(/\.?0+$/u, match => (match === '.' ? '' : ''));
  }

  function initBuretToolbar(viewer) {
    const toolbar = document.getElementById('buret-toolbar');
    if (!toolbar) return;

    if (toolbar.dataset.panelTogglesBound !== '1') {
      toolbar.querySelectorAll('[data-buret-toggle]').forEach(button => {
        button.addEventListener('click', () => {
          toggleLayoutRegion(button.getAttribute('data-buret-toggle'), activeViewer || viewer);
        });
      });
      toolbar.dataset.panelTogglesBound = '1';
    }
    bindThemeButton(toolbar, viewer);
    bindQuickLookOpenButton();
    bindXyzrenderControls(toolbar);
    initToolbarDrag(toolbar);
    restoreToolbarCollapsed(toolbar, viewer);
    installToolbarAutoLayoutTracking(toolbar);
    installMolstarFloatingPanelTracking();
    updateToolbarVisibility();
    updateThemeButton();
    applyLayoutState(viewer);
  }

  function installToolbarAutoLayoutTracking(toolbar) {
    if (toolbar.dataset.autoLayoutBound === '1') return;
    toolbar.dataset.autoLayoutBound = '1';

    let lastWidth = 0;
    let lastHeight = 0;
    let frame = 0;

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (toolbar.dataset.defaultPosition === '1') {
          applyDefaultToolbarPosition(toolbar);
        } else {
          fitToolbarToViewport(toolbar);
          updateFloatingLayoutOffsets();
        }
      });
    };

    const handleSizeChange = () => {
      const rect = toolbar.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width === lastWidth && height === lastHeight) return;
      lastWidth = width;
      lastHeight = height;
      schedule();
    };

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(handleSizeChange);
      observer.observe(toolbar);
      const content = toolbar.querySelector('[data-buret-toolbar-content]');
      if (content) observer.observe(content);
    }

    requestAnimationFrame(handleSizeChange);
    setTimeout(handleSizeChange, 120);
  }

  function bindXyzrenderControls(toolbar) {
    if (!toolbar || toolbar.dataset.xyzrenderControlsBound === '1') return;
    toolbar.querySelector('[data-buret-xyzrender-preset]')?.addEventListener('change', () => updateXyzrenderFormVisibility(toolbar));
    toolbar.querySelector('[data-buret-action="xyzrender-reset"]')?.addEventListener('click', () => {
      populateXyzrenderControlsForm(toolbar, {});
      requestXyzrenderControls(toolbar);
    });
    toolbar.querySelectorAll('[data-buret-xctrl]').forEach(field => {
      field.addEventListener('change', () => {
        syncXyzrenderSliders(toolbar);
        updateXyzrenderFormVisibility(toolbar);
        scheduleXyzrenderControlsApply(toolbar, 0);
      });
      if (field.tagName !== 'SELECT' && field.type !== 'checkbox') {
        field.addEventListener('input', () => {
          syncXyzrenderSliders(toolbar);
          updateXyzrenderFormVisibility(toolbar);
          scheduleXyzrenderControlsApply(toolbar, 260);
        });
      }
    });
    toolbar.querySelectorAll('[data-buret-xctrl-slider]').forEach(slider => {
      slider.addEventListener('input', () => {
        const name = slider.getAttribute('data-buret-xctrl-slider');
        const field = name ? toolbar.querySelector(`[data-buret-xctrl="${name}"]`) : null;
        if (!field) return;
        field.value = slider.value;
        slider.removeAttribute('data-auto');
        updateXyzrenderFormVisibility(toolbar);
        scheduleXyzrenderControlsApply(toolbar, 120);
      });
      slider.addEventListener('change', () => scheduleXyzrenderControlsApply(toolbar, 0));
    });
    document.addEventListener('click', event => {
      const popover = toolbar.querySelector('[data-buret-xyzrender-popover]');
      if (!popover || popover.classList.contains('hidden')) return;
      if (toolbar.contains(event.target)) return;
      setXyzrenderPopoverVisibility(toolbar, false);
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const popover = toolbar.querySelector('[data-buret-xyzrender-popover]');
      if (!popover || popover.classList.contains('hidden')) return;
      setXyzrenderPopoverVisibility(toolbar, false);
    }, true);
    toolbar.querySelectorAll('.buret-xyzrender-advanced').forEach(section => {
      section.addEventListener('toggle', () => positionXyzrenderPopover(toolbar));
    });
    toolbar.dataset.xyzrenderControlsBound = '1';
  }

  function bindThemeButton(toolbar, viewer) {
    const button = toolbar?.querySelector('[data-buret-action="theme"]');
    if (!button) return;
    button.onclick = () => {
      toggleViewerTheme(viewer);
    };
  }

  function bindQuickLookOpenButton() {
    const button = document.getElementById('buret-open-in-app');
    if (!button) return;
    button.onclick = () => {
      const sent = postHostMessage({ type: 'action', message: 'open-burrete' });
      if (!sent) setStatus('Open in Burrete is available only in Quick Look.', 'error');
    };
  }

  function restoreToolbarCollapsed(toolbar, viewer) {
    let collapsed = false;
    try {
      const stored = window.localStorage && window.localStorage.getItem('buret.toolbar.collapsed');
      const version = window.localStorage && window.localStorage.getItem('buret.toolbar.collapsed.version');
      if (version === TOOLBAR_COLLAPSED_VERSION) {
        if (stored === '0') collapsed = false;
        else if (stored === '1') collapsed = true;
      } else {
        window.localStorage && window.localStorage.removeItem('buret.toolbar.collapsed');
      }
    } catch (_) {}
    setToolbarCollapsed(toolbar, collapsed, viewer, false);
  }

  function setToolbarCollapsed(toolbar, collapsed, viewer, persist = true) {
    if (collapsed) setXyzrenderPopoverVisibility(toolbar, false);
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
        window.localStorage && window.localStorage.setItem('buret.toolbar.collapsed.version', TOOLBAR_COLLAPSED_VERSION);
        window.localStorage && window.localStorage.removeItem('buret.toolbar.position');
      } catch (_) {}
    }
    toolbar.dataset.defaultPosition = '1';
    repositionToolbar(toolbar);
    updateFloatingLayoutOffsets();
    scheduleViewerResize(viewer, 40);
  }

  function initToolbarDrag(toolbar) {
    if (toolbar.dataset.dragBound === '1') return;
    toolbar.dataset.dragBound = '1';
    let hasSavedPosition = false;
    try {
      const raw = window.localStorage && window.localStorage.getItem('buret.toolbar.position');
      const version = window.localStorage && window.localStorage.getItem('buret.toolbar.position.version');
      if (raw && version === TOOLBAR_POSITION_VERSION) {
        const saved = JSON.parse(raw);
        if (saved.mode === 'custom' && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
          undockToolbar(toolbar);
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
    let ignoreNextGripClick = false;
    const grip = toolbar.querySelector('[data-drag-handle]');
    grip?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (ignoreNextGripClick) {
        ignoreNextGripClick = false;
        return;
      }
      setToolbarCollapsed(toolbar, !toolbar.classList.contains('collapsed'), resizeState.viewer);
    });
    toolbar.addEventListener('pointerdown', event => {
      if (event.target.closest('[data-buret-toggle]')) return;
      if (event.target.closest('[data-buret-xyzrender-popover]')) return;
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
      toolbar.classList.add('buret-dragging');
      event.preventDefault();
    });
    toolbar.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!drag.moved) {
        drag.moved = Math.abs(event.clientX - drag.startX) > 4 || Math.abs(event.clientY - drag.startY) > 4;
      }
      if (drag.moved) {
        if (toolbar.dataset.defaultPosition === '1') {
          toolbar.dataset.defaultPosition = '0';
          undockToolbar(toolbar);
        }
        moveToolbar(toolbar, event.clientX - drag.dx, event.clientY - drag.dy);
      }
    });
    toolbar.addEventListener('pointerup', event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const shouldToggle = !drag.moved && drag.startedOnHandle;
      const startedOnHandle = drag.startedOnHandle;
      const shouldSavePosition = drag.moved || !drag.startedOnHandle;
      try { toolbar.releasePointerCapture(event.pointerId); } catch (_) {}
      toolbar.classList.remove('buret-dragging');
      drag = null;
      if (shouldToggle) {
        ignoreNextGripClick = true;
        setToolbarCollapsed(toolbar, !toolbar.classList.contains('collapsed'), resizeState.viewer);
      } else if (shouldSavePosition) {
        ignoreNextGripClick = startedOnHandle;
        toolbar.dataset.defaultPosition = '0';
        undockToolbar(toolbar);
        saveToolbarPosition(toolbar);
      }
    });
    toolbar.addEventListener('pointercancel', () => {
      toolbar.classList.remove('buret-dragging');
      drag = null;
    });
    window.addEventListener('resize', () => {
      repositionToolbar(toolbar);
      updateFloatingLayoutOffsets();
      positionXyzrenderPopover(toolbar);
    });
  }

  function positionXyzrenderPopover(toolbar) {
    const popover = toolbar?.querySelector('[data-buret-xyzrender-popover]');
    if (!popover || popover.classList.contains('hidden')) return;
    const tuneButton = toolbar.querySelector('[data-buret-action="xyzrender-tune"]');
    popover.style.left = 'auto';
    popover.style.right = '0';
    popover.style.maxHeight = Math.max(220, Math.min(430, window.innerHeight - toolbarSafeTop() - 36)) + 'px';
    const margin = 12;
    if (tuneButton) {
      const toolbarRect = toolbar.getBoundingClientRect();
      const tuneRect = tuneButton.getBoundingClientRect();
      const preferredLeft = tuneRect.right - toolbarRect.left - popover.offsetWidth;
      const minLeft = margin - toolbarRect.left;
      const maxLeft = window.innerWidth - margin - toolbarRect.left - popover.offsetWidth;
      popover.style.left = Math.min(Math.max(minLeft, preferredLeft), maxLeft) + 'px';
      popover.style.right = 'auto';
      return;
    }
    const rect = popover.getBoundingClientRect();
    if (rect.left < margin) popover.style.left = margin + 'px';
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
    dockToolbar(toolbar);
    fitToolbarToViewport(toolbar);
    const top = defaultToolbarTop();
    const width = toolbar.offsetWidth || toolbar.getBoundingClientRect().width || 320;
    const rightEdge = window.innerWidth;
    const left = Math.max(TOOLBAR_MARGIN, Math.round(rightEdge - width - TOOLBAR_MARGIN));
    toolbar.dataset.defaultPosition = '1';
    toolbar.style.left = left + 'px';
    toolbar.style.right = 'auto';
    toolbar.style.top = top + 'px';
    updateFloatingLayoutOffsets();
  }

  function moveToolbar(toolbar, left, top) {
    fitToolbarToViewport(toolbar);
    const margin = TOOLBAR_MARGIN;
    const safeTop = toolbarSafeTop();
    const maxLeft = Math.max(margin, window.innerWidth - toolbar.offsetWidth - margin);
    const maxTop = Math.max(safeTop, window.innerHeight - toolbar.offsetHeight - margin);
    toolbar.style.left = Math.min(Math.max(margin, left), maxLeft) + 'px';
    toolbar.style.top = Math.min(Math.max(safeTop, top), maxTop) + 'px';
    toolbar.style.right = 'auto';
    updateFloatingLayoutOffsets();
  }

  function dockToolbar(toolbar) {
    toolbar.classList.add('buret-toolbar-docked');
  }

  function undockToolbar(toolbar) {
    toolbar.classList.remove('buret-toolbar-docked');
  }

  function fitToolbarToViewport(toolbar) {
    const availableWidth = window.innerWidth;
    toolbar.style.maxWidth = Math.max(180, availableWidth - TOOLBAR_MARGIN * 2) + 'px';
    const content = toolbar.querySelector('[data-buret-toolbar-content]');
    if (content) {
      content.style.maxWidth = Math.max(0, availableWidth - TOOLBAR_MARGIN * 2 - 36) + 'px';
    }
  }

  function defaultToolbarTop() {
    return toolbarSafeTop();
  }

  function updateFloatingLayoutOffsets() {
    const root = document.documentElement;
    const panelState = refreshMolstarViewportPanelState();
    const toolbar = document.getElementById('buret-toolbar');
    const toolbarRect = toolbar && !panelState.open ? toolbar.getBoundingClientRect() : null;
    const toolbarBottom = toolbarRect ? toolbarRect.bottom + FLOATING_LAYOUT_GAP : toolbarSafeTop() + 40;
    const viewportControls = document.querySelector('.msp-plugin .msp-viewport-controls');
    const viewportControlsRect = viewportControls ? viewportControls.getBoundingClientRect() : null;
    const selectionToolbarRect = visibleRect('.msp-plugin .msp-selection-viewport-controls > .msp-flex-row');
    const mainRect = visibleRect('.msp-plugin .msp-layout-main');
    const mainTop = mainRect ? mainRect.top : 0;
    const defaultViewportTop = mainTop + 64;
    const panelOpenTop = selectionToolbarRect
      ? Math.ceil(selectionToolbarRect.bottom + FLOATING_LAYOUT_GAP)
      : defaultViewportTop;
    const viewportControlsViewportTop = panelState.open
      ? Math.max(defaultViewportTop, panelOpenTop)
      : toolbarRect && (!viewportControlsRect || rectsOverlapX(toolbarRect, viewportControlsRect, 18))
      ? Math.max(defaultViewportTop, Math.ceil(toolbarBottom))
      : defaultViewportTop;
    const viewportControlsTop = Math.max(TOOLBAR_MARGIN, Math.ceil(viewportControlsViewportTop - mainTop));
    root.style.setProperty('--buret-viewport-controls-top', viewportControlsTop + 'px');

    const bottomLimit = visibleRectTop('.msp-plugin .msp-layout-bottom') || window.innerHeight;
    const panelMaxHeight = Math.max(160, Math.floor(bottomLimit - viewportControlsViewportTop - FLOATING_LAYOUT_GAP));
    root.style.setProperty('--buret-viewport-panel-max-height', panelMaxHeight + 'px');
  }

  function visibleRectTop(selector) {
    const element = document.querySelector(selector);
    if (!element || !isVisible(element)) return 0;
    const rect = element.getBoundingClientRect();
    return rect.height > 0 ? rect.top : 0;
  }

  function visibleRect(selector) {
    const element = document.querySelector(selector);
    if (!element || !isVisible(element)) return null;
    return element.getBoundingClientRect();
  }

  function isVisible(element) {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }

  function rectsOverlapX(a, b, padding = 0) {
    return a.left < b.right + padding && a.right > b.left - padding;
  }

  function installMolstarFloatingPanelTracking() {
    if (floatingPanelTrackingInstalled || !document.body) return;
    floatingPanelTrackingInstalled = true;
    const observer = new MutationObserver(scheduleFloatingLayoutRefresh);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden']
    });
    window.addEventListener('resize', scheduleFloatingLayoutRefresh);
    document.addEventListener('click', () => setTimeout(scheduleFloatingLayoutRefresh, 0), true);
    scheduleFloatingLayoutRefresh();
  }

  function scheduleFloatingLayoutRefresh() {
    if (floatingLayoutFrame) return;
    floatingLayoutFrame = requestAnimationFrame(() => {
      floatingLayoutFrame = 0;
      updateFloatingLayoutOffsets();
    });
  }

  function refreshMolstarViewportPanelState() {
    const panels = Array.from(document.querySelectorAll('.msp-plugin .msp-viewport-controls-panel')).filter(isVisible);
    panels.forEach(installDraggableViewportPanel);
    const panelOpen = panels.length > 0;
    const selectionOpen = !!visibleRect('.msp-plugin .msp-selection-viewport-controls > .msp-flex-row');
    if (panelOpen !== molstarViewportPanelOpen || selectionOpen !== molstarSelectionControlsOpen) {
      molstarViewportPanelOpen = panelOpen;
      molstarSelectionControlsOpen = selectionOpen;
      const suppressToolbar = panelOpen || selectionOpen;
      document.body?.classList.toggle('buret-molstar-viewport-panel-open', panelOpen);
      document.body?.classList.toggle('buret-molstar-selection-controls-open', selectionOpen);
      const toolbar = document.getElementById('buret-toolbar');
      if (toolbar) {
        toolbar.classList.toggle('buret-suppressed-by-molstar-panel', suppressToolbar);
        if (toolbar.dataset.defaultPosition === '1') {
          requestAnimationFrame(() => applyDefaultToolbarPosition(toolbar));
        }
      }
    }
    return { open: panelOpen, selectionOpen, panels };
  }

  function installDraggableViewportPanel(panel) {
    if (draggableViewportPanels.has(panel)) return;
    draggableViewportPanels.add(panel);
    panel.classList.add('buret-draggable-viewport-panel');

    let drag = null;
    let suppressClick = false;
    panel.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      if (event.target.closest('input, select, textarea, [contenteditable="true"]')) return;
      const dragHeader = panel.querySelector(':scope > .msp-control-group-wrapper:first-child > .msp-control-group-header');
      if (!dragHeader || !dragHeader.contains(event.target)) return;
      const rect = panel.getBoundingClientRect();
      if (event.clientX > rect.right - PANEL_CLOSE_HIT_WIDTH) return;
      const parentRect = panel.offsetParent?.getBoundingClientRect?.() || { left: 0, top: 0 };
      drag = {
        pointerId: event.pointerId,
        dx: event.clientX - rect.left,
        dy: event.clientY - rect.top,
        parentLeft: parentRect.left,
        parentTop: parentRect.top,
        startX: event.clientX,
        startY: event.clientY,
        moved: false
      };
      panel.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    panel.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!drag.moved) {
        drag.moved = Math.abs(event.clientX - drag.startX) > 4 || Math.abs(event.clientY - drag.startY) > 4;
      }
      if (!drag.moved) return;
      const left = event.clientX - drag.dx;
      const top = event.clientY - drag.dy;
      moveViewportPanel(panel, left, top, drag.parentLeft, drag.parentTop);
      event.preventDefault();
    });
    panel.addEventListener('pointerup', event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      suppressClick = drag.moved;
      try { panel.releasePointerCapture(event.pointerId); } catch (_) {}
      drag = null;
    });
    panel.addEventListener('pointercancel', () => { drag = null; });
    panel.addEventListener('click', event => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }, true);
  }

  function moveViewportPanel(panel, viewportLeft, viewportTop, parentLeft, parentTop) {
    const margin = TOOLBAR_MARGIN;
    const width = panel.offsetWidth || panel.getBoundingClientRect().width || 290;
    const height = panel.offsetHeight || panel.getBoundingClientRect().height || 160;
    const left = Math.min(Math.max(margin, viewportLeft), Math.max(margin, window.innerWidth - width - margin));
    const top = Math.min(Math.max(margin, viewportTop), Math.max(margin, window.innerHeight - height - margin));
    panel.style.left = Math.round(left - parentLeft) + 'px';
    panel.style.top = Math.round(top - parentTop) + 'px';
    panel.style.right = 'auto';
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
    syncLeftPanelVisibility();

    updateToolbarButtons();
    scheduleViewerResize(viewer, 40);
    updateFloatingLayoutOffsets();
    const toolbar = document.getElementById('buret-toolbar');
    if (toolbar?.dataset.defaultPosition === '1') {
      requestAnimationFrame(() => applyDefaultToolbarPosition(toolbar));
      setTimeout(() => applyDefaultToolbarPosition(toolbar), 120);
    }
  }

  function scheduleLayoutStateReapply(viewer) {
    [250, 1000, 3000, 6000].forEach(delayMs => {
      setTimeout(() => reapplyLayoutStateAfterMolstarPass(viewer), delayMs);
    });
  }

  function reapplyLayoutStateAfterMolstarPass(viewer) {
    if (layoutState.left !== 'hidden') {
      applyLayoutState(viewer);
      return;
    }
    try {
      viewer?.plugin?.layout?.setProps?.({ regionState: { ...layoutState, left: 'full' } });
    } catch (error) {
      debug('layout left panel nudge failed: ' + (error && error.message || String(error)));
    }
    requestAnimationFrame(() => applyLayoutState(viewer));
    setTimeout(() => applyLayoutState(viewer), 80);
  }

  function syncLeftPanelVisibility() {
    document.querySelectorAll('.msp-layout-region.msp-layout-left').forEach(region => {
      if (layoutState.left === 'hidden') {
        region.style.display = 'none';
        region.setAttribute('aria-hidden', 'true');
      } else {
        region.style.display = '';
        region.removeAttribute('aria-hidden');
      }
    });
  }

  function installLeftPanelVisibilityGuard() {
    if (leftPanelVisibilityGuardInstalled || !document.body) return;
    leftPanelVisibilityGuardInstalled = true;
    const observer = new MutationObserver(() => {
      if (layoutState.left === 'hidden') syncLeftPanelVisibility();
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'style'],
      childList: true,
      subtree: true
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

  function appendCacheBuster(url, cb) {
    const separator = url.includes('?') ? '&' : '?';
    return url + separator + 'v=' + encodeURIComponent(cb);
  }

  function runtimeURL(globalName, fallback) {
    const configured = window[globalName];
    return typeof configured === 'string' && configured.length > 0 ? configured : fallback;
  }

  function installNativeDataBridge() {
    if (typeof window.BurreteReceiveNativeData === 'function') return;
    window.BurreteReceiveNativeData = function (payload) {
      if (!payload || typeof payload !== 'object') return;
      if (typeof payload.base64 === 'string' && payload.base64.length > 0) {
        window.BurreteDataBase64 = payload.base64;
      }
      window.dispatchEvent(new CustomEvent('BurreteNativeDataReady', { detail: payload }));
    };
  }

  function requestStructureDataFromNative() {
    installNativeDataBridge();
    return new Promise((resolve, reject) => {
      if (typeof window.__mqlPost !== 'function') {
        reject(new Error('Native Quick Look bridge is unavailable.'));
        return;
      }
      const requestToken = 'native-data-' + Math.random().toString(36).slice(2);
      let settled = false;
      const cleanup = () => {
        window.removeEventListener('BurreteNativeDataReady', onReady);
        clearTimeout(timeout);
      };
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn(value);
      };
      const onReady = (event) => {
        const payload = event.detail || {};
        if (payload.requestToken !== requestToken) return;
        if (payload.error) {
          finish(reject, new Error(String(payload.error)));
          return;
        }
        finish(resolve);
      };
      const timeout = setTimeout(() => {
        finish(reject, new Error('Timed out while waiting for structure payload from native Quick Look.'));
      }, 10000);
      window.addEventListener('BurreteNativeDataReady', onReady);
      try {
        window.__mqlPost('requestData', 'requestData', { requestToken });
      } catch (error) {
        finish(reject, error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  function loadArrayBufferViaXHR(url) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('GET', url, true);
      request.responseType = 'arraybuffer';
      request.onload = function () {
        if (request.status && (request.status < 200 || request.status >= 300)) {
          reject(new Error('Could not load structure payload: HTTP ' + request.status));
          return;
        }
        if (!(request.response instanceof ArrayBuffer)) {
          reject(new Error('Could not load structure payload: empty response'));
          return;
        }
        resolve(new Uint8Array(request.response));
      };
      request.onerror = function () {
        reject(new Error('Could not load structure payload via XMLHttpRequest.'));
      };
      request.send();
    });
  }

  async function loadStructureData(config, cb) {
    if (window.BurreteDataBytes instanceof Uint8Array || window.BurreteDataBase64) return;
    const configured = typeof config.dataPath === 'string' ? config.dataPath : null;
    const scripted = typeof window.BurreteDataURL === 'string' ? window.BurreteDataURL : null;
    const url = configured || scripted || './preview-data.bin';
    const requestURL = appendCacheBuster(url, cb);
    try {
      const response = await fetch(requestURL, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Could not load structure payload: HTTP ' + response.status);
      }
      window.BurreteDataBytes = new Uint8Array(await response.arrayBuffer());
      return;
    } catch (error) {
      debug('fetch preview-data.bin failed, falling back to XMLHttpRequest: ' + (error && error.message || String(error)));
    }
    try {
      window.BurreteDataBytes = await loadArrayBufferViaXHR(requestURL);
      return;
    } catch (error) {
      debug('XMLHttpRequest preview-data.bin failed, requesting native structure payload: ' + (error && error.message || String(error)));
    }
    await requestStructureDataFromNative();
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

  function isDirectTemplatePreview() {
    if (window.location.protocol !== 'file:') return false;
    const path = decodeURIComponent(window.location.pathname || '');
    return /\/PreviewExtension\/Web\/index\.html$/u.test(path);
  }

  function installDirectTemplateFallback() {
    if (!isDirectTemplatePreview()) return false;
    window.BurreteConfig = {
      label: 'Burrete mini sample',
      format: 'pdb',
      binary: false,
      renderer: 'molstar',
      byteCount: 829,
      showPanelControls: true,
      theme: 'dark',
      canvasBackground: 'black',
      molstarStyle: DEFAULT_MOLSTAR_STYLE,
      overlayOpacity: 0.9,
      defaultLayoutState: {
        left: 'hidden',
        right: 'hidden',
        top: 'hidden',
        bottom: 'hidden'
      }
    };
    window.BurreteDataBase64 = 'SEVBREVSICAgIE1JTkkgR0xZLUFMQSBQRVBUSURFIEZPUiBRVUlDSyBMT09LIFRFU1QKVElUTEUgICAgIE1PTFNUQVIgUVVJQ0sgTE9PSyBTQU1QTEUKQVRPTSAgICAgIDEgIE4gICBHTFkgQSAgIDEgICAgICAtMS4yMDQgICAwLjE3NiAgIDAuMDAwICAxLjAwIDIwLjAwICAgICAgICAgICBOCkFUT00gICAgICAyICBDQSAgR0xZIEEgICAxICAgICAgIDAuMDAwICAgMC4wMDAgICAwLjAwMCAgMS4wMCAyMC4wMCAgICAgICAgICAgQwpBVE9NICAgICAgMyAgQyAgIEdMWSBBICAgMSAgICAgICAwLjcyMiAgIDEuMjcxICAgMC4wMDAgIDEuMDAgMjAuMDAgICAgICAgICAgIEMKQVRPTSAgICAgIDQgIE8gICBHTFkgQSAgIDEgICAgICAgMC4xNjMgICAyLjM2MCAgIDAuMDAwICAxLjAwIDIwLjAwICAgICAgICAgICBPCkFUT00gICAgICA1ICBOICAgQUxBIEEgICAyICAgICAgIDIuMDUyICAgMS4xODkgICAwLjAwMCAgMS4wMCAyMC4wMCAgICAgICAgICAgTgpBVE9NICAgICAgNiAgQ0EgIEFMQSBBICAgMiAgICAgICAyLjg5NiAgIDIuMzc3ICAgMC4wMDAgIDEuMDAgMjAuMDAgICAgICAgICAgIEMKQVRPTSAgICAgIDcgIENCICBBTEEgQSAgIDIgICAgICAgMy43MTEgICAyLjI3MyAgIDEuMjc2ICAxLjAwIDIwLjAwICAgICAgICAgICBDCkFUT00gICAgICA4ICBDICAgQUxBIEEgICAyICAgICAgIDMuNzkzICAgMi40NzcgIC0xLjIzMCAgMS4wMCAyMC4wMCAgICAgICAgICAgQwpBVE9NICAgICAgOSAgTyAgIEFMQSBBICAgMiAgICAgICA0LjY3NSAgIDMuMzM2ICAtMS4yMzYgIDEuMDAgMjAuMDAgICAgICAgICAgIE8KVEVSICAgICAgMTAgICAgICBBTEEgQSAgIDIKRU5ECg==';
    setStatus('[web] Using built-in mini sample for direct template preview.');
    return true;
  }

  async function loadRuntimeInputs(cb) {
    if (window.BurreteConfig) return;
    try {
      if (!window.BurreteConfig) {
        await loadScript(appendCacheBuster(runtimeURL('BurretePreviewConfigURL', './preview-config.js'), cb), 'preview config', 10000);
      }
    } catch (error) {
      if (installDirectTemplateFallback()) return;
      throw error;
    }
  }

  function rawStructureData(config) {
    if (window.BurreteDataBytes instanceof Uint8Array) {
      return config.binary ? window.BurreteDataBytes : new TextDecoder('utf-8', { fatal: false }).decode(window.BurreteDataBytes);
    }
    const base64 = window.BurreteDataBase64;
    if (!base64 || typeof base64 !== 'string') {
      throw new Error('Preview payload was not loaded.');
    }
    return config.binary ? base64ToBytes(base64) : base64ToText(base64);
  }

  function dockingPayloadData(source, payload) {
    if (!payload || typeof payload.dataBase64 !== 'string') {
      throw new Error(`Docking payload for ${source?.label || 'structure'} was not loaded.`);
    }
    return source?.binary ? base64ToBytes(payload.dataBase64) : base64ToText(payload.dataBase64);
  }

  function dockingPoseStorageKey(config) {
    const documentId = String(config?.documentId || '').trim();
    if (documentId) return `burrete.dockingPose.${documentId}`;
    const fallback = `${config?.label || 'active'}:${window.location.pathname}:${window.location.search}`;
    return `burrete.dockingPose.fallback-${stableTextHash(fallback)}`;
  }

  function stableTextHash(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function readDockingPoseIndex(config, poseCount) {
    const fallback = Number(config.docking?.activePose || 0);
    let value = fallback;
    try {
      const stored = sessionStorage.getItem(dockingPoseStorageKey(config));
      if (stored !== null) value = Number(stored);
    } catch (_) {}
    if (!Number.isFinite(value)) value = 0;
    return Math.max(0, Math.min(poseCount - 1, Math.trunc(value)));
  }

  function prepareDockingStructure(config) {
    const docking = config.docking || {};
    const payloads = window.BurreteDockingPayloads || {};
    const receptor = docking.receptor;
    if (!receptor) throw new Error('Docking view is missing a receptor.');
    const ligandSources = Array.isArray(docking.ligands) ? docking.ligands : [];
    const ligandPayloads = Array.isArray(payloads.ligands) ? payloads.ligands : [];
    const poses = [];
    const entries = [
      {
        data: dockingPayloadData(receptor, payloads.receptor),
        format: normalizeFormat(receptor.format),
        label: receptor.label || 'Receptor'
      }
    ];
    let nativeTrajectoryPoseCount = 0;
    ligandSources.forEach((source, ligandIndex) => {
      const data = dockingPayloadData(source, ligandPayloads[ligandIndex]);
      const format = normalizeFormat(source.format);
      if (format === 'sdf') {
        const records = splitSdfRecords(data);
        if (records.length > 1) {
          nativeTrajectoryPoseCount += records.length;
          entries.push({
            data,
            format: 'sdf',
            label: source.label || `Ligand ${ligandIndex + 1}`,
            loadPreset: 'default'
          });
          records.forEach((record, poseIndex) => {
            poses.push({
              data: `${record}\n$$$$\n`,
              format: 'sdf',
              label: `${source.label || `Ligand ${ligandIndex + 1}`} pose ${poseIndex + 1}`,
              ligandIndex,
              poseIndex,
              poseCount: records.length
            });
          });
          return;
        }
      }
      entries.push({
        data,
        format,
        label: source.label || `Ligand ${ligandIndex + 1}`
      });
      poses.push({
        data,
        format,
        label: source.label || `Ligand ${ligandIndex + 1}`,
        ligandIndex,
        poseIndex: 0,
        poseCount: 1
      });
    });
    if (poses.length === 0) throw new Error('Docking view has no ligand poses.');
    const activePose = readDockingPoseIndex(config, poses.length);
    if (nativeTrajectoryPoseCount > 1) {
      return {
        kind: 'docking',
        label: config.label || 'Docking view',
        activePose: 0,
        poseCount: nativeTrajectoryPoseCount,
        nativeTrajectoryControls: true,
        ligandLabel: 'Mol* trajectory',
        entries
      };
    }
    return {
      kind: 'docking',
      label: config.label || 'Docking view',
      activePose,
      poseCount: poses.length,
      ligandLabel: poses[activePose].label,
      entries: [
        entries[0],
        poses[activePose]
      ]
    };
  }

  function normalizeRenderer(renderer) {
    const value = String(renderer || 'molstar').toLowerCase();
    if (value === 'xyz-fast' || value === 'fast-xyz' || value === 'xyzfast') return 'xyz-fast';
    if (value === 'xyzrender-external' || value === 'external-xyzrender') return 'xyzrender-external';
    return 'molstar';
  }

  function structureDataForMolstar(config) {
    if (config.docking) {
      return prepareDockingStructure(config);
    }
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
    disposeExternalArtifactInteractions();
    const label = config.label || 'structure';
    const size = describeBytes(config.byteCount);
    setStatus(`[web] Loading Fast XYZ renderer…\n${label} (XYZ${size ? `, ${size}` : ''})`);
    if (!window.BurreteXYZFast) {
      await loadScript(appendCacheBuster(runtimeURL('BurreteXyzFastURL', './xyz-fast.js'), cb), 'Fast XYZ renderer', 10000);
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
    disposeExternalArtifactInteractions();
    const artifact = config.externalArtifact;
    const inlineSvg = artifact?.inlineSvg || (artifact?.inlineSvgBase64 ? base64ToText(artifact.inlineSvgBase64) : '');
    if (!artifact || (!artifact.path && !inlineSvg)) {
      throw new Error('External xyzrender renderer was selected, but no externalArtifact payload was provided.');
    }
    setStatus(`[web] Loading xyzrender artifact…\n${config.label || 'structure'}`);
    installExternalArtifactStyles();
    const container = document.getElementById('app');
    const preset = artifact.preset ? ` · ${escapeHTML(artifact.preset)}` : '';
    const elapsed = Number.isFinite(Number(artifact.elapsedMs)) ? ` · ${Number(artifact.elapsedMs)} ms` : '';
    const content = inlineSvg
      ? `<div class="buret-external-artifact-stage"><div class="buret-external-artifact-inline" aria-label="${escapeHTML(config.label || 'xyzrender artifact')}">${inlineSvg}</div></div>`
      : `<div class="buret-external-artifact-stage"><object class="buret-external-artifact-object" data="${safeRelativeArtifactPath(artifact.path)}" type="image/svg+xml" aria-label="${escapeHTML(config.label || 'xyzrender artifact')}"></object></div>`;
    container.innerHTML = `
      <div class="buret-external-artifact-root">
        ${content}
        <div class="buret-xyz-badge"><strong>External xyzrender</strong><span>SVG${preset}${elapsed}</span></div>
      </div>`;
    const root = container.querySelector('.buret-external-artifact-root');
    if (root) installExternalArtifactInteractions(root);
    initStaticRendererToolbar();
    setStatus(`[web] Rendered ${config.label || 'structure'} with external xyzrender`);
    setTimeout(hideStatus, 450);
  }

  function initStaticRendererToolbar() {
    const toolbar = document.getElementById('buret-toolbar');
    if (!toolbar) return;
    toolbar.querySelectorAll('.buret-panel-toggle').forEach(button => { button.classList.add('hidden'); });
    bindThemeButton(toolbar, null);
    bindXyzrenderControls(toolbar);
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
      .buret-external-artifact-root { position: absolute; inset: 0; overflow: hidden; background: var(--buret-shell-background, #000); touch-action: none; }
      body.burette-transparent-background .buret-external-artifact-root { background: transparent; }
      .buret-external-artifact-stage { position: absolute; inset: 0; transform: translate(0px, 0px) scale(1); transform-origin: 50% 50%; will-change: transform; cursor: grab; }
      .buret-external-artifact-stage.dragging { cursor: grabbing; }
      .buret-external-artifact-inline { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; box-sizing: border-box; overflow: hidden; }
      .buret-external-artifact-inline > svg { display: block; width: auto; height: auto; max-width: 100%; max-height: 100%; margin: auto; border-radius: 8px; box-shadow: 0 18px 54px rgba(0,0,0,0.28); }
      .buret-external-artifact-object { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block; }
      .buret-xyz-badge { position: absolute; left: 14px; bottom: 14px; z-index: 30; max-width: calc(100vw - 28px); box-sizing: border-box; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--buret-toolbar-border, rgba(255,255,255,0.12)); color: var(--buret-toolbar-color, rgba(255,255,255,0.92)); background: var(--buret-toolbar-background, rgba(12,13,14,0.9)); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); box-shadow: 0 8px 22px rgba(0,0,0,0.20); font: 11px/1.35 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; pointer-events: none; }
      .buret-xyz-badge strong { display: block; font-size: 11px; }
      .buret-xyz-badge span { display: block; opacity: 0.76; }
    `;
    document.head.appendChild(style);
  }

  function disposeExternalArtifactInteractions() {
    if (!externalArtifactInteractionsCleanup) return;
    try { externalArtifactInteractionsCleanup(); } catch (_) {}
    externalArtifactInteractionsCleanup = null;
  }

  function installExternalArtifactInteractions(root) {
    disposeExternalArtifactInteractions();
    const stage = root.querySelector('.buret-external-artifact-stage');
    if (!stage) return;

    let scale = 1;
    let translateX = 0;
    let translateY = 0;
    let dragPointerId = null;
    let dragClientX = 0;
    let dragClientY = 0;
    let gestureBaseScale = 1;
    const pointers = new Map();
    let pinchState = null;

    const clampScale = value => Math.min(8, Math.max(0.05, value));
    const clampTranslation = () => {
      if (Math.abs(scale - 1) < 0.001) {
        scale = 1;
        translateX = 0;
        translateY = 0;
        return;
      }
      const maxX = root.clientWidth * Math.abs(scale - 1) * 0.5;
      const maxY = root.clientHeight * Math.abs(scale - 1) * 0.5;
      translateX = Math.min(maxX, Math.max(-maxX, translateX));
      translateY = Math.min(maxY, Math.max(-maxY, translateY));
    };
    const apply = () => {
      clampTranslation();
      stage.style.transform = `translate(${translateX.toFixed(2)}px, ${translateY.toFixed(2)}px) scale(${scale.toFixed(4)})`;
    };
    const zoomAt = (nextScale, clientX, clientY) => {
      const rect = root.getBoundingClientRect();
      const anchorX = clientX - (rect.left + rect.width / 2);
      const anchorY = clientY - (rect.top + rect.height / 2);
      const clamped = clampScale(nextScale);
      const ratio = clamped / scale;
      translateX = translateX * ratio + anchorX * (1 - ratio);
      translateY = translateY * ratio + anchorY * (1 - ratio);
      scale = clamped;
      apply();
    };
    const reset = () => {
      scale = 1;
      translateX = 0;
      translateY = 0;
      stage.classList.remove('dragging');
      apply();
    };
    const pointerCenter = () => {
      const items = Array.from(pointers.values());
      if (items.length < 2) return null;
      return {
        x: (items[0].x + items[1].x) / 2,
        y: (items[0].y + items[1].y) / 2,
        distance: Math.hypot(items[0].x - items[1].x, items[0].y - items[1].y)
      };
    };

    const onWheel = event => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);
      zoomAt(scale * factor, event.clientX, event.clientY);
    };
    const onPointerDown = event => {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) {
        dragPointerId = event.pointerId;
        dragClientX = event.clientX;
        dragClientY = event.clientY;
        try { root.setPointerCapture(event.pointerId); } catch (_) {}
      } else if (pointers.size === 2) {
        pinchState = pointerCenter();
      }
    };
    const onPointerMove = event => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size >= 2) {
        const center = pointerCenter();
        if (!center || !pinchState || pinchState.distance < 1) {
          pinchState = center;
          return;
        }
        zoomAt(scale * (center.distance / pinchState.distance), center.x, center.y);
        pinchState = center;
        return;
      }
      if (dragPointerId !== event.pointerId || Math.abs(scale - 1) < 0.001) return;
      translateX += event.clientX - dragClientX;
      translateY += event.clientY - dragClientY;
      dragClientX = event.clientX;
      dragClientY = event.clientY;
      stage.classList.add('dragging');
      apply();
    };
    const finishPointer = event => {
      pointers.delete(event.pointerId);
      if (dragPointerId === event.pointerId) {
        dragPointerId = null;
        stage.classList.remove('dragging');
        try { root.releasePointerCapture(event.pointerId); } catch (_) {}
      }
      if (pointers.size < 2) pinchState = null;
    };
    const onGestureStart = event => {
      event.preventDefault();
      gestureBaseScale = scale;
    };
    const onGestureChange = event => {
      event.preventDefault();
      zoomAt(gestureBaseScale * Number(event.scale || 1), Number(event.clientX || 0), Number(event.clientY || 0));
    };

    root.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', finishPointer);
    root.addEventListener('pointercancel', finishPointer);
    root.addEventListener('dblclick', reset);
    root.addEventListener('gesturestart', onGestureStart, { passive: false });
    root.addEventListener('gesturechange', onGestureChange, { passive: false });
    apply();
    externalArtifactInteractionsCleanup = () => {
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerup', finishPointer);
      root.removeEventListener('pointercancel', finishPointer);
      root.removeEventListener('dblclick', reset);
      root.removeEventListener('gesturestart', onGestureStart);
      root.removeEventListener('gesturechange', onGestureChange);
    };
  }

  function prepareSdfStructure(text, config) {
    const label = config.label || 'structure';
    const records = splitSdfRecords(text);
    if (records.length > 1 && config.sdfPosePager === true) {
      return {
        data: text,
        format: 'sdf',
        label: `${label} (${records.length} SDF poses)`,
        loadPreset: 'default',
        nativeTrajectoryControls: true,
        poseCount: records.length
      };
    }
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

  async function applyMolstarStyle(viewer, style) {
    const plugin = viewer?.plugin;
    if (!plugin) return;

    if (style === 'illustrative') {
      await plugin.managers.structure.component.setOptions({
        ...plugin.managers.structure.component.state.options,
        ignoreLight: true
      });
      if (plugin.canvas3d) {
        const postprocessing = plugin.canvas3d.props.postprocessing;
        plugin.canvas3d.setProps({
          postprocessing: {
            outline: {
              name: 'on',
              params: postprocessing.outline.name === 'on'
                ? postprocessing.outline.params
                : {
                    scale: 1,
                    color: 0x000000,
                    threshold: 0.33,
                    includeTransparent: true
                  }
            },
            occlusion: {
              name: 'on',
              params: postprocessing.occlusion.name === 'on'
                ? postprocessing.occlusion.params
                : {
                    multiScale: { name: 'off', params: {} },
                    radius: 5,
                    bias: 0.8,
                    blurKernelSize: 15,
                    blurDepthBias: 0.5,
                    samples: 32,
                    resolutionScale: 1,
                    color: 0x000000,
                    transparentThreshold: 0.4
                  }
            },
            shadow: { name: 'off', params: {} }
          }
        });
      }
    }
  }

  async function loadPreparedStructure(viewer, prepared) {
    if (prepared.kind === 'docking') {
      await loadDockingPreparedStructure(viewer, prepared);
      return;
    }
    if (prepared.loadPreset === 'all-models') {
      const plugin = viewer.plugin;
      const data = await plugin.builders.data.rawData({ data: prepared.data, label: prepared.label });
      const trajectory = await plugin.builders.structure.parseTrajectory(data, prepared.format);
      await plugin.builders.structure.hierarchy.applyPreset(trajectory, 'all-models', {
        useDefaultIfSingleModel: true
      });
      await applyMolstarStyle(viewer, configuredMolstarStyle(activeConfig));
      return;
    }
    const plugin = viewer.plugin;
    const data = await plugin.builders.data.rawData({ data: prepared.data, label: prepared.label });
    const trajectory = await plugin.builders.structure.parseTrajectory(data, prepared.format);
    await plugin.builders.structure.hierarchy.applyPreset(trajectory, 'default');
    await applyMolstarStyle(viewer, configuredMolstarStyle(activeConfig));
  }

  async function loadMolstarEntry(viewer, entry) {
    const plugin = viewer.plugin;
    const normalized = normalizeFormat(entry.format);
    const payload = normalized === 'cifCore'
      ? { data: coreCifToPdb(entry.data), format: 'pdb' }
      : { data: entry.data, format: normalized };
    const data = await plugin.builders.data.rawData({ data: payload.data, label: entry.label });
    const trajectory = await plugin.builders.structure.parseTrajectory(data, payload.format);
    await plugin.builders.structure.hierarchy.applyPreset(trajectory, entry.loadPreset || 'default');
  }

  async function loadDockingPreparedStructure(viewer, prepared) {
    const plugin = viewer.plugin;
    if (typeof plugin.clear === 'function') {
      await plugin.clear();
    }
    for (const entry of prepared.entries) {
      await loadMolstarEntry(viewer, entry);
    }
    await applyMolstarStyle(viewer, configuredMolstarStyle(activeConfig));
    installDockingPoseControls(viewer, prepared);
  }

  let dockingPoseKeydownDisposer = null;
  let dockingPoseControlsDisposer = null;

  function isDockingPoseKeyboardTarget(target) {
    const element = target instanceof Element ? target : null;
    if (!element) return false;
    const tag = element.tagName.toLowerCase();
    return tag === 'input' || tag === 'select' || tag === 'textarea' || element.isContentEditable;
  }

  function moveDockingPoseControls(root, left, top) {
    const margin = TOOLBAR_MARGIN;
    const width = root.offsetWidth || root.getBoundingClientRect().width || 180;
    const height = root.offsetHeight || root.getBoundingClientRect().height || 40;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    root.style.left = Math.round(Math.min(Math.max(margin, left), maxLeft)) + 'px';
    root.style.top = Math.round(Math.min(Math.max(margin, top), maxTop)) + 'px';
    root.style.right = 'auto';
    root.style.bottom = 'auto';
  }

  function saveDockingPoseControlsPosition(root) {
    try {
      const rect = root.getBoundingClientRect();
      window.localStorage && window.localStorage.setItem('buret.dockingPoseControls.position', JSON.stringify({ left: rect.left, top: rect.top, mode: 'custom' }));
      window.localStorage && window.localStorage.setItem('buret.dockingPoseControls.position.version', DOCKING_POSE_POSITION_VERSION);
    } catch (_) {}
  }

  function restoreDockingPoseControlsPosition(root) {
    let restored = false;
    try {
      const raw = window.localStorage && window.localStorage.getItem('buret.dockingPoseControls.position');
      const version = window.localStorage && window.localStorage.getItem('buret.dockingPoseControls.position.version');
      if (raw && version === DOCKING_POSE_POSITION_VERSION) {
        const saved = JSON.parse(raw);
        if (saved.mode === 'custom' && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
          root.dataset.defaultPosition = '0';
          moveDockingPoseControls(root, saved.left, saved.top);
          restored = true;
        }
      } else if (raw) {
        window.localStorage && window.localStorage.removeItem('buret.dockingPoseControls.position');
      }
    } catch (_) {}
    if (restored) return;
    root.dataset.defaultPosition = '1';
    root.style.left = '14px';
    root.style.right = 'auto';
    root.style.top = 'auto';
    root.style.bottom = '14px';
  }

  function repositionDockingPoseControls(root) {
    if (root.dataset.defaultPosition === '1') return;
    const rect = root.getBoundingClientRect();
    moveDockingPoseControls(root, rect.left, rect.top);
    saveDockingPoseControlsPosition(root);
  }

  function initDockingPoseControlsDrag(root) {
    let drag = null;
    const onPointerDown = (event) => {
      if (event.button !== 0) return;
      if (event.target.closest('button, input, select, textarea, [contenteditable="true"]')) return;
      const rect = root.getBoundingClientRect();
      drag = {
        pointerId: event.pointerId,
        dx: event.clientX - rect.left,
        dy: event.clientY - rect.top,
        startX: event.clientX,
        startY: event.clientY,
        moved: false
      };
      root.setPointerCapture(event.pointerId);
      root.classList.add('buret-docking-poses-dragging');
      event.preventDefault();
    };
    const onPointerMove = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!drag.moved) {
        drag.moved = Math.abs(event.clientX - drag.startX) > 4 || Math.abs(event.clientY - drag.startY) > 4;
      }
      if (!drag.moved) return;
      root.dataset.defaultPosition = '0';
      moveDockingPoseControls(root, event.clientX - drag.dx, event.clientY - drag.dy);
      event.preventDefault();
    };
    const finishDrag = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      try { root.releasePointerCapture(event.pointerId); } catch (_) {}
      if (drag.moved) saveDockingPoseControlsPosition(root);
      root.classList.remove('buret-docking-poses-dragging');
      drag = null;
    };
    const cancelDrag = () => {
      root.classList.remove('buret-docking-poses-dragging');
      drag = null;
    };
    const onResize = () => repositionDockingPoseControls(root);
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', finishDrag);
    root.addEventListener('pointercancel', cancelDrag);
    root.addEventListener('lostpointercapture', cancelDrag);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', finishDrag, true);
    window.addEventListener('pointercancel', cancelDrag, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', finishDrag, true);
      window.removeEventListener('pointercancel', cancelDrag, true);
      window.removeEventListener('resize', onResize);
    };
  }

  function nativeTrajectoryControlsRoot() {
    const roots = Array.from(document.querySelectorAll('.msp-viewport-top-left-controls, .msp-animation-viewport-controls'));
    return roots.find(root => {
      if (/\b(?:Model|Frame)\s+\d+\s*\/\s*\d+/i.test(root.textContent || '')) return true;
      return Array.from(root.querySelectorAll('button')).some(button => (
        /\b(Model|Frame)\b/i.test(`${button.getAttribute('title') || ''} ${button.getAttribute('aria-label') || ''}`)
      ));
    }) || null;
  }

  function readNativeTrajectoryPosition(expectedCount) {
    const root = nativeTrajectoryControlsRoot();
    const text = root?.textContent || '';
    const match = text.match(/\b(?:Model|Frame)\s+(\d+)\s*\/\s*(\d+)/i) || text.match(/\b(\d+)\s*\/\s*(\d+)\b/);
    if (!match) return null;
    const index = Number(match[1]) - 1;
    const total = Number(match[2]);
    if (!Number.isFinite(index) || !Number.isFinite(total) || index < 0) return null;
    if (expectedCount > 0 && total !== expectedCount) return null;
    return { index, total };
  }

  function nativeTrajectoryStepButton(direction) {
    const root = nativeTrajectoryControlsRoot();
    if (!root) return null;
    const buttons = Array.from(root.querySelectorAll('button')).filter(button => (
      /\b(Model|Frame)\b/i.test(`${button.getAttribute('title') || ''} ${button.getAttribute('aria-label') || ''}`)
    ));
    const named = buttons.find(button => {
      const name = `${button.getAttribute('title') || ''} ${button.getAttribute('aria-label') || ''}`.toLowerCase();
      return direction > 0
        ? /\b(next|forward)\b/.test(name)
        : /\b(prev|previous|back)\b/.test(name);
    });
    if (named) return named;
    if (buttons.length < 2) return null;
    return direction > 0 ? buttons[buttons.length - 1] : buttons[buttons.length - 2];
  }

  function afterNativeTrajectoryPaint() {
    return new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  async function setNativeTrajectoryPose(index, poseCount) {
    const current = readNativeTrajectoryPosition(poseCount);
    if (!current) return false;
    const target = Math.max(0, Math.min(poseCount - 1, index));
    if (current.index === target) return true;
    const direction = target > current.index ? 1 : -1;
    for (let step = current.index; step !== target; step += direction) {
      const button = nativeTrajectoryStepButton(direction);
      if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
      button.click();
      await afterNativeTrajectoryPaint();
    }
    return true;
  }

  function installNativeTrajectoryPoseSync(poseCount, onPoseChange) {
    const root = nativeTrajectoryControlsRoot();
    if (!root) return null;
    const sync = () => {
      const position = readNativeTrajectoryPosition(poseCount);
      if (position) onPoseChange(position.index);
    };
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, childList: true, characterData: true, subtree: true });
    sync();
    return () => observer.disconnect();
  }

  function installDockingPoseControls(viewer, prepared) {
    document.querySelector('.buret-docking-poses')?.remove();
    if (dockingPoseKeydownDisposer) {
      dockingPoseKeydownDisposer();
      dockingPoseKeydownDisposer = null;
    }
    if (dockingPoseControlsDisposer) {
      dockingPoseControlsDisposer();
      dockingPoseControlsDisposer = null;
    }
    if (!prepared || prepared.poseCount <= 1) return;
    const root = document.createElement('div');
    root.className = 'buret-docking-poses';
    let activePose = Math.max(0, Math.min(prepared.poseCount - 1, Number(prepared.activePose || 0)));
    const label = document.createElement('span');
    label.title = prepared.ligandLabel || '';
    const previous = document.createElement('button');
    previous.type = 'button';
    previous.textContent = 'Prev';
    previous.setAttribute('aria-label', 'Previous pose');
    const next = document.createElement('button');
    next.type = 'button';
    next.textContent = 'Next';
    next.setAttribute('aria-label', 'Next pose');
    const updateControls = () => {
      label.textContent = `Pose ${activePose + 1} / ${prepared.poseCount}`;
      previous.disabled = activePose <= 0;
      next.disabled = activePose >= prepared.poseCount - 1;
    };
    updateControls();
    const setPose = async (index) => {
      const nextIndex = Math.max(0, Math.min(prepared.poseCount - 1, index));
      const previousIndex = activePose;
      try { sessionStorage.setItem(dockingPoseStorageKey(activeConfig), String(nextIndex)); } catch (_) {}
      previous.disabled = true;
      next.disabled = true;
      label.textContent = `Pose ${nextIndex + 1} / ${prepared.poseCount}`;
      try {
        if (prepared.nativeTrajectoryControls) {
          const switched = await setNativeTrajectoryPose(nextIndex, prepared.poseCount);
          if (!switched) throw new Error('Mol* trajectory controls are not available.');
          activePose = readNativeTrajectoryPosition(prepared.poseCount)?.index ?? nextIndex;
          updateControls();
        } else {
          const nextPrepared = structureDataForMolstar(activeConfig);
          await loadDockingPreparedStructure(viewer, nextPrepared);
          applyLayoutState(viewer);
          scheduleLayoutStateReapply(viewer);
          try { viewer.handleResize(); } catch (_) {}
        }
      } catch (error) {
        try { sessionStorage.setItem(dockingPoseStorageKey(activeConfig), String(previousIndex)); } catch (_) {}
        activePose = previousIndex;
        updateControls();
        setStatus(`[web] Could not switch docking pose.\n\n${error?.message || String(error)}`, 'error');
        // eslint-disable-next-line no-console
        console.error(error);
      }
    };
    previous.addEventListener('click', () => { void setPose(activePose - 1); });
    next.addEventListener('click', () => { void setPose(activePose + 1); });
    const onKeyDown = (event) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (isDockingPoseKeyboardTarget(event.target)) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (activePose > 0) void setPose(activePose - 1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (activePose < prepared.poseCount - 1) void setPose(activePose + 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    dockingPoseKeydownDisposer = () => window.removeEventListener('keydown', onKeyDown);
    root.append(previous, label, next);
    document.body.appendChild(root);
    restoreDockingPoseControlsPosition(root);
    const dragDisposer = initDockingPoseControlsDrag(root);
    const syncDisposer = prepared.nativeTrajectoryControls
      ? installNativeTrajectoryPoseSync(prepared.poseCount, index => {
          activePose = Math.max(0, Math.min(prepared.poseCount - 1, index));
          updateControls();
        })
      : null;
    dockingPoseControlsDisposer = () => {
      syncDisposer?.();
      dragDisposer?.();
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
    const showTrajectoryControls = activeConfig?.trajectoryControls === true ||
      activeConfig?.sdfPosePager === true ||
      Boolean(activeConfig?.docking && sdfGridPathForConfig(activeConfig));
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
      viewportShowAnimation: showTrajectoryControls,
      viewportShowTrajectoryControls: showTrajectoryControls,
      viewportShowSettings: true,
      collapseLeftPanel: true,
      collapseRightPanel: true,
      pdbProvider: 'rcsb',
      emdbProvider: 'rcsb',
      preferWebgl1: true,
      disableAntialiasing: true,
      viewportBackgroundColor: transparentBackground ? undefined : canvasBackgroundCSS(),
      powerPreference: isQuickLookHost() ? 'default' : 'high-performance'
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

  function ensureMolstarStylesheet() {
    if (document.querySelector('link[href*="molstar.css"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = runtimeURL('BurreteMolstarCSSURL', './molstar.css');
    document.head.appendChild(link);
  }

  function disposeActiveMolstarViewer() {
    const viewer = activeViewer || window.BurreteViewer || window.BuretteViewer;
    try { viewer?.plugin?.dispose?.(); } catch (_) {}
    activeViewer = null;
    window.BurreteViewer = null;
    window.BuretteViewer = null;
  }

  async function startMolstar(config, cb) {
    disposeActiveMolstarViewer();
    ensureMolstarStylesheet();
    const container = document.getElementById('app');
    if (container) container.innerHTML = '';
    const size = describeBytes(config.byteCount);
    const formatLabel = describeFormat(config.format, config.binary);

    if (!window.molstar) {
      setStatus(`[web] Loading Mol* engine…
${config.label || 'structure'} (${formatLabel}${size ? `, ${size}` : ''})`);
      await loadScript(appendCacheBuster(runtimeURL('BurreteMolstarURL', './molstar.js'), cb), 'Mol* engine', 120000);
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
    installLeftPanelVisibilityGuard();
    scheduleLayoutStateReapply(viewer);

    await waitForAnimationFrame();
    applyLayoutState(viewer);
    try { viewer.handleResize(); } catch (_) {}

    debug('before structureDataForMolstar: bytes=' + (window.BurreteDataBytes ? window.BurreteDataBytes.length : -1) + '; base64 chars=' + (window.BurreteDataBase64 ? window.BurreteDataBase64.length : -1));
    const prepared = structureDataForMolstar(config);
    debug('prepared format=' + prepared.format + '; data type=' + (prepared.data && prepared.data.constructor ? prepared.data.constructor.name : typeof prepared.data) + '; data length=' + (prepared.data ? prepared.data.length : -1));
    setStatus(`[web] Parsing structure…\n${prepared.label} (${describeFormat(prepared.format, config.binary)})`);

    await withTimeout(
      loadPreparedStructure(viewer, prepared),
      45000,
      `Mol* timed out while parsing/rendering ${prepared.label} as ${prepared.format}.`
    );
    applyLayoutState(viewer);
    scheduleLayoutStateReapply(viewer);

    try {
      window.BurreteAgent?.notifyStructureLoaded?.({ viewer, plugin: viewer.plugin, config, prepared });
    } catch (error) {
      debug('BurreteAgent notifyStructureLoaded failed: ' + (error && error.message || String(error)));
    }
    trackMolstarOrientation(viewer, config);

    window.addEventListener('resize', () => scheduleViewerResize(viewer, 100));
    await waitForAnimationFrame();
    applyLayoutState(viewer);
    try { viewer.handleResize(); } catch (_) {}

    setStatus(`[web] Rendered ${config.label || 'structure'}`);
    setTimeout(hideStatus, isQuickLookHost() ? 0 : 700);
  }

  async function start() {
    debug('viewer.js executed');
    setStatus('[web] Booting Burrete viewer JavaScript…');

    const cb = window.BurreteCacheBuster || String(Date.now());
    await loadRuntimeInputs(cb);

    const config = requireConfig();
    activeConfig = config;
    if (!(window.BurreteDataBytes instanceof Uint8Array) && !window.BurreteDataBase64) {
      if (!config.dataPath && !window.BurreteDataURL) {
        await loadScript(appendCacheBuster(runtimeURL('BurretePreviewDataScriptURL', './preview-data.js'), cb), 'structure data', 30000);
      }
      await loadStructureData(config, cb);
    }
    applyConfigOptions(config);
    disposeExternalArtifactInteractions();
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
      await loadScript(appendCacheBuster(runtimeURL('BurreteMolstarURL', './molstar.js'), cb), 'Mol* engine', 120000);
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
    installLeftPanelVisibilityGuard();
    scheduleLayoutStateReapply(viewer);

    await waitForAnimationFrame();
    applyLayoutState(viewer);
    try { viewer.handleResize(); } catch (_) {}

    debug('before structureDataForMolstar: bytes=' + (window.BurreteDataBytes ? window.BurreteDataBytes.length : -1) + '; base64 chars=' + (window.BurreteDataBase64 ? window.BurreteDataBase64.length : -1));
    const prepared = structureDataForMolstar(config);
    debug('prepared format=' + prepared.format + '; data type=' + (prepared.data && prepared.data.constructor ? prepared.data.constructor.name : typeof prepared.data) + '; data length=' + (prepared.data ? prepared.data.length : -1));
    setStatus(`[web] Parsing structure…\n${prepared.label} (${describeFormat(prepared.format, config.binary)})`);

    await withTimeout(
      loadPreparedStructure(viewer, prepared),
      45000,
      `Mol* timed out while parsing/rendering ${prepared.label} as ${prepared.format}.`
    );
    applyLayoutState(viewer);
    scheduleLayoutStateReapply(viewer);

    try {
      window.BurreteAgent?.notifyStructureLoaded?.({ viewer, plugin: viewer.plugin, config, prepared });
    } catch (error) {
      debug('BurreteAgent notifyStructureLoaded failed: ' + (error && error.message || String(error)));
    }
    trackMolstarOrientation(viewer, config);

    window.addEventListener('resize', () => scheduleViewerResize(viewer, 100));
    await waitForAnimationFrame();
    applyLayoutState(viewer);
    try { viewer.handleResize(); } catch (_) {}

    setStatus(`[web] Rendered ${config.label || 'structure'}`);
    setTimeout(hideStatus, isQuickLookHost() ? 0 : 700);
  }

  function waitForFirstPaint() {
    return new Promise(resolve => {
      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };
      if (isQuickLookHost()) {
        setTimeout(finish, 35);
        requestAnimationFrame(finish);
        return;
      }
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
