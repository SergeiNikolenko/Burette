(() => {
  'use strict';

  const status = document.getElementById('status');
  const MAX_SDF_GRID_MOLECULES = 64;
  const MAX_SDF_GRID_ATOMS = 900;
  const MAX_SDF_GRID_BONDS = 900;
  const SDF_GRID_PADDING = 4.0;
  const TOOLBAR_POSITION_VERSION = '13';
  const TOOLBAR_COLLAPSED_VERSION = '5';
  const DOCKING_POSE_POSITION_VERSION = '4';
  const TOOLBAR_MARGIN = 12;
  const FLOATING_LAYOUT_GAP = 12;
  const PANEL_CLOSE_HIT_WIDTH = 38;
  const MOLSTAR_CONTEXT_MENU_DRAG_THRESHOLD_PX = 4;
  const MOLSTAR_TOUCH_CONTEXT_MENU_DELAY_MS = 520;
  const MOLSTAR_TOUCH_CONTEXT_MENU_MOVE_THRESHOLD_PX = 12;
  const MOLSTAR_TOUCH_PICK_RADIUS_PX = 18;
  const MOLSTAR_TOUCH_PICK_STEP_PX = 6;
  const MOLSTAR_LASSO_MIN_POINTS = 4;
  const MOLSTAR_LASSO_MIN_DISTANCE_PX = 3;
  const MOLSTAR_LASSO_SAMPLE_STEP_PX = 8;
  const MOLSTAR_LASSO_SAMPLE_LIMIT = 4500;
  const MOLSTAR_PREVIEW_RDKIT_SVG_SIZE = 260;
  const MOLSTAR_STANDALONE_PREVIEW_MAX_ATOMS = 300;
  const MOLSTAR_EDIT_HISTORY_LIMIT = 20;
  const VIEWER_THEME_STORAGE_KEY = 'buret.viewer.theme';
  const SDF_POSE_MODE_STORAGE_KEY = 'buret.sdf.poseMode';
  const SDF_CONTEXT_STYLE_STORAGE_KEY = 'buret.sdf.contextStyle';
  const SDF_CONTEXT_OPACITY_STORAGE_KEY = 'buret.sdf.contextOpacity';
  const SDF_CONTEXT_COLOR_STORAGE_KEY = 'buret.sdf.contextColor';
  const XYZ_FRAME_MODE_STORAGE_KEY = 'buret.xyz.frameMode';
  const XYZ_FRAME_OVERLAY_BACKGROUND_LIMIT = 80;
  const MAX_STRUCTURE_OVERLAY_FRAME_COUNT = 50;
  const XYZ_FRAME_BACKGROUND_MIN_ALPHA = 0.0001;
  const DEFAULT_MOLSTAR_STYLE = 'illustrative';
  const MOLSTAR_STYLE_OPTIONS = [
    { value: 'default', label: 'Default' },
    { value: 'illustrative', label: 'Illustrative' },
    { value: 'polymer-ligand', label: 'Polymer+Ligand' },
    { value: 'cartoon', label: 'Cartoon' },
    { value: 'ball-and-stick', label: 'Ball+Stick' },
    { value: 'spacefill', label: 'Spacefill' },
    { value: 'line', label: 'Line' },
    { value: 'molecular-surface', label: 'Surface' }
  ];
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
    { value: 'vdw', label: 'vdW' },
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
    vdwAtoms: null,
    vdwOpacity: null,
    vdwScale: null,
    hullMode: null,
    hullAtoms: null,
    hullOpacity: null,
    poreOpacity: null,
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
  const DOCKING_COORDINATE_TRAJECTORY_FORMATS = new Set(['xtc', 'trr', 'dcd', 'nctraj', 'nc', 'ncdf', 'netcdf', 'ncrst', 'lammpstrj']);
  const DOCKING_MODEL_TRAJECTORY_FORMATS = new Set(['pdb', 'pdbqt', 'mmcif', 'gro']);
  const DOCKING_TOPOLOGY_TRAJECTORY_FORMATS = new Set(['top', 'psf', 'prmtop', 'tpr']);
  const STRUCTURE_DRAG_MIME = 'application/x-burrete-structure-paths';
  const MOLSTAR_VIEWPORT_PANEL_OPEN_CLASS = 'buret-molstar-viewport-panel-open';
  let xyzrenderControlsApplyTimer = 0;
  let xyzrenderInlineRequestSerial = 0;
  let xyzrenderSheetRequestSerial = 0;
  const xyzrenderSheetRequests = new Map();
  const xyzrenderSheetItemEntries = new WeakMap();
  let molstarWindowResizeHandler = null;
  let molstarContainerResizeCleanup = null;
  let molstarContextMenuCleanup = null;
  let molstarSelectionPreviewCleanup = null;
  let molstarContextMenuPick = null;
  let molstarContextMenuMode = 'molecule';
  let molstarLassoEnabled = false;
  let molstarLassoStroke = null;
  let molstarLassoOverlay = null;
  const molstarLassoSelectionAtoms = new Map();
  const molstarLassoSelectionAtomKeys = new Set();
  const molstarLassoSelectionResidueKeys = new Set();
  let xyzrenderLassoEnabled = false;
  let xyzrenderLassoStroke = null;
  let xyzrenderLassoOverlay = null;
  const xyzrenderSelectedElements = new Set();
  const xyzrenderStyledElements = new Set();
  const xyzrenderSelectionOriginals = new WeakMap();
  const xyzrenderSelectionFilterIds = new WeakMap();
  const xyzrenderSelectionHaloClones = new WeakMap();
  let xyzrenderSelectionFilterSerial = 0;
  const xyzrenderActionUndoStack = [];
  const xyzrenderActionRedoStack = [];
  const XYZRENDER_HISTORY_STATE_KEY = '__buretteXyzrenderHistoryIndex';
  let xyzrenderSystemHistoryIndex = 0;
  let xyzrenderSystemHistoryInstalled = false;
  let molstarSelectionPreserveClick = null;
  let molstarLassoSuppressClickUntil = 0;
  let molstarMoleculePreview = null;
  let molstarMoleculePreviewFrame = 0;
  let molstarMoleculePreviewDrag = null;
  let molstarMoleculePreviewTarget = null;
  let molstarMoleculePreviewSuppressClickUntil = 0;
  let molstarSelectionHostSignature = '';
  let molstarPreviewRdkit = null;
  let molstarPreviewRdkitPromise = null;
  const molstarPreviewSvgCache = new Map();
  const molstarEditUndoStack = [];
  let activeDockingPrepared = null;
  let burreteAgentActionPollTimer = 0;
  let burreteAgentActionPollBusy = false;
  let molstarViewportPanelObserver = null;
  let generate3dPending = false;
  let generate3dPendingMode = 'single';
  let molstarStructureFocusSerial = 0;
  try { window.__mqlDebug && window.__mqlDebug('[viewer.js] top-level IIFE entered; readyState=' + document.readyState); } catch (_) {}

  function post(type, message, payload = {}) {
    try {
      if (window.__mqlPost) window.__mqlPost(type, message || '', payload || {});
      else postHostMessage({ type, message: message || '', ...(payload || {}) });
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
      const hasWebkitBridge = !!window.webkit?.messageHandlers?.burrete;
      window.webkit?.messageHandlers?.burrete?.postMessage(body);
      if (hasWebkitBridge) return true;
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ source: 'burrete-viewer', body }, '*');
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  function isEditableShortcutTarget(target) {
    const tagName = target?.tagName?.toLowerCase();
    return target?.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
  }

  function initShellShortcutBridge() {
    document.addEventListener('keydown', event => {
      if (event.defaultPrevented || isEditableShortcutTarget(event.target)) return;
      const key = event.key?.toLowerCase();
      const commandKey = event.metaKey || event.ctrlKey;
      const togglesSidebar = commandKey && !event.altKey && !event.shiftKey && key === 'b';
      const opensCommandPalette = (commandKey && event.shiftKey && key === 'p') || (!commandKey && !event.altKey && key === '/');
      if (!opensCommandPalette && !togglesSidebar) return;
      event.preventDefault();
      postHostMessage({ type: togglesSidebar ? 'toggleSidebar' : 'openCommandPalette' });
    }, true);
  }

  initShellShortcutBridge();

  let molstarControlTooltip = null;
  let molstarControlTooltipTarget = null;

  function installMolstarControlTooltips() {
    if (window.__buretteMolstarControlTooltipsInstalled) return;
    window.__buretteMolstarControlTooltipsInstalled = true;
    document.addEventListener('pointerover', event => {
      const control = molstarTooltipControlFromEvent(event);
      if (control) showMolstarControlTooltip(control);
    }, true);
    document.addEventListener('pointerout', event => {
      if (!molstarControlTooltipTarget) return;
      if (event.relatedTarget && molstarControlTooltipTarget.contains(event.relatedTarget)) return;
      hideMolstarControlTooltip();
    }, true);
    document.addEventListener('focusin', event => {
      const control = molstarTooltipControlFromEvent(event);
      if (control) showMolstarControlTooltip(control);
    }, true);
    document.addEventListener('focusout', hideMolstarControlTooltip, true);
    window.addEventListener('resize', () => {
      if (molstarControlTooltipTarget) positionMolstarControlTooltip(molstarControlTooltipTarget);
    });
    window.addEventListener('scroll', hideMolstarControlTooltip, true);
  }

  function molstarTooltipControlFromEvent(event) {
    const target = event.target;
    if (!target?.closest) return null;
    const control = target.closest(
      '.msp-plugin button[aria-label], .msp-plugin button[title], ' +
      '.msp-plugin [role="button"][aria-label], .msp-plugin [role="button"][title], ' +
      '.msp-plugin select[aria-label], .msp-plugin select[title], ' +
      '.msp-plugin input[aria-label], .msp-plugin input[title]'
    );
    if (!control || control.closest('#buret-toolbar, .buret-preview-dock, .buret-generate-3d-control')) return null;
    if (control.closest('.msp-hover-box-wrapper')) return null;
    return control;
  }

  function molstarTooltipLabel(control) {
    const label = (control.getAttribute('aria-label') || control.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
    if (!label || label.length > 96) return '';
    return label;
  }

  function ensureMolstarControlTooltip() {
    if (molstarControlTooltip) return molstarControlTooltip;
    molstarControlTooltip = document.createElement('div');
    molstarControlTooltip.className = 'buret-molstar-tooltip';
    molstarControlTooltip.setAttribute('role', 'tooltip');
    molstarControlTooltip.setAttribute('aria-hidden', 'true');
    document.body.appendChild(molstarControlTooltip);
    return molstarControlTooltip;
  }

  function showMolstarControlTooltip(control) {
    const label = molstarTooltipLabel(control);
    if (!label) {
      hideMolstarControlTooltip();
      return;
    }
    const tooltip = ensureMolstarControlTooltip();
    molstarControlTooltipTarget = control;
    tooltip.textContent = label;
    tooltip.classList.add('visible');
    tooltip.setAttribute('aria-hidden', 'false');
    positionMolstarControlTooltip(control);
  }

  function positionMolstarControlTooltip(control) {
    if (!molstarControlTooltip || !control?.getBoundingClientRect) return;
    const margin = 12;
    const rect = control.getBoundingClientRect();
    molstarControlTooltip.style.maxWidth = Math.max(120, Math.min(280, window.innerWidth - margin * 2)) + 'px';
    const tooltipRect = molstarControlTooltip.getBoundingClientRect();
    const width = tooltipRect.width || 160;
    const height = tooltipRect.height || 30;
    const center = rect.left + rect.width / 2;
    const left = Math.min(window.innerWidth - margin - width, Math.max(margin, center - width / 2));
    let top = rect.bottom + 8;
    if (top + height > window.innerHeight - margin) top = rect.top - height - 8;
    if (top < margin) top = margin;
    molstarControlTooltip.style.left = Math.round(left) + 'px';
    molstarControlTooltip.style.top = Math.round(top) + 'px';
  }

  function hideMolstarControlTooltip() {
    molstarControlTooltipTarget = null;
    if (!molstarControlTooltip) return;
    molstarControlTooltip.classList.remove('visible');
    molstarControlTooltip.setAttribute('aria-hidden', 'true');
  }

  installMolstarControlTooltips();

  function installDownloadExportBridge() {
    if (window.__buretteDownloadExportBridgeInstalled) return;
    window.__buretteDownloadExportBridgeInstalled = true;
    document.addEventListener('click', event => {
      const anchor = event.target?.closest?.('a[download]');
      if (!anchor) return;
      const href = String(anchor.href || '');
      if (!href.startsWith('blob:')) return;
      const name = safeDownloadFileName(anchor.getAttribute('download') || 'molstar-export');
      if (!canUseDownloadExportBridge()) return;
      event.preventDefault();
      event.stopPropagation();
      void exportDownloadBlob(href, name).catch(error => {
        setStatus(`[web] Export failed.\n\n${error?.message || String(error)}`, 'error');
      });
    }, true);
  }

  function canUseDownloadExportBridge() {
    return !!window.webkit?.messageHandlers?.burrete || (window.parent && window.parent !== window);
  }

  async function exportDownloadBlob(href, name) {
    const response = await fetch(href);
    if (!response.ok) throw new Error(`Could not read export blob: HTTP ${response.status}`);
    const blob = await response.blob();
    const mimeType = blob.type || response.headers.get('content-type') || 'application/octet-stream';
    let posted = false;
    if (shouldExportBlobAsText(name, mimeType)) {
      posted = postHostMessage({
        type: 'exportText',
        name,
        mimeType,
        text: await blob.text()
      });
    } else {
      posted = postHostMessage({
        type: 'exportData',
        name,
        mimeType,
        base64: bytesToBase64(new Uint8Array(await blob.arrayBuffer()))
      });
    }
    if (!posted) throw new Error('The export host bridge is unavailable.');
    setStatus(`[web] Export requested: ${name}`);
  }

  function shouldExportBlobAsText(name, mimeType) {
    const filename = String(name || '').toLowerCase();
    const type = String(mimeType || '').toLowerCase();
    return type.startsWith('text/') ||
      type.includes('json') ||
      type.includes('xml') ||
      type.includes('cif') ||
      type.includes('chemical/') ||
      /\.(cif|bcif|mcif|mmcif|pdb|pqr|sdf|sd|mol|mol2|xyz|gro|csv|tsv|txt|json|xml)$/u.test(filename);
  }

  function safeDownloadFileName(value) {
    return String(value || 'molstar-export')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/^\.+/g, '')
      .trim()
      .slice(0, 120) || 'molstar-export';
  }

  function safeExportBaseName(value, fallback = 'structure') {
    return String(value || fallback)
      .replace(/\.[A-Za-z0-9]{1,8}$/u, '')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/^\.+/g, '')
      .trim()
      .slice(0, 80) || fallback;
  }

  function setStatus(message, kind = 'info') {
    const text = String(message || '');
    if (status) {
      setStatusText(text);
      status.classList.toggle('error', kind === 'error');
      status.classList.toggle('hidden', kind !== 'error' && !window.BurreteDebug);
    }
    if (shouldReportStatus(text, kind)) {
      post(kind === 'error' ? 'error' : 'status', text);
    }
  }

  function setStatusText(text) {
    if (!status) return;
    let message = status.querySelector('[data-buret-status-message]');
    let dismiss = status.querySelector('[data-buret-status-dismiss]');
    if (!message) {
      message = document.createElement('span');
      message.setAttribute('data-buret-status-message', '');
    }
    if (!dismiss) {
      dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.setAttribute('data-buret-status-dismiss', '');
      dismiss.setAttribute('aria-label', 'Dismiss status message');
      dismiss.textContent = 'Dismiss';
      dismiss.addEventListener('click', event => {
        event.preventDefault();
        status.classList.add('hidden');
      });
    }
    message.textContent = text;
    status.replaceChildren(message, dismiss);
  }

  function shouldReportStatus(text, kind) {
    if (kind === 'error' || window.BurreteDebug) return true;
    return text.startsWith('[web] Loading Mol* engine') ||
      text.startsWith('[web] Mol* engine loaded') ||
      text.startsWith('[web] Loading xyzrender artifact') ||
      text.startsWith('[web] WebGL viewer created') ||
      text.startsWith('[web] Parsing structure') ||
      text.startsWith('[web] Rendered ');
  }

  function debug(message) {
    if (!window.BurreteDebug) return;
    post('debug', message);
  }

  async function reportBurreteAgentState() {
    const control = window.BurreteAgentControl;
    const reportUrl = typeof control?.reportUrl === 'string' ? control.reportUrl : '';
    if (!reportUrl || !window.BurreteAgent?.run) return;
    try {
      const capabilities = await window.BurreteAgent.run({ command: 'capabilities' });
      let summary = null;
      const warnings = [];
      if (capabilities?.ok && capabilities.result?.ready) {
        summary = await window.BurreteAgent.run({ command: 'summary', args: { includeLigands: true } });
      } else {
        warnings.push('BurreteAgent was present but did not report ready=true.');
      }
      await fetch(reportUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiVersion: control.apiVersion || 'burette-agent-control/v1',
          reportedAt: new Date().toISOString(),
          capabilities,
          summary,
          warnings
        })
      });
    } catch (error) {
      debug('BurreteAgent live report failed: ' + (error && error.message || String(error)));
    }
  }

  function startBurreteAgentActionPolling() {
    const control = window.BurreteAgentControl;
    const nextActionUrl = typeof control?.nextActionUrl === 'string' ? control.nextActionUrl : '';
    const actionResultUrl = typeof control?.actionResultUrl === 'string' ? control.actionResultUrl : '';
    if (!nextActionUrl || !actionResultUrl || !window.BurreteAgent?.run || burreteAgentActionPollTimer) return;
    const intervalMs = Math.max(250, Math.min(5000, Number(control.actionPollIntervalMs) || 500));
    burreteAgentActionPollTimer = window.setInterval(() => {
      void pollBurreteAgentAction(nextActionUrl, actionResultUrl);
    }, intervalMs);
    void pollBurreteAgentAction(nextActionUrl, actionResultUrl);
  }

  async function pollBurreteAgentAction(nextActionUrl, actionResultUrl) {
    if (burreteAgentActionPollBusy) return;
    burreteAgentActionPollBusy = true;
    try {
      const response = await fetch(nextActionUrl, { credentials: 'same-origin' });
      if (response.status === 204) return;
      if (!response.ok) throw new Error(`next-action HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload?.id || !payload.action) return;
      let result;
      try {
        result = await executeBurreteAgentAction(payload.action);
      } catch (error) {
        const actionType = String(payload.action?.type || 'unknown');
        result = agentActionFailure(actionType, 'ACTION_ERROR', error && error.message || String(error));
      }
      await fetch(actionResultUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: payload.id, result })
      });
      void reportBurreteAgentState();
    } catch (error) {
      debug('BurreteAgent action poll failed: ' + (error && error.message || String(error)));
    } finally {
      burreteAgentActionPollBusy = false;
    }
  }

  async function executeBurreteAgentAction(action) {
    const type = String(action?.type || '');
    if (type === 'get_xtb_context') {
      const target = molstarSelectedMoleculeTargetFromSelection();
      return {
        ok: true,
        command: 'get_xtb_context',
        result: {
          label: target?.label || null,
          scope: target?.scope || null,
          contextDocument: molstarContextDocumentPayload(target) || null
        }
      };
    }
    if (!window.BurreteAgent?.run) {
      return agentActionFailure(type, 'NO_VIEWER', 'BurreteAgent is not available in this viewer runtime.');
    }
    if (type === 'focus_ligand') {
      const previewTarget = molstarMoleculePreviewTargetForAction(action);
      const result = await window.BurreteAgent.run({
        command: 'focusLigand',
        args: {
          selector: action.selector || action,
          allowAmbiguous: action.allowAmbiguous === true,
          index: Number.isInteger(action.index) ? action.index : undefined,
          showNeighborhood: !!action.showNeighborhood,
          radiusA: action.radiusA,
          durationMs: action.durationMs,
          extraRadius: action.extraRadius ?? action.radiusA
        }
      });
      if (result?.ok !== false) scheduleMolstarSelectedMoleculePreview(previewTarget);
      return result;
    }
    if (type === 'show_ligands') {
      return window.BurreteAgent.run({ command: 'showLigands', args: action.args || {} });
    }
    if (type === 'hide_components') {
      return window.BurreteSceneActions?.hideComponents?.(action) || agentActionFailure(type, 'NOT_IMPLEMENTED', 'BurreteSceneActions.hideComponents is unavailable.');
    }
    if (type === 'show_components') {
      return window.BurreteSceneActions?.showComponents?.(action) || agentActionFailure(type, 'NOT_IMPLEMENTED', 'BurreteSceneActions.showComponents is unavailable.');
    }
    if (type === 'select_residues') {
      const previewTarget = molstarMoleculePreviewTargetForAction(action);
      const result = await window.BurreteAgent.run({
        command: 'selectResidues',
        args: {
          ...(action.args || {}),
          selector: action.selector || action.args?.selector || action,
          mode: action.mode || action.args?.mode,
          granularity: action.granularity || action.args?.granularity,
          label: action.label || action.args?.label
        }
      });
      if (result?.ok !== false) scheduleMolstarSelectedMoleculePreview(previewTarget);
      return result;
    }
    if (type === 'clear_selection') {
      clearMolstarPersistentMoleculePreview();
      return clearMolstarSelection();
    }
    if (type === 'set_sdf_molecule') {
      return setSdfCollectionMoleculeFromAction(action);
    }
    if (type === 'set_structure_pose') {
      return setStructurePoseFromAction(action);
    }
    if (type === 'apply_trajectory_smoothing') {
      return applyTrajectorySmoothingFromAction(action);
    }
    if (type === 'apply_external_trajectory_smoothing') {
      return applyExternalTrajectorySmoothingFromAction(action);
    }
    if (type === 'set_trajectory_smoothing_view') {
      return setTrajectorySmoothingViewFromAction(action);
    }
    if (type === 'set_molstar_style') {
      return setMolstarStyleFromAction(action);
    }
    if (type === 'set_sdf_context_style') {
      return setSdfCollectionContextStyleFromAction(action);
    }
    if (type === 'set_sdf_context_opacity') {
      return setSdfCollectionContextOpacityFromAction(action);
    }
    if (type === 'set_sdf_context_color') {
      return setSdfCollectionContextColorFromAction(action);
    }
    if (type === 'set_sdf_pose_mode') {
      return setSdfPoseModeFromAction(action);
    }
    if (type === 'set_sdf_pose_index') {
      return setSdfPoseIndexFromAction(action);
    }
    if (type === 'focus_selection') {
      return window.BurreteAgent.run({
        command: 'focusSelection',
        args: {
          ...(action.args || {}),
          selector: action.selector || action.args?.selector || 'last'
        }
      });
    }
    if (type === 'label_selection') {
      return window.BurreteAgent.run({
        command: 'labelSelection',
        args: {
          selection: action.selection,
          selector: action.selector,
          text: action.text || action.label,
          label: action.label,
          mode: action.mode,
          granularity: action.granularity,
          textSize: action.textSize,
          background: action.background,
          backgroundOpacity: action.backgroundOpacity,
          backgroundMargin: action.backgroundMargin,
          tether: action.tether,
          tetherLength: action.tetherLength,
          borderWidth: action.borderWidth,
          offsetY: action.offsetY,
          labelParams: action.labelParams
        }
      });
    }
    if (type === 'contacts') {
      return window.BurreteAgent.run({ command: 'contacts', args: action.args || action });
    }
    if (type === 'reset_camera') {
      return window.BurreteAgent.run({ command: 'resetCamera', args: action.args || {} });
    }
    if (type === 'hide_waters') {
      return window.BurreteSceneActions?.hideWaters?.() || agentActionFailure(type, 'NOT_IMPLEMENTED', 'BurreteSceneActions.hideWaters is unavailable.');
    }
    if (type === 'show_waters') {
      return window.BurreteSceneActions?.showWaters?.() || agentActionFailure(type, 'NOT_IMPLEMENTED', 'BurreteSceneActions.showWaters is unavailable.');
    }
    if (type === 'show_surface') {
      return window.BurreteSceneActions?.showSurface?.(action) || agentActionFailure(type, 'NOT_IMPLEMENTED', 'BurreteSceneActions.showSurface is unavailable.');
    }
    if (type === 'color_by_chain') {
      return window.BurreteSceneActions?.colorByChain?.(action) || agentActionFailure(type, 'NOT_IMPLEMENTED', 'BurreteSceneActions.colorByChain is unavailable.');
    }
    if (type === 'render_panel') {
      return renderBurreteAgentPanel(action);
    }
    if (type === 'apply_scene') {
      return executeBurreteSceneSpec(action);
    }
    if (type === 'load_mvs') {
      return window.BurreteAgent.run({
        command: 'loadMVS',
        args: {
          data: action.data,
          json: action.json,
          dataBase64: action.dataBase64,
          format: action.format,
          options: action.options || {}
        }
      });
    }
    if (type === 'screenshot' || type === 'export_image') {
      return window.BurreteAgent.run({ command: 'screenshot', args: action.args || {} });
    }
    if (type === 'raw_burrete_agent') {
      if (!action.command) return agentActionFailure(type, 'INVALID_ARGS', 'raw_burrete_agent requires command.');
      return window.BurreteAgent.run({ command: action.command, args: action.args || {} });
    }
    return agentActionFailure(type, 'NOT_IMPLEMENTED', `Unsupported BurreteAgent action: ${type}`);
  }

  function burreteSceneSpecOperations(action) {
    const raw = Array.isArray(action?.operations) ? action.operations : action?.components;
    return Array.isArray(raw) ? raw : [];
  }

  function burreteSceneSpecTarget(operation) {
    if (operation?.selector != null) return operation.selector;
    if (operation?.target != null) return operation.target;
    if (operation?.component != null) return operation.component;
    return null;
  }

  function burreteSceneSpecLabel(operation, index) {
    return operation?.label || operation?.name || operation?.id || `scene-component-${index + 1}`;
  }

  async function executeBurreteSceneSpec(action) {
    const operations = burreteSceneSpecOperations(action);
    if (!operations.length) return agentActionFailure('apply_scene', 'INVALID_ARGS', 'apply_scene requires components or operations.');

    const results = [];
    for (let index = 0; index < operations.length; index++) {
      const operation = operations[index] || {};
      const target = burreteSceneSpecTarget(operation);
      if (target == null) {
        results.push(agentActionFailure('apply_scene', 'INVALID_ARGS', `Scene operation ${index + 1} requires selector or target.`));
        continue;
      }
      const label = burreteSceneSpecLabel(operation, index);
      const kind = String(operation.kind || operation.action || '').toLowerCase();
      const wantsSelect = operation.select === true || kind === 'select' || kind === 'selection';
      const wantsFocus = operation.focus === true || kind === 'focus';
      const wantsHighlight = operation.highlight === true || operation.color != null || operation.representation != null || kind === 'highlight' || kind === 'color';

      if (wantsHighlight || (!wantsSelect && !wantsFocus)) {
        results.push(await window.BurreteAgent.run({
          command: 'colorSelection',
          args: {
            selector: target,
            label,
            color: operation.color || operation.hex,
            highlight: operation.highlight !== false,
            mode: operation.mode || 'add',
            granularity: operation.granularity || 'residue'
          }
        }));
      }
      if (wantsSelect) {
        results.push(await window.BurreteAgent.run({
          command: 'selectResidues',
          args: {
            selector: target,
            label,
            mode: operation.mode || 'add',
            granularity: operation.granularity || 'residue'
          }
        }));
      }
      if (wantsFocus) {
        results.push(await window.BurreteAgent.run({
          command: 'focusSelection',
          args: {
            selector: target,
            durationMs: operation.durationMs,
            extraRadius: operation.extraRadius
          }
        }));
      }
    }

    return {
      ok: results.every(result => result?.ok !== false),
      action: 'apply_scene',
      operationCount: operations.length,
      results
    };
  }

  window.addEventListener('message', event => {
    const body = event.data && event.data.source === 'burrete-agent-host' ? event.data.body : null;
    if (!body || body.type !== 'agent-action' || !body.id) return;
    void (async () => {
      let result;
      try {
        result = await executeBurreteAgentAction(body.action);
      } catch (error) {
        const actionType = String(body.action?.type || 'unknown');
        result = agentActionFailure(actionType, 'ACTION_ERROR', error && error.message || String(error));
      }
      event.source?.postMessage({
        source: 'burrete-agent-viewer',
        body: {
          type: 'agent-action-result',
          id: body.id,
          result
        }
      }, '*');
    })();
  });

  window.BurreteViewerActions = { run: executeBurreteAgentAction };

  let hostedMcpActionsApplied = false;
  function hostedMcpSelectionFromResults(actions, results) {
    let selection = null;
    for (let index = 0; index < actions.length; index++) {
      const action = actions[index];
      const result = results[index];
      if (action?.type === 'clear_selection' && result?.ok !== false) selection = null;
      if (action?.type !== 'select_residues' || result?.ok === false) continue;
      const details = result?.result || {};
      const residues = Array.isArray(details.residuesPreview)
        ? details.residuesPreview.slice(0, 96).map(residue => ({
          chain: String(residue.auth_asym_id || residue.label_asym_id || ''),
          sequence: residue.auth_seq_id ?? residue.label_seq_id ?? null,
          compId: String(residue.auth_comp_id || residue.label_comp_id || '')
        }))
        : [];
      selection = {
        source: 'agent',
        label: String(action.label || `Agent selection: ${Number(details.counts?.atoms) || 0} atoms across ${residues.length} residues`),
        atoms: Math.max(0, Number(details.counts?.atoms) || 0),
        residues,
        atomIdentities: []
      };
    }
    return selection;
  }

  async function applyHostedMcpActions() {
    if (hostedMcpActionsApplied) return;
    const requestedActions = Array.isArray(window.BurreteConfig?.hostedMcpActions)
      ? window.BurreteConfig.hostedMcpActions.slice(0, 8)
      : [];
    if (!requestedActions.length) return;
    hostedMcpActionsApplied = true;
    try {
      await window.BurreteHostedAppBridge?.ready;
      const actions = window.BurreteHostedAppBridge?.sanitizeViewerActions?.(requestedActions) || [];
      if (actions.length !== requestedActions.length) {
        throw new Error('Hosted scene contained an action outside the public Burrete allowlist.');
      }
      await window.BurreteAgent?.ready;
      const results = [];
      for (const action of actions) results.push(await executeBurreteAgentAction(action));
      window.__mqlPost?.('sceneActionsApplied', '', {
        report: {
          revision: Date.now(),
          documentId: String(window.BurreteConfig?.documentId || 'active-structure'),
          selection: hostedMcpSelectionFromResults(actions, results),
          results
        }
      });
    } catch (error) {
      window.__mqlPost?.('sceneActionsApplied', '', {
        report: {
          revision: Date.now(),
          results: [agentActionFailure('hosted_scene', 'ACTION_ERROR', error?.message || String(error))]
        }
      });
    }
  }

  window.addEventListener('burette-agent-ready', () => { void applyHostedMcpActions(); }, { once: true });
  void applyHostedMcpActions();

  function agentActionFailure(command, code, message) {
    return {
      ok: false,
      command,
      error: { code, message }
    };
  }

  function renderBurreteAgentPanel(action) {
    const panel = action?.panel || action;
    const kind = String(panel.kind || action?.kind || '').trim();
    const content = String(panel.content || '');
    if (!['markdown', 'table', 'chart'].includes(kind)) {
      return agentActionFailure('render_panel', 'INVALID_ARGS', 'render_panel kind must be markdown, table, or chart.');
    }
    if (!content) {
      return agentActionFailure('render_panel', 'INVALID_ARGS', 'render_panel requires panel content.');
    }
    const root = ensureBurreteAgentPanelRoot();
    const title = String(panel.title || action?.title || `${kind} panel`);
    root.querySelector('[data-burrete-agent-panel-title]').textContent = title;
    root.dataset.kind = kind;
    const body = root.querySelector('[data-burrete-agent-panel-body]');
    body.replaceChildren(renderPanelContent(kind, content));
    root.classList.remove('hidden');
    return {
      ok: true,
      command: 'render_panel',
      result: {
        kind,
        title,
        byteCount: Number(panel.byteCount) || content.length
      }
    };
  }

  function ensureBurreteAgentPanelRoot() {
    let root = document.querySelector('[data-burrete-agent-panel]');
    if (root) return root;
    root = document.createElement('aside');
    root.className = 'buret-agent-panel hidden';
    root.setAttribute('data-burrete-agent-panel', '');
    root.setAttribute('aria-label', 'Burrete agent panel');
    root.innerHTML = `
      <header class="buret-agent-panel-header">
        <strong data-burrete-agent-panel-title>Panel</strong>
        <button type="button" data-burrete-agent-panel-close aria-label="Close panel">Close</button>
      </header>
      <div class="buret-agent-panel-body" data-burrete-agent-panel-body></div>
    `;
    root.querySelector('[data-burrete-agent-panel-close]').addEventListener('click', () => root.classList.add('hidden'));
    document.body.appendChild(root);
    return root;
  }

  function renderPanelContent(kind, content) {
    if (kind === 'table') return renderAgentTable(content);
    if (kind === 'chart') return renderAgentChart(content);
    const pre = document.createElement('pre');
    pre.className = 'buret-agent-panel-markdown';
    pre.textContent = content;
    return pre;
  }

  function renderAgentTable(content) {
    const rows = parsePanelRows(content);
    if (!rows.length) return renderPanelTextFallback(content);
    const table = document.createElement('table');
    table.className = 'buret-agent-panel-table';
    const headers = Array.from(new Set(rows.flatMap(row => Object.keys(row))));
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (const header of headers) {
      const cell = document.createElement('th');
      cell.textContent = header;
      headerRow.appendChild(cell);
    }
    thead.appendChild(headerRow);
    const tbody = document.createElement('tbody');
    for (const row of rows.slice(0, 200)) {
      const tableRow = document.createElement('tr');
      for (const header of headers) {
        const cell = document.createElement('td');
        cell.textContent = row[header] == null ? '' : String(row[header]);
        tableRow.appendChild(cell);
      }
      tbody.appendChild(tableRow);
    }
    table.append(thead, tbody);
    return table;
  }

  function renderAgentChart(content) {
    const rows = parsePanelRows(content);
    const numericRows = rows.map(row => {
      const entries = Object.entries(row);
      const label = String(entries.find(([, value]) => Number.isNaN(Number(value)))?.[1] || row.label || row.name || '');
      const numeric = entries.find(([, value]) => Number.isFinite(Number(value)));
      return numeric ? { label: label || numeric[0], value: Number(numeric[1]) } : null;
    }).filter(Boolean).slice(0, 24);
    if (!numericRows.length) return renderPanelTextFallback(content);
    const max = Math.max(...numericRows.map(row => Math.abs(row.value)), 1);
    const chart = document.createElement('div');
    chart.className = 'buret-agent-panel-chart';
    for (const row of numericRows) {
      const item = document.createElement('div');
      item.className = 'buret-agent-panel-chart-row';
      const label = document.createElement('span');
      label.textContent = row.label;
      const bar = document.createElement('i');
      bar.style.width = `${Math.max(2, Math.round((Math.abs(row.value) / max) * 100))}%`;
      const value = document.createElement('strong');
      value.textContent = Number.isInteger(row.value) ? String(row.value) : row.value.toFixed(3);
      item.append(label, bar, value);
      chart.appendChild(item);
    }
    return chart;
  }

  function parsePanelRows(content) {
    const trimmed = content.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.filter(row => row && typeof row === 'object');
      if (Array.isArray(parsed.rows)) return parsed.rows.filter(row => row && typeof row === 'object');
    } catch (_) {}
    const lines = trimmed.split(/\r?\n/u).filter(Boolean);
    if (lines.length < 2) return [];
    const delimiter = lines[0].includes('\t') ? '\t' : ',';
    const headers = splitPanelDelimitedLine(lines[0], delimiter);
    return lines.slice(1).map(line => {
      const values = splitPanelDelimitedLine(line, delimiter);
      const row = {};
      headers.forEach((header, index) => { row[header] = values[index] || ''; });
      return row;
    });
  }

  function splitPanelDelimitedLine(line, delimiter) {
    return line.split(delimiter).map(value => value.trim().replace(/^"|"$/g, ''));
  }

  function renderPanelTextFallback(content) {
    const pre = document.createElement('pre');
    pre.className = 'buret-agent-panel-markdown';
    pre.textContent = content;
    return pre;
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
  let viewportCornerLayoutHandle = 0;
  let molstarStructureDirty = false;

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
  let activeMolstarPrepared = null;
  let trajectorySmoothingState = null;
  let pendingTrajectoryPlaybackRestore = null;
  let activeSdfPoseMode = 'single';
  let activeSdfCollectionVisibilityState = null;
  let activeXyzFrameOverlayState = null;
  let activeDockingPoseCollectionState = null;
  let activeMolstarCacheBuster = null;
  let molstarStyleApplySerial = 0;
  let latestXyzrenderOrientationRef = null;
  let orientationTrackingCleanup = null;
  let externalArtifactInteractionsCleanup = null;
  let keyboardShortcutsInstalled = false;
  let themeListenerInstalled = false;
  let floatingPanelTrackingInstalled = false;
  let floatingLayoutFrame = 0;
  let molstarViewportPanelOpen = false;
  let molstarSelectionControlsOpen = false;
  const previewDockState = { right: false, bottom: false };
  let previewDockObserve = null;
  let previewDockObserveError = '';
  let previewDockObserveLoading = false;
  let previewDockObserveTimer = 0;
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
    const normalized = String(value || '').trim().toLowerCase();
    return MOLSTAR_STYLE_OPTIONS.some(option => option.value === normalized) ? normalized : DEFAULT_MOLSTAR_STYLE;
  }

  function configuredMolstarStyle(config) {
    return normalizeMolstarStyle(config && config.molstarStyle);
  }

  function normalizeSdfCollectionContextStyle(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (['line', 'ball-and-stick', 'cartoon', 'spacefill', 'molecular-surface', 'match'].includes(normalized)) return normalized;
    return 'match';
  }

  function sdfCollectionContextStyleStorageKey(config) {
    const documentId = String(config?.documentId || '').trim();
    if (documentId) return `${SDF_CONTEXT_STYLE_STORAGE_KEY}.${documentId}`;
    const fallback = `${config?.label || 'active'}:${window.location.pathname}:${window.location.search}`;
    return `${SDF_CONTEXT_STYLE_STORAGE_KEY}.fallback-${stableTextHash(fallback)}`;
  }

  function sdfCollectionContextOpacityStorageKey(config) {
    const documentId = String(config?.documentId || '').trim();
    if (documentId) return `${SDF_CONTEXT_OPACITY_STORAGE_KEY}.${documentId}`;
    const fallback = `${config?.label || 'active'}:${window.location.pathname}:${window.location.search}`;
    return `${SDF_CONTEXT_OPACITY_STORAGE_KEY}.fallback-${stableTextHash(fallback)}`;
  }

  function sdfCollectionContextColorStorageKey(config) {
    const documentId = String(config?.documentId || '').trim();
    if (documentId) return `${SDF_CONTEXT_COLOR_STORAGE_KEY}.${documentId}`;
    const fallback = `${config?.label || 'active'}:${window.location.pathname}:${window.location.search}`;
    return `${SDF_CONTEXT_COLOR_STORAGE_KEY}.fallback-${stableTextHash(fallback)}`;
  }

  function normalizeSdfCollectionContextOpacity(value) {
    const opacity = Number(value);
    if (!Number.isFinite(opacity)) return 0.4;
    return Math.max(0.04, Math.min(1, opacity));
  }

  function normalizeSdfCollectionContextColor(value) {
    return value === 'gray' ? 'gray' : 'colored';
  }

  function readSdfCollectionContextStyle(config) {
    try {
      return normalizeSdfCollectionContextStyle(window.localStorage?.getItem(sdfCollectionContextStyleStorageKey(config)));
    } catch (_) {
      return 'match';
    }
  }

  function setSdfCollectionContextStyle(style) {
    const value = normalizeSdfCollectionContextStyle(style);
    try {
      window.localStorage?.setItem(sdfCollectionContextStyleStorageKey(activeConfig || window.BurreteConfig || {}), value);
    } catch (_) {}
    return value;
  }

  function readSdfCollectionContextOpacity(config) {
    try {
      return normalizeSdfCollectionContextOpacity(window.localStorage?.getItem(sdfCollectionContextOpacityStorageKey(config)));
    } catch (_) {
      return 0.4;
    }
  }

  function setSdfCollectionContextOpacity(opacity) {
    const value = normalizeSdfCollectionContextOpacity(opacity);
    try {
      window.localStorage?.setItem(sdfCollectionContextOpacityStorageKey(activeConfig || window.BurreteConfig || {}), value.toFixed(2));
    } catch (_) {}
    return value;
  }

  function readSdfCollectionContextColor(config) {
    try {
      return normalizeSdfCollectionContextColor(window.localStorage?.getItem(sdfCollectionContextColorStorageKey(config)));
    } catch (_) {
      return 'colored';
    }
  }

  function readXyzFrameContextColor(config) {
    try {
      const stored = window.localStorage?.getItem(sdfCollectionContextColorStorageKey(config));
      return stored === 'colored' ? 'colored' : 'gray';
    } catch (_) {
      return 'gray';
    }
  }

  function setSdfCollectionContextColor(color) {
    const value = normalizeSdfCollectionContextColor(color);
    try {
      window.localStorage?.setItem(sdfCollectionContextColorStorageKey(activeConfig || window.BurreteConfig || {}), value);
    } catch (_) {}
    return value;
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
    root.style.setProperty('--buret-menu-background', background);
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
    if (background === 'white') return '#ffffff';
    if (background === 'graphite') return '#111111';
    if (background === 'transparent') return 'transparent';
    return '#000000';
  }

  function canvasBackgroundColor() {
    const background = resolvedCanvasBackground();
    if (background === 'white') return 0xffffff;
    if (background === 'graphite') return 0x111111;
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
    const nextTheme = resolveViewerTheme() === 'dark' ? 'light' : 'dark';
    setViewerTheme(nextTheme, viewer);
    return nextTheme;
  }

  function applyStaticRendererTheme() {
    const background = transparentBackground ? 'transparent' : canvasBackgroundCSS();
    const artifactRoot = document.querySelector('.buret-external-artifact-root');
    const artifactRect = document.querySelector('.buret-xyzrender-sheet-item-base .buret-xyzrender-sheet-item-body > svg > rect');
    const artifactBackgroundFill = resolveExternalArtifactBackgroundFill(artifactRect);
    if (artifactRoot) {
      artifactRoot.style.background = background;
    }
    document.querySelectorAll('.buret-xyzrender-sheet-item-background').forEach(layer => {
      layer.style.background = artifactBackgroundFill || '#fff';
    });
    if (artifactRect && artifactRect.getAttribute('width') === '100%' && artifactRect.getAttribute('height') === '100%') {
      artifactRect.setAttribute('fill', 'transparent');
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

  function xyzrenderPopoverDocumentKey(config = {}) {
    const documentId = String(config?.documentId || '').trim();
    if (documentId) return `document:${documentId}`;
    const requestID = String(config?.previewRequestID || config?.requestID || '').trim();
    if (requestID) return `request:${requestID}`;
    const sourcePath = String(config?.path || config?.filePath || config?.sourcePath || config?.label || '').trim();
    return sourcePath ? `source:${sourcePath}` : '';
  }

  function syncXyzrenderPopoverDocument(toolbar, config = {}) {
    if (!toolbar) return false;
    const key = xyzrenderPopoverDocumentKey(config);
    if (!key) return false;
    const previous = toolbar.dataset.xyzrenderPopoverDocumentKey || '';
    toolbar.dataset.xyzrenderPopoverDocumentKey = key;
    if (!previous || previous === key) return false;
    setXyzrenderPopoverVisibility(toolbar, false, { persist: false });
    return true;
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
    const ketcherButton = toolbar.querySelector('[data-buret-action="ketcher"]');
    const generate3dButton = document.querySelector('[data-buret-action="generate-3d-conformer"]');
    const generate3dMenu = document.querySelector('[data-buret-generate-3d-menu]');
    const popover = toolbar.querySelector('[data-buret-xyzrender-popover]');
    const lassoButton = toolbar.querySelector('[data-buret-action="molstar-lasso"]');
    control.classList.toggle('visible', canSwitchRenderer);
    const molstarStyleSlot = toolbar.querySelector('[data-buret-molstar-style-slot]');
    const molstarStyleSelect = toolbar.querySelector('[data-buret-molstar-style]');
    molstarStyleSlot?.classList.toggle('visible', renderer === 'molstar');
    if (molstarStyleSelect) {
      populateMolstarStyleSelect(molstarStyleSelect);
      molstarStyleSelect.value = configuredMolstarStyle(config);
      molstarStyleSelect.disabled = renderer !== 'molstar';
    }
    const lassoAvailable = renderer === 'molstar' || renderer === 'xyzrender-external';
    lassoButton?.classList.toggle('hidden', !lassoAvailable);
    if (lassoButton) {
      lassoButton.disabled = !lassoAvailable;
      lassoButton.setAttribute('aria-hidden', lassoAvailable ? 'false' : 'true');
    }
    updateMolstarLassoButton();
    const presetSlot = toolbar.querySelector('[data-buret-xyzrender-preset-slot]');
    presetSlot?.classList.remove('visible');
    const canOpenSdfGrid = canOpenSdfGridFromConfig(config);
    sdfGridButton?.classList.toggle('hidden', !canOpenSdfGrid);
    if (sdfGridButton && toolbar.dataset.sdfGridBound !== '1') {
      sdfGridButton.addEventListener('click', requestSdfGridDocument);
      toolbar.dataset.sdfGridBound = '1';
    }
    const canOpenKetcher = config.ketcherEditable === true && config.appViewer === true;
    ketcherButton?.classList.toggle('hidden', !canOpenKetcher);
    if (ketcherButton && toolbar.dataset.ketcherBound !== '1') {
      ketcherButton.addEventListener('click', requestOpenInKetcher);
      toolbar.dataset.ketcherBound = '1';
    }
    const canGenerate3d = canGenerate3DConformerFromConfig(config, renderer);
    generate3dButton?.classList.toggle('hidden', !canGenerate3d);
    generate3dMenu?.classList.toggle('hidden', true);
    if (generate3dButton) {
      generate3dButton.disabled = !canGenerate3d || generate3dPending;
      generate3dButton.setAttribute('aria-hidden', canGenerate3d ? 'false' : 'true');
      applyGenerate3DPendingState(generate3dButton);
    }
    if (generate3dButton && generate3dButton.dataset.bound !== '1') {
      generate3dButton.dataset.bound = '1';
      generate3dButton.addEventListener('click', () => showGenerate3DMenu(generate3dButton));
    }
    generate3dMenu?.querySelectorAll('[data-buret-compute-operation]').forEach(operationButton => {
      const operation = String(operationButton.dataset.buretComputeOperation || '');
      operationButton.disabled = operation === 'alignPoses' && !isSdfPoseConformerSet(config);
      if (operationButton.dataset.bound !== '1') {
        operationButton.dataset.bound = '1';
        operationButton.addEventListener('click', () => {
          if (operationButton.disabled) return;
          const selectedOperation = String(operationButton.dataset.buretComputeOperation || 'generate3d');
          const mode = selectedOperation === 'generateEnsemble' ? 'ensemble' : 'single';
          hideGenerate3DMenu();
          requestMolecularCompute(selectedOperation, { mode });
        });
      }
    });
    observeMolstarViewportPanel();
    const popoverDocumentChanged = syncXyzrenderPopoverDocument(toolbar, config);
    const popoverWasOpen = popover?.classList.contains('hidden') === false && !popoverDocumentChanged;
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
        if (popoverWasOpen) {
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
    return ['xyz', 'sdf', 'pdb', 'pdbqt', 'mmcif', 'cifCore'].includes(normalizeFormat(format));
  }

  function rendererChoiceUnavailable(value, format, config, xyzrenderAvailable) {
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

  function setXyzrenderPopoverVisibility(toolbar, open, options = {}) {
    const popover = toolbar?.querySelector('[data-buret-xyzrender-popover]');
    const tuneButton = toolbar?.querySelector('[data-buret-action="xyzrender-tune"]');
    if (!popover) return;
    const resetScroll = options.resetScroll === true;
    popover.classList.toggle('hidden', !open);
    toolbar?.classList.toggle('buret-popover-open', open);
    if (tuneButton) {
      tuneButton.classList.toggle('active', open);
      tuneButton.toggleAttribute('data-open', open);
    }
    if (open) {
      if (resetScroll) popover.scrollTop = 0;
      positionXyzrenderPopover(toolbar);
    }
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
      vdwAtoms: normalizeXyzrenderAtomSelector(source.vdwAtoms),
      vdwOpacity: positiveNumberOrNull(source.vdwOpacity),
      vdwScale: positiveNumberOrNull(source.vdwScale),
      hullMode: normalizeXyzrenderHullMode(source.hullMode),
      hullAtoms: normalizeXyzrenderAtomSelector(source.hullAtoms),
      hullOpacity: nonNegativeNumberOrNull(source.hullOpacity),
      poreOpacity: nonNegativeNumberOrNull(source.poreOpacity),
      hideBonds: source.hideBonds === true,
      displayHydrogens: normalizeXyzrenderHydrogens(source.displayHydrogens),
      bondNotation: normalizeXyzrenderBondNotation(source.bondNotation),
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
      extraArguments: nonEmptyText(source.extraArguments),
      regions: normalizeXyzrenderRegions(source.regions)
    };
  }

  function normalizeXyzrenderHydrogens(value) {
    const text = String(value || '').trim().toLowerCase();
    return text === 'all' || text === 'auto' || text === 'none' ? text : null;
  }

  function normalizeXyzrenderBondNotation(value) {
    const text = String(value || '').trim().toLowerCase();
    return text === 'aromatic' || text === 'kekule' ? text : null;
  }

  function normalizeXyzrenderHullMode(value) {
    const text = String(value || '').trim().toLowerCase();
    return ['off', 'benzene-ring', 'anthracene-rings', 'auto-rings', 'faces', 'pore', 'mof5-faces', 'mof5-pore', 'faces-pore'].includes(text) ? text : null;
  }

  function normalizeXyzrenderRegions(value) {
    if (!Array.isArray(value)) return [];
    return value.map(region => {
      if (!region || typeof region !== 'object') return null;
      const atoms = normalizeXyzrenderAtomSelector(region.atoms);
      if (!atoms) return null;
      return { atoms, preset: normalizeXyzrenderPreset(region.preset) };
    }).filter(Boolean);
  }

  function normalizeXyzrenderAtomSelector(value) {
    const text = String(value || '').replace(/\s+/gu, '');
    if (!text || !/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/u.test(text)) return null;
    const parts = [];
    for (const rawPart of text.split(',')) {
      const [rawStart, rawEnd] = rawPart.split('-');
      const start = Number(rawStart);
      const end = rawEnd == null ? start : Number(rawEnd);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end <= 0 || end < start) return null;
      parts.push(start === end ? String(start) : `${start}-${end}`);
    }
    return parts.join(',');
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
    if (value === true) return true;
    if (value === false) return false;
    return null;
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
    const activeModel = value === 'xyzrender-external' ? activeTrajectoryFrameIndexForRendererSwitch() : null;
    const payload = { type: 'setRenderer', value };
    if (orientationRef) {
      payload.orientationRef = orientationRef.text;
      payload.orientationAtomCount = orientationRef.atomCount;
    }
    if (activeModel !== null) {
      payload.activeModel = activeModel;
    }
    const sent = postHostMessage(payload);
    if (!sent) setStatus('Renderer switching is available only in the app or Quick Look viewer.', 'error');
  }

  function activeTrajectoryFrameIndexForRendererSwitch(config = activeConfig || window.BurreteConfig || {}, prepared = activeMolstarPrepared) {
    const poseCount = Number(
      prepared?.poseCount ||
      prepared?.xyzFrameCount ||
      prepared?.sdfPoseRecordCount ||
      prepared?.pdbModelCount ||
      config?.trajectoryFrameCount ||
      0
    );
    if (!Number.isFinite(poseCount) || poseCount <= 1) return null;
    const nativePosition = prepared?.nativeTrajectoryControls === true ? readNativeTrajectoryPosition(poseCount) : null;
    const activeIndex = nativePosition?.index ?? readTrajectoryControlIndex(config, prepared, poseCount);
    if (!Number.isFinite(activeIndex)) return null;
    return Math.max(0, Math.min(poseCount - 1, Math.trunc(activeIndex)));
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
    const cb = window.BurreteCacheBuster || String(Date.now());
    const format = normalizeFormat(config.molstarFormat || config.format);
    const trajectoryFrameCount = Number(config.trajectoryFrameCount || 0);
    const nextConfig = {
      ...config,
      renderer: 'molstar',
      xyzrenderViewer: false,
      externalArtifact: null,
      sdfPosePager: format === 'sdf' && config.binary !== true,
      trajectoryControls: config.trajectoryControls === true || trajectoryFrameCount > 1
    };
    activeConfig = nextConfig;
    window.BurreteConfig = nextConfig;
    postHostMessage({
      type: 'rendererChanged',
      documentId: nextConfig.documentId,
      renderer: 'molstar'
    });
    xyzrenderInlineRequestSerial += 1;
    disposeExternalArtifactInteractions();
    applyConfigOptions(nextConfig);
    try {
      await ensureBrowserDevStructureData(nextConfig, cb);
      await startMolstar(nextConfig, cb);
    } catch (error) {
      setStatus(`Mol* renderer switch failed.\n\n${error && error.message || String(error)}`, 'error');
    }
  }

  function embeddedStructureDataByteLength() {
    if (window.BurreteDataBytes instanceof Uint8Array) return window.BurreteDataBytes.length;
    if (typeof window.BurreteDataBase64 !== 'string') return 0;
    const text = window.BurreteDataBase64.trim();
    if (!text) return 0;
    const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor(text.length * 3 / 4) - padding);
  }

  async function ensureBrowserDevStructureData(config, cb) {
    if (config.tauriViewer !== false) return;
    if (typeof config.dataPath !== 'string' || !config.dataPath.trim()) return;
    const expectedBytes = Number(config.previewByteCount || config.byteCount || 0);
    if (!Number.isFinite(expectedBytes) || expectedBytes <= 1) return;
    if (embeddedStructureDataByteLength() > 1) return;
    window.BurreteDataBytes = null;
    window.BurreteDataBase64 = null;
    await loadStructureData(config, cb);
  }

  function requestSdfGridDocument() {
    const payload = { type: 'openSdfGridDocument' };
    const gridPath = sdfGridPathForConfig(activeConfig || {});
    if (gridPath) payload.path = gridPath;
    const sent = postHostMessage(payload);
    if (!sent) setStatus('SDF grid switching is available only in the app or Quick Look viewer.', 'error');
  }

  function showGenerate3DMenu(anchor) {
    const menu = document.querySelector('[data-buret-generate-3d-menu]');
    if (!menu || anchor?.classList?.contains('hidden') || anchor?.disabled) return;
    menu.classList.remove('hidden');
    positionGenerate3DMenu(anchor);
    anchor.setAttribute('aria-expanded', 'true');
    menu.querySelector('[role="menuitem"]')?.focus?.();
  }

  function positionGenerate3DMenu(anchor = document.querySelector('[data-buret-action="generate-3d-conformer"]')) {
    const menu = document.querySelector('[data-buret-generate-3d-menu]');
    if (!menu || menu.classList.contains('hidden') || !anchor) return;
    const margin = 12;
    const gap = 6;
    const anchorRect = anchor.getBoundingClientRect();
    const controlsRect = visibleRect('.msp-plugin .msp-viewport-controls-buttons');
    const rightBoundary = controlsRect && controlsRect.left > anchorRect.left
      ? Math.min(anchorRect.right, controlsRect.left - 8)
      : Math.min(anchorRect.right, window.innerWidth - margin);
    const menuWidth = menu.offsetWidth;
    const left = Math.min(
      Math.max(margin, rightBoundary - menuWidth),
      Math.max(margin, window.innerWidth - margin - menuWidth),
    );
    const belowTop = anchorRect.bottom + gap;
    const spaceBelow = window.innerHeight - margin - belowTop;
    const spaceAbove = anchorRect.top - gap - margin;
    const openAbove = spaceBelow < Math.min(menu.scrollHeight, 180) && spaceAbove > spaceBelow;
    const availableHeight = Math.max(96, openAbove ? spaceAbove : spaceBelow);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(openAbove
      ? Math.max(margin, anchorRect.top - gap - Math.min(menu.scrollHeight, availableHeight))
      : belowTop)}px`;
    menu.style.maxHeight = `${Math.floor(availableHeight)}px`;
    menu.dataset.placement = openAbove ? 'top' : 'bottom';
  }

  function hideGenerate3DMenu({ restoreFocus = false } = {}) {
    const menu = document.querySelector('[data-buret-generate-3d-menu]');
    if (menu && !menu.classList.contains('hidden')) menu.classList.add('hidden');
    const trigger = document.querySelector('[data-buret-action="generate-3d-conformer"]');
    if (trigger?.getAttribute('aria-expanded') !== 'false') trigger?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger?.focus?.();
  }

  function setGenerate3DPending(pending, mode = 'single') {
    generate3dPending = pending === true;
    generate3dPendingMode = mode === 'ensemble' ? 'ensemble' : 'single';
    const button = document.querySelector('[data-buret-action="generate-3d-conformer"]');
    if (button) applyGenerate3DPendingState(button);
  }

  function applyGenerate3DPendingState(button) {
    const label = button.querySelector('[data-buret-generate-3d-label]');
    if (!button.dataset.readyLabel) button.dataset.readyLabel = label?.textContent?.trim() || 'Generate 3D';
    const config = activeConfig || window.BurreteConfig || {};
    const renderer = normalizeRenderer(config.renderer);
    const canGenerate3d = canGenerate3DConformerFromConfig(config, renderer);
    button.classList.toggle('generating', generate3dPending);
    button.setAttribute('aria-busy', generate3dPending ? 'true' : 'false');
    button.disabled = !canGenerate3d || generate3dPending;
    if (label) {
      label.textContent = generate3dPending
        ? (generate3dPendingMode === 'ensemble' ? 'Generating set...' : 'Generating 3D...')
        : button.dataset.readyLabel;
    }
  }

  document.addEventListener('pointerdown', event => {
    const menu = document.querySelector('[data-buret-generate-3d-menu]');
    if (!menu || menu.classList.contains('hidden')) return;
    if (menu.contains(event.target) || event.target?.closest?.('[data-buret-action="generate-3d-conformer"]')) return;
    hideGenerate3DMenu();
  });
  document.addEventListener('keydown', event => {
    const menu = document.querySelector('[data-buret-generate-3d-menu]');
    if (!menu || menu.classList.contains('hidden')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      hideGenerate3DMenu({ restoreFocus: true });
      return;
    }
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]')).filter(item => !item.disabled);
    const currentIndex = items.indexOf(document.activeElement);
    let nextIndex = -1;
    if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    if (event.key === 'ArrowUp') nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = items.length - 1;
    if (nextIndex >= 0 && items[nextIndex]) {
      event.preventDefault();
      items[nextIndex].focus();
    }
  });

  function requestMolecularCompute(operation = 'generate3d', options = {}) {
    const config = activeConfig || window.BurreteConfig || {};
    const format = normalizeFormat(config.sourceExtension || config.molstarFormat || config.format);
    if (!['sdf', 'sd', 'mol'].includes(format)) {
      setStatus('Native molecular compute supports SDF and MOL structures in Molstar.', 'error');
      return;
    }
    const mode = options.mode === 'ensemble' ? 'ensemble' : 'single';
    const sent = postHostMessage({
      type: 'molecularCompute',
      operation,
      path: String(config.sourcePath || '').trim(),
      title: String(config.label || 'structure').trim(),
      extension: String(config.sourceExtension || config.format || '').trim(),
      molstarStyle: configuredMolstarStyle(config),
      mode
    });
    if (!sent) {
      setStatus('Native Metal compute is available only in the desktop app.', 'error');
      return;
    }
    if (operation === 'generate3d' || operation === 'generateEnsemble') setGenerate3DPending(true, mode);
    const labels = {
      generate3d: 'Generating 3D geometry',
      generateEnsemble: 'Generating conformer ensemble',
      optimizeGeometry: 'Optimizing geometry',
      semiempiricalRm1: 'Calculating RM1 energy and charges',
      alignPoses: 'Aligning and comparing poses'
    };
    setStatus(`[web] ${labels[operation] || 'Starting molecular compute'} in the desktop native runtime...`);
  }

  function canGenerate3DConformerFromConfig(config, renderer) {
    const format = normalizeFormat(config?.sourceExtension || config?.molstarFormat || config?.format);
    return renderer === 'molstar' && ['sdf', 'sd', 'mol'].includes(format);
  }

  function isSdfPoseConformerSet(config) {
    const format = normalizeFormat(config?.sourceExtension || config?.molstarFormat || config?.format);
    if (format !== 'sdf' && format !== 'sd') return false;
    const configuredPoseCount = Number(config?.trajectoryFrameCount || 0);
    const preparedPoseCount = Number(activeMolstarPrepared?.sdfPoseRecordCount || activeMolstarPrepared?.poseCount || 0);
    return (config?.sdfPosePager === true && configuredPoseCount > 1) || preparedPoseCount > 1;
  }

  window.addEventListener('message', event => {
    const data = event.data || {};
    const body = data.source === 'burrete-host' ? data.body : null;
    if (!body) return;
    if (body.type === 'workspaceHistoryCommand') {
      void handleWorkspaceHistoryCommand(body, event.source);
      return;
    }
    if (body.type === 'setXyzrenderControls') {
      const config = activeConfig || window.BurreteConfig || {};
      const documentId = String(config.documentId || '');
      const hasXyzrenderArtifact = Boolean(document.querySelector('.buret-external-artifact-root, .buret-xyzrender-sheet-item-base, .buret-external-artifact-object'));
      if (body.documentId && documentId && String(body.documentId) !== documentId && !hasXyzrenderArtifact) return;
      const controls = normalizeXyzrenderControls(body.controls || config.xyzrenderControls || DEFAULT_XYZRENDER_CONTROLS, config);
      const preset = normalizeXyzrenderPreset(body.preset || config.externalArtifact?.preset || config.xyzrenderPreset || 'default');
      if (body.selectionAction === 'vdw') {
        void applyXyzrenderSelectionVdw(controls, preset);
        return;
      }
      if (hasXyzrenderSelection()) {
        void applyXyzrenderSelectionPreset(preset, controls);
        return;
      }
      const options = { controls, preset };
      if (requestBrowserDevXyzrenderUpdate(options)) return;
      const sent = postHostMessage({ type: 'setXyzrenderControls', documentId, controls, preset, ...xyzrenderOrientationPayload(options) });
      if (!sent) setStatus('xyzrender controls are available only in the app or Quick Look viewer.', 'error');
      return;
    }
    if (body.type === 'generate3dConformerStarted') {
      setGenerate3DPending(true, body.mode);
      return;
    }
    if (body.type === 'generate3dConformerFinished') {
      setGenerate3DPending(false);
      return;
    }
    if (body.type !== 'replaceMolstarStructure') return;
    void replaceMolstarStructureFromHost(body).catch(error => {
      setGenerate3DPending(false);
      setStatus(`3D structure update failed.\n\n${error?.message || String(error)}`, 'error');
    });
  });

  async function handleWorkspaceHistoryCommand(body, source) {
    const direction = body.direction === 'redo' ? 'redo' : 'undo';
    let handled = false;
    try {
      if (direction === 'redo') {
        handled = xyzrenderActionRedoStack.length
          ? redoXyzrenderLastAction({ fromSystemHistory: true })
          : false;
      } else if (xyzrenderActionUndoStack.length) {
        handled = undoXyzrenderLastAction({ fromSystemHistory: true });
      } else if (molstarEditUndoStack.length) {
        await undoMolstarLastEdit();
        handled = true;
      }
    } catch (error) {
      setStatus(`[web] ${direction === 'redo' ? 'Redo' : 'Undo'} failed.\n\n${error?.message || String(error)}`, 'error');
    }
    source?.postMessage({
      source: 'burrete-viewer',
      body: {
        type: 'workspaceHistoryCommandResult',
        requestId: body.requestId,
        handled
      }
    }, '*');
  }

  async function replaceMolstarStructureFromHost(body) {
    const documentId = String((activeConfig || window.BurreteConfig || {}).documentId || '');
    if (body.documentId && documentId && String(body.documentId) !== documentId) return;
    if (!activeViewer) throw new Error('Mol* viewer is not ready.');
    const textBase64 = typeof body.textBase64 === 'string' ? body.textBase64.trim() : '';
    if (!textBase64) throw new Error('Generated 3D structure payload is empty.');
    const text = base64ToText(textBase64);
    const title = String(body.title || 'generated-3d.sdf').trim() || 'generated-3d.sdf';
    const byteCount = Number(body.byteCount || new TextEncoder().encode(text).byteLength);
    const generatedStyle = normalizeMolstarStyle(body.molstarStyle || configuredMolstarStyle(activeConfig || window.BurreteConfig || {}));
    const nextConfig = {
      ...(activeConfig || window.BurreteConfig || {}),
      label: title,
      format: 'sdf',
      molstarFormat: 'sdf',
      molstarStyle: generatedStyle,
      binary: false,
      renderer: 'molstar',
      requestedRenderer: 'molstar',
      byteCount: Number.isFinite(byteCount) && byteCount > 0 ? byteCount : text.length,
      previewByteCount: Number.isFinite(byteCount) && byteCount > 0 ? byteCount : text.length,
      sourcePath: typeof body.path === 'string' ? body.path : '',
      sourceExtension: 'sdf',
      dataPath: null,
      stagedEntries: [],
      docking: null,
      sdfPosePager: true,
      generated3dConformer: true,
      trajectoryControls: false,
      trajectoryFrameCount: 0
    };
    activeConfig = nextConfig;
    window.BurreteConfig = nextConfig;
    window.BurreteDataBytes = null;
    window.BurreteDataBase64 = textBase64;
    activeMolstarCacheBuster = String(Date.now());
    setStatus(`[web] Updating Mol* structure…\n${title}`);
    const plugin = activeViewer?.plugin;
    const transitionFrame = captureMolstarTransitionFrame();
    let prepared = null;
    try {
      clearMolstarEditUndoHistory();
      if (typeof plugin?.clear === 'function') await plugin.clear();
      prepared = structureDataForMolstar(nextConfig);
      await withTimeout(
        loadPreparedStructure(activeViewer, prepared),
        45000,
        `Mol* timed out while updating ${title} as 3D SDF.`
      );
      await applyMolstarStyle(activeViewer, generatedStyle);
      applyLayoutState(activeViewer);
      scheduleLayoutStateReapply(activeViewer);
      configureRendererControls(nextConfig);
      try { activeViewer.handleResize(); } catch (_) {}
      requestGenerated3DCameraView(activeViewer);
      fadeMolstarTransitionFrame(transitionFrame);
    } catch (error) {
      removeMolstarTransitionFrame(transitionFrame);
      throw error;
    }
    try {
      window.BurreteAgent?.notifyStructureLoaded?.({ viewer: activeViewer, plugin: activeViewer.plugin, config: nextConfig, prepared });
      postHostMessage({ type: 'agentReady', message: 'Burrete agent ready' });
    } catch (error) {
      debug('BurreteAgent notifyStructureLoaded failed after in-place structure update: ' + (error && error.message || String(error)));
    }
    void reportBurreteAgentState();
    setGenerate3DPending(false);
    setStatus(`[web] Updated ${title} with generated 3D coordinates`);
    postHostMessage({
      type: 'molstarStructureReplaced',
      requestId: typeof body.requestId === 'string' ? body.requestId : '',
      documentId: documentId || String(body.documentId || ''),
      title,
      path: nextConfig.sourcePath || '',
      method: String(body.method || '')
    });
    setTimeout(hideStatus, isQuickLookHost() ? 0 : 700);
  }

  function captureMolstarTransitionFrame() {
    const canvas = document.querySelector('.msp-plugin canvas');
    if (!canvas?.getBoundingClientRect || typeof canvas.toDataURL !== 'function') return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return null;
    try {
      const image = document.createElement('img');
      image.className = 'buret-molstar-transition-frame';
      image.alt = '';
      image.src = canvas.toDataURL('image/png');
      image.style.left = `${Math.round(rect.left)}px`;
      image.style.top = `${Math.round(rect.top)}px`;
      image.style.width = `${Math.round(rect.width)}px`;
      image.style.height = `${Math.round(rect.height)}px`;
      document.body.appendChild(image);
      return image;
    } catch (error) {
      debug('Mol* transition frame capture failed: ' + (error && error.message || String(error)));
      return null;
    }
  }

  function fadeMolstarTransitionFrame(frame) {
    if (!frame) return;
    requestAnimationFrame(() => {
      frame.classList.add('fade-out');
      setTimeout(() => removeMolstarTransitionFrame(frame), 380);
    });
  }

  function removeMolstarTransitionFrame(frame) {
    if (!frame) return;
    try { frame.remove(); } catch (_) {}
  }

  function requestGenerated3DCameraView(viewer) {
    requestMolstarStructureFocus(viewer, {
      reason: 'generated-3d',
      durationMs: 650,
      radiusScale: document.body?.classList.contains('burette-mobile-host') ? 0.58 : 0.88
    });
  }

  function scheduleMolstarStructureFocus(viewer, options = {}) {
    if (!molstarAutoFocusEnabled(activeConfig)) return;
    if (options.allowWithContextFocus !== true && hasMolstarContextFocus(activeConfig)) return;
    const serial = ++molstarStructureFocusSerial;
    const delays = Array.isArray(options.delays) && options.delays.length ? options.delays : [0, 80, 240, 520];
    delays.forEach(delayMs => {
      window.setTimeout(() => {
        if (serial !== molstarStructureFocusSerial) return;
        if (viewer !== activeViewer && viewer !== window.BurreteViewer && viewer !== window.BuretteViewer) return;
        try { viewer?.handleResize?.(); } catch (_) {}
        requestMolstarStructureFocus(viewer, options);
      }, Math.max(0, Number(delayMs) || 0));
    });
  }

  function molstarAutoFocusEnabled(config) {
    return !isQuickLookHost() && config?.autoFocusStructure === true;
  }

  function hasMolstarContextFocus(config) {
    return !!config?.molstarContextFocus && typeof config.molstarContextFocus === 'object';
  }

  function requestMolstarStructureFocus(viewer, options = {}) {
    const canvas3d = viewer?.plugin?.canvas3d;
    const camera = canvas3d?.camera;
    if (!canvas3d || !camera) return;
    try {
      const sphere = canvas3d.boundingSphereVisible || canvas3d.boundingSphere;
      const center = Array.isArray(sphere?.center) ? sphere.center : null;
      const radius = Number(sphere?.radius);
      const target = center && center.length >= 3 ? [center[0], center[1], center[2]] : camera.target;
      const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : Number(camera.state?.radius || 10);
      const configuredScale = Number(options.radiusScale);
      const radiusScale = Number.isFinite(configuredScale) && configuredScale > 0
        ? configuredScale
        : (document.body?.classList.contains('burette-mobile-host') ? 0.58 : 0.88);
      const snapshot = typeof camera.getFocus === 'function'
        ? camera.getFocus(target, Math.max(0.1, safeRadius * radiusScale), [0, 1, 0], [0.85, -0.38, 0.92])
        : null;
      if (snapshot) snapshot.mode = 'perspective';
      canvas3d.requestCameraReset({
        snapshot: snapshot || undefined,
        durationMs: Number.isFinite(Number(options.durationMs)) ? Number(options.durationMs) : 160,
      });
      try { canvas3d.requestDraw?.(); } catch (_) {}
    } catch (error) {
      debug('Mol* structure focus failed: ' + (error && error.message || String(error)));
      try { canvas3d.requestCameraReset?.({ durationMs: 450 }); } catch (_) {}
    }
  }

  function observeMolstarViewportPanel() {
    if (molstarViewportPanelObserver || !document.body) return;
    const update = () => refreshMolstarViewportPanelState();
    molstarViewportPanelObserver = new MutationObserver(update);
    molstarViewportPanelObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden']
    });
    update();
  }

  function readSdfPoseMode(config) {
    const sceneMode = dockingSceneMode(config);
    if (sceneMode) {
      const storageKey = poseModeStorageKey(config);
      const defaultMode = sceneMode === 'structureAll' ? 'all' : 'single';
      try {
        const stored = window.localStorage?.getItem(storageKey);
        if (stored === 'all' || stored === 'single') return stored;
        return defaultMode;
      } catch (_) {
        return defaultMode;
      }
    }
    const format = normalizeFormat(config?.molstarFormat || config?.format);
    if (format !== 'sdf' && format !== 'xyz') return 'single';
    const storageKey = poseModeStorageKey(config);
    try {
      const stored = window.localStorage?.getItem(storageKey);
      if (stored === 'all' || stored === 'single') return stored;
    } catch (_) {}
    return 'single';
  }

  function poseModeStorageKey(config) {
    const sceneMode = dockingSceneMode(config);
    if (sceneMode) {
      const documentId = String(config?.documentId || '').trim();
      if (documentId) return `buret.structureScene.poseMode.${documentId}`;
      const fallback = `${config?.label || 'scene'}:${window.location.pathname}:${window.location.search}`;
      return `buret.structureScene.poseMode.fallback-${stableTextHash(fallback)}`;
    }
    const format = normalizeFormat(config?.molstarFormat || config?.format);
    const fallbackKey = format === 'xyz' ? XYZ_FRAME_MODE_STORAGE_KEY : SDF_POSE_MODE_STORAGE_KEY;
    const storageKey = String(config?.sdfPoseModeStorageKey || fallbackKey);
    return storageKey;
  }

  function setSdfPoseMode(mode) {
    activeSdfPoseMode = mode === 'all' ? 'all' : 'single';
    try {
      const storageKey = poseModeStorageKey(activeConfig);
      window.localStorage?.setItem(storageKey, activeSdfPoseMode);
    } catch (_) {}
  }

  function notifyStructureOverlayModeChanged(prepared = activeMolstarPrepared) {
    if (!structureOverlayAvailable(prepared)) return;
    const documentId = String(activeConfig?.documentId || window.BurreteConfig?.documentId || '');
    postHostMessage({
      type: 'structureOverlayModeChanged',
      documentId,
      mode: activeSdfPoseMode === 'all' ? 'all' : 'single',
      overlayKind: prepared?.kind === 'sdf-collection'
        ? 'sdf-collection'
        : prepared?.dockingSceneMode
          ? 'docking-scene'
          : 'xyz-frames'
    });
  }

  function structureOverlayAvailable(prepared = activeMolstarPrepared) {
    if (prepared?.dockingSceneMode) {
      const poseCount = Number(prepared?.poseCount || 0);
      return Number.isFinite(poseCount) && poseCount > 1;
    }
    if (prepared?.pdbModelOverlayAvailable === true) return true;
    if (prepared?.sdfPoseOverlayAvailable === true || prepared?.xyzFrameOverlayAvailable === true) return true;
    const poseCount = Number(prepared?.poseCount || prepared?.sdfPoseRecordCount || prepared?.xyzFrameCount || activeConfig?.trajectoryFrameCount || 0);
    if (!Number.isFinite(poseCount) || poseCount <= 1) return false;
    const format = normalizeFormat(activeConfig?.molstarFormat || activeConfig?.format);
    return format === 'xyz';
  }

  function structureOverlayToggleAvailable(prepared = activeMolstarPrepared) {
    if (!structureOverlayAvailable(prepared)) return false;
    const format = normalizeFormat(activeConfig?.molstarFormat || activeConfig?.format);
    const trajectoryOverlay = prepared?.kind === 'trajectory'
      || prepared?.nativeTrajectoryControls === true
      || prepared?.xyzFrameOverlayAvailable === true
      || prepared?.pdbModelOverlayAvailable === true
      || format === 'xyz';
    if (trajectoryOverlay) {
      const poseCount = Number(prepared?.poseCount || prepared?.xyzFrameCount || prepared?.pdbModelCount || activeConfig?.trajectoryFrameCount || 0);
      return Number.isFinite(poseCount) && poseCount > 1 && poseCount <= MAX_STRUCTURE_OVERLAY_FRAME_COUNT;
    }
    return true;
  }

  function structureOverlayNoun(prepared = activeMolstarPrepared) {
    const format = normalizeFormat(activeConfig?.molstarFormat || activeConfig?.format);
    if (prepared?.dockingSceneMode) return 'structures';
    if (prepared?.kind === 'sdf-collection') return 'molecules';
    if (prepared?.pdbModelOverlayAvailable === true) return 'models';
    return prepared?.xyzFrameOverlayAvailable === true || format === 'xyz' ? 'XYZ frames' : 'SDF poses';
  }

  function updateStructureOverlayToggleButton(button, prepared = activeMolstarPrepared) {
    if (!button) return;
    const available = structureOverlayToggleAvailable(prepared);
    button.classList.toggle('hidden', !available);
    button.disabled = !available;
    button.setAttribute('aria-hidden', available ? 'false' : 'true');
    if (!available) return;
    const allMode = activeSdfPoseMode === 'all';
    const noun = structureOverlayNoun(prepared);
    const title = allMode ? `Show ${noun} individually` : `Show all ${noun} together`;
    button.classList.toggle('active', allMode);
    button.setAttribute('aria-pressed', allMode ? 'true' : 'false');
    button.setAttribute('aria-label', title);
    button.setAttribute('title', title);
    setTooltipLabel(button, title);
  }

  function createStructureOverlayToggleButton(prepared = activeMolstarPrepared) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'buret-docking-pose-all';
    button.dataset.buretAction = 'structure-overlay-toggle';
    button.textContent = 'All';
    updateStructureOverlayToggleButton(button, prepared);
    button.addEventListener('click', toggleSdfPoseMode);
    return button;
  }

  function updateSdfPoseButton() {
    const button = document.querySelector('#buret-toolbar [data-buret-action="sdf-poses"]');
    if (!button) return;
    button.classList.add('hidden');
    button.disabled = true;
    button.setAttribute('aria-hidden', 'true');
    button.classList.remove('active');
    button.setAttribute('aria-pressed', 'false');
  }

  async function reloadSdfPoseMode() {
    if (!activeViewer || !activeConfig) return;
    if (activeMolstarPrepared?.kind === 'sdf-collection') {
      const poseCount = Number(activeMolstarPrepared.poseCount || 0);
      const activePose = readTrajectoryControlIndex(activeConfig, activeMolstarPrepared, poseCount || 1);
      await applySdfCollectionVisibility(activeViewer, activeMolstarPrepared, activePose, { focus: false });
      return;
    }
    if (activeMolstarPrepared?.xyzFrameOverlayAvailable === true) {
      const poseCount = Number(activeMolstarPrepared.poseCount || activeMolstarPrepared.xyzFrameCount || 0);
      const activePose = readTrajectoryControlIndex(activeConfig, activeMolstarPrepared, poseCount || 1);
      if (activeSdfPoseMode === 'all') {
        await applyXyzFrameOverlayVisibility(activeViewer, activeMolstarPrepared, activePose);
      } else {
        await reloadActiveMolstarStructure();
      }
      return;
    }
    if (activeMolstarPrepared?.pdbModelOverlayAvailable === true) {
      await reloadActiveMolstarStructure();
      return;
    }
    if (activeMolstarPrepared?.kind === 'docking' && activeMolstarPrepared?.dockingSceneMode) {
      const poseCount = Number(activeMolstarPrepared.poseCount || 0);
      const activePose = readTrajectoryControlIndex(activeConfig, activeMolstarPrepared, poseCount || 1);
      await applyDockingSceneVisibility(activeViewer, activeMolstarPrepared, activePose, { focus: false });
      return;
    }
    if (activeMolstarPrepared?.kind === 'docking' && activeMolstarPrepared?.sdfPoseOverlayAvailable === true) {
      const poseCount = Number(activeMolstarPrepared.poseCount || 0);
      const activePose = readTrajectoryControlIndex(activeConfig, activeMolstarPrepared, poseCount || 1);
      await applyDockingPoseCollectionVisibility(activeViewer, activeMolstarPrepared, activePose, { focus: false });
      return;
    }
    await reloadActiveMolstarStructure();
  }

  async function reloadActiveMolstarStructure() {
    const viewer = activeViewer;
    const config = activeConfig;
    if (!viewer || !config) return;
    const plugin = viewer.plugin;
    const previousStructures = Array.from(plugin?.managers?.structure?.hierarchy?.current?.structures || []);
    const prepared = structureDataForMolstar(config);
    setStatus(`[web] Parsing structure…\n${prepared.label} (${describeFormat(prepared.format, config.binary)})`);
    await withTimeout(
      loadPreparedStructure(viewer, prepared),
      45000,
      `Mol* timed out while parsing/rendering ${prepared.label} as ${prepared.format}.`
    );
    if (previousStructures.length && typeof plugin?.managers?.structure?.hierarchy?.remove === 'function') {
      try {
        await plugin.managers.structure.hierarchy.remove(previousStructures, false);
      } catch (error) {
        debug('Mol* previous structure removal failed: ' + (error && error.message || String(error)));
      }
    }
    applyLayoutState(viewer);
    scheduleLayoutStateReapply(viewer);
    try { viewer.handleResize(); } catch (_) {}
    try {
      window.BurreteAgent?.notifyStructureLoaded?.({ viewer, plugin: viewer.plugin, config, prepared });
      postHostMessage({ type: 'agentReady', message: 'Burrete agent ready' });
    } catch (error) {
      debug('BurreteAgent notifyStructureLoaded failed: ' + (error && error.message || String(error)));
    }
    await applyMolstarContextFocus(config);
    void reportBurreteAgentState();
    startBurreteAgentActionPolling();
    {
      const poseCount = Number(prepared?.poseCount || prepared?.sdfPoseRecordCount || prepared?.xyzFrameCount || config?.trajectoryFrameCount || 0);
      setStatus(`[web] Rendered ${config.label || 'structure'}`);
      setTimeout(() => hideStatus(molstarReadyPayload(config, prepared, {
        molstarStructureCount: currentMolstarStructureCount(viewer),
        poseCount,
        trajectoryFrameCount: Math.max(Number(config?.trajectoryFrameCount || 0), poseCount)
      })), isQuickLookHost() ? 0 : 700);
    }
  }

  function toggleSdfPoseMode() {
    if (!structureOverlayAvailable(activeMolstarPrepared)) return;
    const nextMode = activeSdfPoseMode === 'all' ? 'single' : 'all';
    const noun = structureOverlayNoun(activeMolstarPrepared);
    setSdfPoseMode(nextMode);
    notifyStructureOverlayModeChanged(activeMolstarPrepared);
    updateSdfPoseButton(activeMolstarPrepared);
    setStatus(nextMode === 'all' ? `[web] Showing all ${noun} together…` : `[web] Showing ${noun} individually…`);
    void reloadSdfPoseMode().catch(error => {
      setStatus(`${noun} mode switch failed.\n\n${error?.message || String(error)}`, 'error');
    });
  }

  function requestOpenInKetcher() {
    const config = activeConfig || window.BurreteConfig || {};
    if (config.ketcherEditable !== true) {
      setStatus('This structure is too large or not supported by Ketcher.', 'error');
      return;
    }
    const payload = {
      type: 'openInKetcher',
      path: String(config.ketcherSourcePath || config.sourcePath || '').trim(),
      title: String(config.ketcherSourceTitle || config.label || 'structure').trim(),
      extension: String(config.ketcherSourceExtension || config.format || '').trim()
    };
    if (typeof config.ketcherSourceTextBase64 === 'string' && config.ketcherSourceTextBase64.trim()) {
      payload.textBase64 = config.ketcherSourceTextBase64.trim();
    }
    const sent = postHostMessage(payload);
    if (!sent) setStatus('Ketcher handoff is available only in the app viewer.', 'error');
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
    const molstarStyleSlot = toolbar.querySelector('[data-buret-molstar-style-slot]');
    const molstarStyleSelect = toolbar.querySelector('[data-buret-molstar-style]');
    const tuneButton = toolbar.querySelector('[data-buret-action="xyzrender-tune"]');
    const popover = toolbar.querySelector('[data-buret-xyzrender-popover]');
    const lassoButton = toolbar.querySelector('[data-buret-action="molstar-lasso"]');
    const external = normalized === 'xyzrender-external';
    molstarStyleSlot?.classList.toggle('visible', !external);
    if (molstarStyleSelect) molstarStyleSelect.disabled = external;
    const lassoAvailable = normalized === 'molstar' || external;
    lassoButton?.classList.toggle('hidden', !lassoAvailable);
    if (lassoButton) {
      lassoButton.disabled = !lassoAvailable;
      lassoButton.setAttribute('aria-hidden', lassoAvailable ? 'false' : 'true');
    }
    updateMolstarLassoButton();
    presetSlot?.classList.toggle('visible', external);
    if (preset) preset.disabled = !external;
    tuneButton?.classList.toggle('hidden', !external);
    if (!external) {
      tuneButton?.classList.remove('active');
      tuneButton?.removeAttribute('data-open');
      popover?.classList.add('hidden');
    }
  }

  function populateMolstarStyleSelect(select) {
    if (!select || select.dataset.populated === '1') return;
    select.innerHTML = MOLSTAR_STYLE_OPTIONS
      .map(option => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
      .join('');
    select.dataset.populated = '1';
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function previewDockDocumentRows() {
    const config = activeConfig || window.BurreteConfig || {};
    const rows = [
      ['Document', config.label || config.title || 'Burrete preview'],
      ['Format', config.format || config.molstarFormat || 'unknown']
    ];
    if (config.byteCount !== undefined) rows.push(['Size', `${Number(config.byteCount || 0).toLocaleString()} bytes`]);
    if (config.documentId) rows.push(['Document ID', config.documentId]);
    if (config.path) rows.push(['Path', config.path]);
    return rows.map(([label, value]) => `
      <div class="buret-preview-dock-card">
        <div class="buret-preview-dock-label">${escapeHtml(label)}</div>
        <div class="buret-preview-dock-value">${escapeHtml(value)}</div>
      </div>
    `).join('');
  }

  function previewDockCard(label, value) {
    return `
      <div class="buret-preview-dock-card">
        <div class="buret-preview-dock-label">${escapeHtml(label)}</div>
        <div class="buret-preview-dock-value">${escapeHtml(value)}</div>
      </div>
    `;
  }

  function previewDockSection(title, body) {
    return `
      <div class="buret-preview-dock-section">
        <div class="buret-preview-dock-section-title">${escapeHtml(title)}</div>
        ${body}
      </div>
    `;
  }

  function previewDockSceneDescription(observe) {
    const scene = observe?.scene || {};
    if (!scene.known) return scene.note || 'Scene summary is waiting for the Mol* viewer agent.';
    const counts = scene.counts || {};
    const parts = [
      `${counts.structures || scene.structures || 0} structure`,
      `${counts.models || scene.models || 0} model`,
      `${counts.chains || 0} chains`,
      `${counts.residues || 0} residues`,
      `${counts.atoms || 0} atoms`,
      `${counts.ligands || 0} ligands`
    ];
    return `${scene.label || 'Active scene'} (${scene.format || 'unknown'}): ${parts.join(', ')}.`;
  }

  function previewDockLigandList(observe) {
    const ligands = observe?.scene?.ligands || [];
    if (!ligands.length) return previewDockCard('Ligands', 'No ligands reported yet.');
    const items = ligands.slice(0, 8).map(ligand => {
      const chain = ligand.auth_asym_id || ligand.label_asym_id || '?';
      const seq = ligand.auth_seq_id || ligand.label_seq_id || '?';
      const atoms = Number.isFinite(ligand.atomCount) ? `${ligand.atomCount} atoms` : 'atom count unknown';
      return `<li class="buret-preview-dock-list-item">
        <div class="buret-preview-dock-line">
          <span>${escapeHtml(`${chain}:${seq}`)}</span>
          <span class="buret-preview-dock-muted">${escapeHtml(atoms)}</span>
        </div>
      </li>`;
    }).join('');
    const suffix = ligands.length > 8 ? previewDockCard('More ligands', `${ligands.length - 8} additional ligands are hidden in this compact view.`) : '';
    return `<ul class="buret-preview-dock-list">${items}</ul>${suffix}`;
  }

  function previewDockAgentRows(observe) {
    if (!observe) {
      return previewDockCard('Bridge', previewDockObserveLoading ? 'Loading agent observe state...' : 'No observe state loaded yet.');
    }
    const agent = observe.viewerAgent || {};
    const commands = Array.isArray(agent.commands) ? agent.commands : [];
    return [
      previewDockCard('Workspace mode', `${observe.mode || 'unknown'} / ${observe.transport || 'unknown'}`),
      previewDockCard('Viewer agent', agent.available ? 'available' : 'not ready'),
      previewDockCard('Commands', commands.length ? commands.join(', ') : 'No commands reported yet.'),
      agent.lastReportAt ? previewDockCard('Last report', agent.lastReportAt) : ''
    ].join('');
  }

  function previewDockActionList(observe) {
    const recent = observe?.actions?.recent || [];
    if (!recent.length) return previewDockCard('Actions', 'No MCP/agent actions have been recorded yet.');
    const items = recent.slice(-8).reverse().map(action => {
      const result = action.result || {};
      const statusClass = action.status === 'completed' ? 'ok' : action.status === 'failed' ? 'failed' : '';
      const command = result.command || action.type || 'action';
      const detail = result.error?.message || result.result?.selectionId || result.result?.counts
        ? JSON.stringify(result.result?.counts || result.result?.selectionId || result.error?.message)
        : '';
      return `<li class="buret-preview-dock-list-item">
        <div class="buret-preview-dock-line">
          <span>${escapeHtml(`${action.id}: ${command}`)}</span>
          <span class="buret-preview-dock-status-pill ${statusClass}">${escapeHtml(action.status || 'unknown')}</span>
        </div>
        ${detail ? `<div class="buret-preview-dock-muted">${escapeHtml(detail)}</div>` : ''}
      </li>`;
    }).join('');
    return `<ul class="buret-preview-dock-list">${items}</ul>`;
  }

  function previewDockRightBody() {
    const observe = previewDockObserve;
    const error = previewDockObserveError ? previewDockCard('Observe error', previewDockObserveError) : '';
    return [
      previewDockSection('Document', previewDockDocumentRows()),
      previewDockSection('Scene text', previewDockCard('Summary', previewDockSceneDescription(observe)) + previewDockLigandList(observe)),
      previewDockSection('Agent bridge', previewDockAgentRows(observe)),
      previewDockSection('MCP action log', previewDockActionList(observe)),
      error
    ].join('');
  }

  function renderPreviewDock(area) {
    const panel = document.querySelector(`[data-buret-preview-dock="${area}"]`);
    if (!panel) return;
    const title = area === 'right' ? 'Agent scene log' : 'Preview dock';
    const body = area === 'right'
      ? previewDockRightBody()
      : `<div class="buret-preview-dock-section">
          <div class="buret-preview-dock-card">
            <div class="buret-preview-dock-label">Active preview</div>
            <div class="buret-preview-dock-value">${escapeHtml((activeConfig || window.BurreteConfig || {}).label || 'Burrete preview')}</div>
          </div>
          <div class="buret-preview-dock-card">
            <div class="buret-preview-dock-label">Status</div>
            <div class="buret-preview-dock-value">Standalone browser preview controls are available here.</div>
          </div>
        </div>`;
    panel.innerHTML = `
      <div class="buret-preview-dock-header">
        <div class="buret-preview-dock-title">${escapeHtml(title)}</div>
        <button class="buret-button buret-preview-dock-close" type="button" data-buret-dock-close="${area}" aria-label="Hide ${area} dock" title="Hide ${area} dock">×</button>
      </div>
      <div class="buret-preview-dock-body">${body}</div>
    `;
  }

  function previewDockObserveUrl() {
    return window.BurreteAgentControl?.observeUrl || '/__agent/observe';
  }

  async function refreshPreviewDockObserve() {
    if (!previewDocksEnabled() || !previewDockState.right || previewDockObserveLoading) return;
    previewDockObserveLoading = true;
    try {
      const response = await fetch(previewDockObserveUrl(), { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error(`observe returned HTTP ${response.status}`);
      previewDockObserve = await response.json();
      previewDockObserveError = '';
    } catch (error) {
      previewDockObserveError = error?.message || String(error);
    } finally {
      previewDockObserveLoading = false;
      if (previewDockState.right) renderPreviewDock('right');
      schedulePreviewDockObserveRefresh();
    }
  }

  function schedulePreviewDockObserveRefresh() {
    window.clearTimeout(previewDockObserveTimer);
    previewDockObserveTimer = 0;
    if (!previewDocksEnabled() || !previewDockState.right) return;
    previewDockObserveTimer = window.setTimeout(() => {
      void refreshPreviewDockObserve();
    }, previewDockObserve ? 2000 : 250);
  }

  function setPreviewDockOpen(area, open) {
    if (area !== 'right' && area !== 'bottom') return;
    previewDockState[area] = open === true;
    const panel = document.querySelector(`[data-buret-preview-dock="${area}"]`);
    if (panel) {
      renderPreviewDock(area);
      panel.classList.toggle('open', previewDockState[area]);
      panel.setAttribute('aria-hidden', previewDockState[area] ? 'false' : 'true');
    }
    document.body?.classList.toggle(`buret-preview-dock-${area}-open`, previewDockState[area]);
    if (area === 'right') {
      if (previewDockState.right) void refreshPreviewDockObserve();
      else window.clearTimeout(previewDockObserveTimer);
    }
    updatePreviewDockButtons();
  }

  function togglePreviewDock(area) {
    setPreviewDockOpen(area, !previewDockState[area]);
  }

  function previewDocksEnabled() {
    const config = activeConfig || window.BurreteConfig || {};
    return config.enablePreviewDocks === true;
  }

  function updatePreviewDockAvailability() {
    const enabled = previewDocksEnabled();
    document.body?.classList.toggle('buret-preview-docks-enabled', enabled);
    if (!enabled) {
      setPreviewDockOpen('bottom', false);
      setPreviewDockOpen('right', false);
    }
    return enabled;
  }

  function updatePreviewDockButtons() {
    const toolbar = document.getElementById('buret-toolbar');
    if (!toolbar) return;
    for (const area of ['bottom', 'right']) {
      const button = toolbar.querySelector(`[data-buret-dock-toggle="${area}"]`);
      if (!button) continue;
      const open = previewDockState[area] === true;
      button.classList.toggle('active', open);
      button.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} ${area} dock`);
      button.setAttribute('title', `${open ? 'Hide' : 'Show'} ${area} dock`);
    }
  }

  function bindPreviewDockControls(toolbar) {
    if (!toolbar || !previewDocksEnabled() || toolbar.dataset.previewDockTogglesBound === '1') return;
    toolbar.addEventListener('click', event => {
      const button = event.target?.closest?.('[data-buret-dock-toggle]');
      if (!button || !toolbar.contains(button)) return;
      event.preventDefault();
      event.stopPropagation();
      togglePreviewDock(button.getAttribute('data-buret-dock-toggle'));
    });
    document.addEventListener('click', event => {
      const close = event.target?.closest?.('[data-buret-dock-close]');
      if (!close) return;
      event.preventDefault();
      event.stopPropagation();
      setPreviewDockOpen(close.getAttribute('data-buret-dock-close'), false);
    });
    toolbar.dataset.previewDockTogglesBound = '1';
    updatePreviewDockButtons();
  }

  function applyDefaultPreviewDocks(toolbar) {
    if (!toolbar || !previewDocksEnabled() || toolbar.dataset.previewDocksDefaulted === '1') return;
    const config = activeConfig || window.BurreteConfig || {};
    const defaultDocks = Array.isArray(config.defaultPreviewDocks) ? config.defaultPreviewDocks : [];
    toolbar.dataset.previewDocksDefaulted = '1';
    for (const area of defaultDocks) {
      if (area === 'bottom' || area === 'right') setPreviewDockOpen(area, true);
    }
  }

  function requestMolstarStyle(style) {
    const value = normalizeMolstarStyle(style);
    activeConfig = {
      ...(activeConfig || window.BurreteConfig || {}),
      molstarStyle: value
    };
    if (activeMolstarPrepared?.molstarStyleOverride) {
      activeMolstarPrepared = {
        ...activeMolstarPrepared,
        molstarStyleOverride: value
      };
    }
    window.BurreteConfig = { ...(window.BurreteConfig || {}), ...activeConfig };
    const toolbar = document.getElementById('buret-toolbar');
    const select = toolbar?.querySelector('[data-buret-molstar-style]');
    if (select) select.value = value;
    if (!activeViewer) {
      setStatus('Mol* style can be changed after the viewer loads.', 'error');
      return;
    }
    const serial = ++molstarStyleApplySerial;
    setStatus(`[web] Applying Mol* ${molstarStyleLabel(value)} style…`);
    void reloadMolstarStyle(activeViewer, value, serial).catch(error => {
      if (serial !== molstarStyleApplySerial) return;
      setStatus(`Mol* style switch failed.\n\n${error?.message || String(error)}`, 'error');
    });
  }

  function molstarStyleLabel(value) {
    return MOLSTAR_STYLE_OPTIONS.find(option => option.value === value)?.label || value;
  }

  function captureMolstarCameraSnapshot(viewer) {
    const camera = viewer?.plugin?.canvas3d?.camera;
    if (!camera || typeof camera.getSnapshot !== 'function') return null;
    try {
      const snapshot = camera.getSnapshot();
      if (!snapshot) return null;
      return {
        ...snapshot,
        position: snapshot.position?.slice?.() || snapshot.position,
        target: snapshot.target?.slice?.() || snapshot.target,
        up: snapshot.up?.slice?.() || snapshot.up
      };
    } catch (_) {
      return null;
    }
  }

  function restoreMolstarCameraSnapshot(viewer, snapshot) {
    if (!snapshot) return;
    const canvas3d = viewer?.plugin?.canvas3d;
    if (!canvas3d?.requestCameraReset) return;
    try {
      canvas3d.requestCameraReset({ snapshot, durationMs: 0 });
      canvas3d.requestDraw?.();
    } catch (_) {}
  }

  async function reloadMolstarStyle(viewer, style, serial) {
    const prepared = activeMolstarPrepared;
    if (!prepared) {
      await applyMolstarStyle(viewer, style);
      return;
    }
    const cameraSnapshot = captureMolstarCameraSnapshot(viewer);
    const plugin = viewer?.plugin;
    if (typeof plugin?.clear === 'function') {
      await plugin.clear();
    }
    await loadPreparedStructure(viewer, prepared);
    if (serial !== molstarStyleApplySerial) return;
    if (Array.isArray(activeConfig?.stagedEntries) && activeConfig.stagedEntries.length > 0) {
      await loadStagedMolstarEntries(viewer, activeConfig, activeMolstarCacheBuster || String(Date.now()));
    }
    applyLayoutState(viewer);
    scheduleLayoutStateReapply(viewer);
    try { viewer.handleResize(); } catch (_) {}
    restoreMolstarCameraSnapshot(viewer, cameraSnapshot);
    setStatus(`[web] Applied Mol* ${molstarStyleLabel(style)} style`);
    setTimeout(hideStatus, isQuickLookHost() ? 0 : 700);
  }

  function requestXyzrenderPreset(preset) {
    const value = normalizeXyzrenderPreset(preset);
    const toolbar = document.getElementById('buret-toolbar');
    const controls = toolbar
      ? readXyzrenderControlsForm(toolbar)
      : normalizeXyzrenderControls((activeConfig && activeConfig.xyzrenderControls) || DEFAULT_XYZRENDER_CONTROLS, activeConfig || {});
    if (hasXyzrenderSelection()) {
      void applyXyzrenderSelectionPreset(value, controls);
      return;
    }
    if (requestSelectedXyzrenderSheetItemsUpdate({ preset: value, controls })) return;
    if (requestBrowserDevXyzrenderUpdate({ preset: value })) return;
    const sent = postHostMessage({ type: 'setXyzrenderPreset', value, ...xyzrenderOrientationPayload({ preset: value, controls }) });
    if (!sent) setStatus('xyzrender preset switching is available only in the app or Quick Look viewer.', 'error');
  }

  function requestBrowserDevXyzrenderUpdate(options = {}) {
    const config = activeConfig || window.BurreteConfig || {};
    const endpoint = String(config.xyzrenderEndpoint || '').trim();
    const sourcePath = String(config.xyzrenderSourcePath || config.sourcePath || '').trim();
    const renderer = options.rendererSwitch === true ? 'xyzrender-external' : normalizeRenderer(config.renderer);
    const hasXyzrenderArtifact = Boolean(document.querySelector('.buret-external-artifact-root, .buret-xyzrender-sheet-item-base, .buret-external-artifact-object'));
    if (config.tauriViewer !== false || !endpoint || !sourcePath || (renderer !== 'xyzrender-external' && !hasXyzrenderArtifact)) {
      return false;
    }
    const toolbar = document.getElementById('buret-toolbar');
    const controls = options.controls || (toolbar ? readXyzrenderControlsForm(toolbar) : normalizeXyzrenderControls(config.xyzrenderControls || DEFAULT_XYZRENDER_CONTROLS, config));
    const preset = normalizeXyzrenderPreset(options.preset || config.externalArtifact?.preset || config.xyzrenderPreset || 'default');
    const orientationRef = captureCurrentXyzrenderOrientationRef(options);
    const activeModel = options.activeModel ?? activeTrajectoryFrameIndexForRendererSwitch(config, activeMolstarPrepared);
    const inputDataBase64 = typeof config.xyzrenderInputDataBase64 === 'string' ? config.xyzrenderInputDataBase64.trim() : '';
    const inputExtension = typeof config.xyzrenderInputExtension === 'string' && config.xyzrenderInputExtension.trim()
      ? config.xyzrenderInputExtension.trim()
      : String(config.sourceExtension || config.molstarFormat || config.format || '').trim();
    const serial = ++xyzrenderInlineRequestSerial;
    setStatus(`[web] Updating xyzrender artifact…\n${config.label || 'structure'}`);
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: sourcePath,
        preset,
        orientationRef: orientationRef?.text || undefined,
        controls,
        activeModel: activeModel ?? undefined,
        inputDataBase64: inputDataBase64 || undefined,
        inputExtension: inputExtension || undefined
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
    const baseItem = document.querySelector('.buret-xyzrender-sheet-item-base');
    const object = document.querySelector('.buret-external-artifact-object');
    const label = (activeConfig || {}).label || 'xyzrender artifact';
    if (baseItem) {
      updateXyzrenderSheetItemBody(baseItem, payload.svg);
    } else if (object) {
      const stage = object.closest('.buret-external-artifact-stage');
      if (stage) {
        stage.innerHTML = externalArtifactSheetHTML(externalArtifactBaseItemHTML(payload.svg, label));
        installExternalArtifactBaseItemInteractions(document.querySelector('.buret-external-artifact-root'));
      }
    } else {
      disposeActiveMolstarViewer();
      installExternalArtifactStyles();
      const container = document.getElementById('app');
      if (container) {
        container.innerHTML = `
          <div class="buret-external-artifact-root">
            <div class="buret-external-artifact-stage">${externalArtifactSheetHTML(externalArtifactBaseItemHTML(payload.svg, label))}</div>
            <div class="buret-xyz-badge"><strong>External xyzrender</strong><span>SVG</span></div>
          </div>`;
        const root = container.querySelector('.buret-external-artifact-root');
        if (root) installExternalArtifactInteractions(root);
      }
    }
    const preset = normalizeXyzrenderPreset(payload.preset || requestedPreset);
    const controls = normalizeXyzrenderControls(payload.xyzrenderControls || requestedControls || DEFAULT_XYZRENDER_CONTROLS, activeConfig || {});
    const activeModel = Number(payload.activeModel);
    const elapsed = Number(payload.elapsedMs) || 0;
    const badge = document.querySelector('.buret-xyz-badge span');
    if (badge) badge.textContent = `SVG · ${preset}${elapsed ? ` · ${elapsed} ms` : ''}`;
    activeConfig = {
      ...(activeConfig || window.BurreteConfig || {}),
      renderer: 'xyzrender-external',
      ...(Number.isFinite(activeModel) && activeModel >= 0 ? { activeModel: Math.trunc(activeModel) } : {}),
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
    postHostMessage({
      type: 'rendererChanged',
      documentId: activeConfig.documentId,
      renderer: 'xyzrender-external',
      preset,
      controls,
      presetOptions: activeConfig.xyzrenderPresetOptions || []
    });
    configureRendererControls(activeConfig);
    setStatus(`[web] Rendered ${(activeConfig || {}).label || 'structure'} with external xyzrender`);
    setTimeout(() => hideStatus(previewReadyPayload(activeConfig, {
      renderer: 'xyzrender-external',
      externalArtifact: true,
      xyzrenderSvgBytes: String(payload.svg || '').length
    })), 450);
  }

  function updateXyzrenderSheetItemBody(item, svg) {
    const body = item?.querySelector?.('.buret-xyzrender-sheet-item-body');
    if (!body) return false;
    body.innerHTML = svg;
    return true;
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
      vdwAtoms: current.vdwAtoms,
      hullMode: current.hullMode,
      hullAtoms: current.hullAtoms,
      hullOpacity: current.hullOpacity,
      poreOpacity: current.poreOpacity,
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
    if (hasXyzrenderSelection()) {
      const item = xyzrenderFirstSelectionItem();
      if (item) pushXyzrenderActionHistory(item, 'apply settings');
      applyXyzrenderSelectionControls(controls);
      return;
    }
    if (requestSelectedXyzrenderSheetItemsUpdate({ controls })) return;
    if (requestBrowserDevXyzrenderUpdate({ controls })) return;
    const sent = postHostMessage({ type: 'setXyzrenderControls', controls, ...xyzrenderOrientationPayload({ controls }) });
    if (!sent) {
      setStatus('xyzrender controls are available only in the app or Quick Look viewer.', 'error');
    }
  }

  function requestXyzrenderOrientationReset(toolbar) {
    latestXyzrenderOrientationRef = null;
    const config = activeConfig || window.BurreteConfig || {};
    const controls = toolbar
      ? readXyzrenderControlsForm(toolbar)
      : normalizeXyzrenderControls(config.xyzrenderControls || DEFAULT_XYZRENDER_CONTROLS, config);
    const preset = normalizeXyzrenderPreset(
      toolbar?.querySelector('[data-buret-xyzrender-preset]')?.value ||
      config.externalArtifact?.preset ||
      config.xyzrenderPreset ||
      'default'
    );
    const options = { preset, controls, useDefaultOrientation: true };
    const activeModel = activeTrajectoryFrameIndexForRendererSwitch(config, activeMolstarPrepared);
    if (requestSelectedXyzrenderSheetItemsUpdate(options)) return;
    if (requestBrowserDevXyzrenderUpdate(options)) return;
    const sent = postHostMessage({
      type: 'setRenderer',
      value: 'xyzrender-external',
      preset,
      controls,
      ...(activeModel !== null ? { activeModel } : {}),
      orientationRef: ''
    });
    if (!sent) {
      setStatus('xyzrender 3D view reset is available only in the app or browser-dev viewer.', 'error');
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

  function captureCurrentXyzrenderOrientationRef(options = {}) {
    if (options.useDefaultOrientation === true) return null;
    const config = activeConfig || {};
    const format = normalizeFormat(config.molstarFormat || config.format);
    if (config.binary === true) return null;
    if (!activeViewer || !canUseExternalXyzrender(format)) return latestXyzrenderOrientationRef;
    const nextRef = buildXyzrenderOrientationRef(activeViewer, config);
    if (nextRef) latestXyzrenderOrientationRef = nextRef;
    return nextRef || latestXyzrenderOrientationRef;
  }

  function xyzrenderOrientationPayload(options = {}) {
    const orientationRef = captureCurrentXyzrenderOrientationRef(options);
    const activeModel = activeTrajectoryFrameIndexForRendererSwitch();
    return {
      ...(orientationRef ? { orientationRef: orientationRef.text, orientationAtomCount: orientationRef.atomCount } : {}),
      ...(activeModel !== null ? { activeModel } : {})
    };
  }

  function trackMolstarOrientation(viewer, config) {
    if (orientationTrackingCleanup) {
      try { orientationTrackingCleanup(); } catch (_) {}
      orientationTrackingCleanup = null;
    }
    latestXyzrenderOrientationRef = null;
    if (config.binary === true || !canUseExternalXyzrender(config.molstarFormat || config.format)) return;

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
    const frame = orientationFrameFromConfig(config);
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

  function orientationFrameFromConfig(config) {
    if (!config || config.binary === true) return null;
    const format = normalizeFormat(config.molstarFormat || config.format);
    const text = rawStructureData({ ...config, binary: false });
    if (format === 'xyz') return parseFirstXYZFrame(text);
    if (format === 'pdb' || format === 'pdbqt') return orientationFrameFromPdbText(activePdbModelText(text, config));
    if (format === 'sdf') return orientationFrameFromSdfText(text);
    if (format === 'mmcif' || format === 'cifCore') return orientationFrameFromCifText(text);
    return null;
  }

  function activePdbModelText(text, config) {
    const modelTexts = splitPdbModelTexts(text);
    if (modelTexts.length <= 1) return text;
    const controlLabel = normalizeFormat(config?.sourceExtension || config?.molstarFormat || config?.format) === 'pdbqt' ? 'Pose' : 'Model';
    const activeModel = readTrajectoryControlIndex(config, { controlLabel }, modelTexts.length);
    return modelTexts[activeModel] || modelTexts[0] || text;
  }

  function splitPdbModelTexts(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const firstModelIndex = lines.findIndex(line => /^MODEL\b/u.test(line));
    if (firstModelIndex < 0) return [];
    const header = lines.slice(0, firstModelIndex).filter(line => !/^END\b/u.test(line));
    const models = [];
    let current = null;
    for (const line of lines.slice(firstModelIndex)) {
      if (/^MODEL\b/u.test(line)) {
        current = [];
        continue;
      }
      if (/^ENDMDL\b/u.test(line)) {
        if (current?.some(modelLine => /^(?:ATOM|HETATM)\b/u.test(modelLine))) models.push(current);
        current = null;
        continue;
      }
      if (current) current.push(line);
    }
    if (models.length <= 1) return [];
    return models.map(model => [...header, ...model.filter(line => !/^END\b/u.test(line)), 'END', ''].join('\n'));
  }

  function orientationFrameFromPdbText(text) {
    const atoms = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
      .map(line => {
        const atom = parsePdbAtomLine(line);
        if (!atom) return null;
        return { symbol: atom.element || pdbAtomSymbol(line), x: atom.x, y: atom.y, z: atom.z };
      })
      .filter(Boolean);
    return atoms.length ? { atoms } : null;
  }

  function orientationFrameFromSdfText(text) {
    const records = splitSdfRecords(text);
    const molecule = parseV2000SdfRecord(records[0] || text);
    const atoms = molecule?.atoms?.map(atom => ({
      symbol: sdfAtomSymbol(atom),
      x: atom.x,
      y: atom.y,
      z: atom.z
    })) || [];
    return atoms.length ? { atoms } : null;
  }

  function orientationFrameFromCifText(text) {
    const cif = parseCif(text);
    const atomLoop = cif.loops.find(loop => {
      const tags = new Set(loop.tags);
      return hasAnyCifTag(tags, ['_atom_site.cartn_x', '_atom_site_cartn_x', '_atom_site.fract_x', '_atom_site_fract_x']) &&
        hasAnyCifTag(tags, ['_atom_site.type_symbol', '_atom_site_type_symbol', '_atom_site.label_atom_id', '_atom_site_label_atom_id', '_atom_site.label', '_atom_site_label']);
    });
    if (!atomLoop) return null;
    const idx = Object.fromEntries(atomLoop.tags.map((tag, i) => [tag, i]));
    const width = atomLoop.tags.length;
    const scalar = (...tags) => tags.map(tag => cif.scalars.get(tag)).find(value => value != null);
    const a = parseFloatLoose(scalar('_cell.length_a', '_cell_length_a'));
    const b = parseFloatLoose(scalar('_cell.length_b', '_cell_length_b'));
    const c = parseFloatLoose(scalar('_cell.length_c', '_cell_length_c'));
    const alpha = deg2rad(parseFloatLoose(scalar('_cell.angle_alpha', '_cell_angle_alpha')) || 90);
    const beta = deg2rad(parseFloatLoose(scalar('_cell.angle_beta', '_cell_angle_beta')) || 90);
    const gamma = deg2rad(parseFloatLoose(scalar('_cell.angle_gamma', '_cell_angle_gamma')) || 90);
    const haveCell = Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c);
    const atoms = [];
    for (let rowStart = 0; rowStart + width <= atomLoop.values.length; rowStart += width) {
      const get = (...tags) => {
        for (const tag of tags) {
          const index = idx[tag];
          if (index != null) return atomLoop.values[rowStart + index];
        }
        return undefined;
      };
      const label = get('_atom_site.label_atom_id', '_atom_site_label_atom_id', '_atom_site.auth_atom_id', '_atom_site_auth_atom_id', '_atom_site.label', '_atom_site_label') || 'X';
      let x = parseFloatLoose(get('_atom_site.cartn_x', '_atom_site_cartn_x'));
      let y = parseFloatLoose(get('_atom_site.cartn_y', '_atom_site_cartn_y'));
      let z = parseFloatLoose(get('_atom_site.cartn_z', '_atom_site_cartn_z'));
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        const fx = parseFloatLoose(get('_atom_site.fract_x', '_atom_site_fract_x'));
        const fy = parseFloatLoose(get('_atom_site.fract_y', '_atom_site_fract_y'));
        const fz = parseFloatLoose(get('_atom_site.fract_z', '_atom_site_fract_z'));
        if (!haveCell || !Number.isFinite(fx) || !Number.isFinite(fy) || !Number.isFinite(fz)) continue;
        [x, y, z] = fracToCart(fx, fy, fz, a, b, c, alpha, beta, gamma);
      }
      if ([x, y, z].every(Number.isFinite)) {
        atoms.push({ symbol: cleanElement(get('_atom_site.type_symbol', '_atom_site_type_symbol') || label), x, y, z });
      }
    }
    return atoms.length ? { atoms } : null;
  }

  function hasAnyCifTag(tags, candidates) {
    return candidates.some(tag => tags.has(tag));
  }

  function pdbAtomSymbol(line) {
    return pdbAtomElement(line);
  }

  function sdfAtomSymbol(atom) {
    return cleanElement(String(atom?.tail || '').trim().split(/\s+/u)[0] || 'X');
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
    const atomicNumber = Number.parseInt(String(value || '').trim(), 10);
    if (Number.isFinite(atomicNumber) && String(atomicNumber) === String(value || '').trim()) {
      return ATOMIC_SYMBOLS[atomicNumber - 1] || 'X';
    }
    const match = String(value || 'X').trim().match(/[A-Za-z]{1,3}/u);
    if (!match) return 'X';
    return match[0].slice(0, 1).toUpperCase() + match[0].slice(1).toLowerCase();
  }

  const ATOMIC_SYMBOLS = [
    'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne',
    'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca',
    'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn',
    'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr',
    'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn',
    'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd',
    'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb',
    'Lu', 'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg',
    'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn'
  ];

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
    bindSaveModifiedStructureButton(toolbar);
    installMolstarEditUndoShortcuts();
    bindMolstarStyleControls(toolbar);
    bindMolstarLassoButton(toolbar);
    bindMolstarLassoKeyboardButton(toolbar);
    installMolstarLassoSelection();
    installMolstarToolbarActionDelegates();
    bindXyzrenderControls(toolbar);
    const sdfPoseButton = toolbar.querySelector('[data-buret-action="sdf-poses"]');
    if (sdfPoseButton && sdfPoseButton.dataset.bound !== '1') {
      sdfPoseButton.dataset.bound = '1';
      sdfPoseButton.addEventListener('click', toggleSdfPoseMode);
    }
    updatePreviewDockAvailability();
    bindPreviewDockControls(toolbar);
    applyDefaultPreviewDocks(toolbar);
    initToolbarDrag(toolbar);
    restoreToolbarCollapsed(toolbar, viewer);
    installToolbarAutoLayoutTracking(toolbar);
    installMolstarFloatingPanelTracking();
    initSceneTree(viewer);
    updateToolbarVisibility();
    updateSdfPoseButton();
    updatePreviewDockButtons();
    updateThemeButton();
    applyLayoutState(viewer);
  }

  function setMolstarStructureDirty(dirty) {
    molstarStructureDirty = dirty === true;
    updateSaveModifiedStructureButton();
  }

  function isMolstarEditUndoKeyboardTarget(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest('#buret-toolbar, .buret-molecule-context-menu')) return true;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return false;
    return true;
  }

  function installMolstarEditUndoShortcuts() {
    if (window.__buretteMolstarEditUndoShortcutsInstalled) return;
    window.__buretteMolstarEditUndoShortcutsInstalled = true;
    document.addEventListener('keydown', event => {
      const key = String(event.key || '').toLowerCase();
      if (!['z', 'я'].includes(key) || event.altKey || !(event.metaKey || event.ctrlKey)) return;
      if (!isMolstarEditUndoKeyboardTarget(event.target)) return;
      if (event.shiftKey && xyzrenderActionRedoStack.length) {
        event.preventDefault();
        event.stopPropagation();
        goForwardXyzrenderSystemHistory();
        return;
      }
      if (!event.shiftKey && xyzrenderActionUndoStack.length) {
        event.preventDefault();
        event.stopPropagation();
        goBackXyzrenderSystemHistory();
        return;
      }
      if (event.shiftKey || !molstarEditUndoStack.length) return;
      event.preventDefault();
      event.stopPropagation();
      void undoMolstarLastEdit().catch(error => {
        setStatus(`[web] Undo failed.\n\n${error?.message || String(error)}`, 'error');
      });
    }, true);
  }

  function updateSaveModifiedStructureButton() {
    const button = document.querySelector('#buret-toolbar [data-buret-action="save-modified-structure"]');
    if (!button) return;
    const visible = molstarStructureDirty && !!activeViewer;
    button.classList.toggle('hidden', !visible);
    button.classList.toggle('active', visible);
    button.setAttribute('aria-hidden', visible ? 'false' : 'true');
    button.disabled = !visible;
  }

  function bindSaveModifiedStructureButton(toolbar) {
    const button = toolbar?.querySelector('[data-buret-action="save-modified-structure"]');
    if (!button || button.dataset.bound === '1') return;
    button.dataset.bound = '1';
    button.addEventListener('click', () => {
      try {
        const saved = saveMolstarModifiedStructure();
        setStatus(`[web] Saving ${saved.name} (${saved.count} structure${saved.count === 1 ? '' : 's'}).`);
        setMolstarStructureDirty(false);
      } catch (error) {
        setStatus(`[web] Save modified structure failed.\n\n${error?.message || String(error)}`, 'error');
      }
    });
    updateSaveModifiedStructureButton();
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

  function bindMolstarStyleControls(toolbar) {
    if (!toolbar || toolbar.dataset.molstarStyleBound === '1') return;
    const select = toolbar.querySelector('[data-buret-molstar-style]');
    populateMolstarStyleSelect(select);
    if (select) {
      select.value = configuredMolstarStyle(activeConfig || window.BurreteConfig || {});
      select.addEventListener('change', () => requestMolstarStyle(select.value));
    }
    toolbar.dataset.molstarStyleBound = '1';
  }

  function bindMolstarLassoButton(toolbar) {
    const button = toolbar?.querySelector('[data-buret-action="molstar-lasso"]');
    if (!button || button.dataset.bound === '1') return;
    button.dataset.bound = '1';
    updateMolstarLassoButton();
  }

  function toggleActiveLassoSurface() {
    if (isXyzrenderLassoSurfaceActive()) setXyzrenderLassoEnabled(!xyzrenderLassoEnabled);
    else setMolstarLassoEnabled(!molstarLassoEnabled);
  }

  function installMolstarToolbarActionDelegates() {
    if (window.__buretteMolstarToolbarActionDelegatesInstalled) return;
    window.__buretteMolstarToolbarActionDelegatesInstalled = true;
    document.addEventListener('pointerdown', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || event.button !== 0) return;
      const lassoButton = target.closest('[data-buret-action="molstar-lasso"]');
      if (lassoButton) {
        molstarLassoSuppressClickUntil = Date.now() + 500;
        event.preventDefault();
        event.stopPropagation();
        toggleActiveLassoSurface();
        return;
      }
    }, true);
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (target.closest('[data-buret-action="molstar-lasso"]') && Date.now() < molstarLassoSuppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
  }

  function bindMolstarLassoKeyboardButton(toolbar) {
    const button = toolbar?.querySelector('[data-buret-action="molstar-lasso"]');
    if (!button || button.dataset.keyboardBound === '1') return;
    button.dataset.keyboardBound = '1';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (Date.now() < molstarLassoSuppressClickUntil) return;
      toggleActiveLassoSurface();
    });
  }

  function updateMolstarLassoButton() {
    const button = document.querySelector('#buret-toolbar [data-buret-action="molstar-lasso"]');
    if (!button) return;
    const xyzrender = isXyzrenderLassoSurfaceActive();
    const active = xyzrender ? xyzrenderLassoEnabled : molstarLassoEnabled;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    const label = active ? 'Exit lasso select' : 'Lasso select';
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    setTooltipLabel(button, xyzrender
      ? (active ? 'Drag over xyzrender graphics to select' : 'Lasso select xyzrender graphics')
      : (active ? 'Drag over visible atoms to select' : 'Lasso select visible atoms'));
  }

  function setMolstarLassoEnabled(enabled) {
    const next = enabled === true;
    molstarLassoEnabled = next;
    if (!next) cancelMolstarLassoStroke();
    document.body?.classList.toggle('buret-molstar-lasso-active', molstarLassoEnabled);
    updateMolstarLassoButton();
    setStatus(molstarLassoEnabled ? '[web] Lasso selection enabled.' : '[web] Lasso selection disabled.');
  }

  function isXyzrenderLassoSurfaceActive() {
    const config = activeConfig || window.BurreteConfig || {};
    return normalizeRenderer(config.renderer) === 'xyzrender-external' || !!document.querySelector('.buret-external-artifact-root');
  }

  function setXyzrenderLassoEnabled(enabled) {
    const next = enabled === true;
    xyzrenderLassoEnabled = next;
    if (!next) cancelXyzrenderLassoStroke();
    document.body?.classList.toggle('buret-xyzrender-lasso-active', xyzrenderLassoEnabled);
    updateMolstarLassoButton();
    setStatus(xyzrenderLassoEnabled ? '[web] xyzrender lasso enabled.' : '[web] xyzrender lasso disabled.');
  }

  function bindXyzrenderControls(toolbar) {
    if (!toolbar || toolbar.dataset.xyzrenderControlsBound === '1') return;
    toolbar.querySelector('[data-buret-xyzrender-preset]')?.addEventListener('change', () => updateXyzrenderFormVisibility(toolbar));
    toolbar.querySelector('[data-buret-action="xyzrender-reset"]')?.addEventListener('click', () => {
      if (hasXyzrenderSelection()) {
        resetXyzrenderSelectionStyles();
        setStatus('[web] Reset xyzrender lasso selection styles.');
        setTimeout(hideStatus, 900);
        return;
      }
      populateXyzrenderControlsForm(toolbar, {});
      requestXyzrenderControls(toolbar);
    });
    toolbar.querySelector('[data-buret-action="xyzrender-reset-orientation"]')?.addEventListener('click', () => {
      requestXyzrenderOrientationReset(toolbar);
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
      const nextTheme = toggleViewerTheme(viewer);
      postHostMessage({ type: 'setTheme', value: nextTheme });
    };
  }

  function restoreToolbarCollapsed(toolbar, viewer) {
    if (window.BurreteConfig?.hostedMcpWidgetBootstrap === true) {
      setToolbarCollapsed(toolbar, true, viewer, false);
      return;
    }
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
    if (collapsed) {
      setXyzrenderPopoverVisibility(toolbar, false);
      hideGenerate3DMenu();
    }
    toolbar.classList.toggle('collapsed', collapsed);
    document.body?.classList.toggle('buret-toolbar-collapsed', collapsed);
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

  function activateToolbarGrip(toolbar, viewer) {
    if (toolbar.classList.contains('buret-suppressed-by-molstar-panel')) {
      toolbar.dataset.molstarPanelSuppressOverride = '1';
      toolbar.classList.remove('buret-suppressed-by-molstar-panel');
      if (toolbar.classList.contains('collapsed')) {
        setToolbarCollapsed(toolbar, false, viewer);
      } else {
        toolbar.dataset.defaultPosition = '1';
        repositionToolbar(toolbar);
        updateFloatingLayoutOffsets();
        scheduleViewerResize(viewer, 40);
      }
      return;
    }
    setToolbarCollapsed(toolbar, !toolbar.classList.contains('collapsed'), viewer);
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
    if (grip && window.__BURRETE_HOSTED_GRIP_FALLBACK__) {
      grip.removeEventListener('click', window.__BURRETE_HOSTED_GRIP_FALLBACK__);
      delete window.__BURRETE_HOSTED_GRIP_FALLBACK__;
    }
    grip?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (ignoreNextGripClick) {
        ignoreNextGripClick = false;
        return;
      }
      activateToolbarGrip(toolbar, resizeState.viewer);
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
        activateToolbarGrip(toolbar, resizeState.viewer);
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
      positionGenerate3DMenu();
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
    root.style.setProperty('--buret-toolbar-current-width', toolbarRect ? Math.ceil(toolbarRect.width) + 'px' : '0px');
    root.style.setProperty('--buret-toolbar-current-height', toolbarRect ? Math.ceil(toolbarRect.height) + 'px' : '0px');
    root.style.setProperty('--buret-selection-controls-left', toolbarRect ? Math.ceil(toolbarRect.left) + 'px' : `${TOOLBAR_MARGIN}px`);
    root.style.setProperty('--buret-selection-controls-width', toolbarRect ? Math.ceil(toolbarRect.width) + 'px' : 'min(430px, calc(100vw - 24px))');
    root.style.setProperty('--buret-selection-controls-max-width', toolbarRect ? Math.max(180, Math.floor(window.innerWidth - toolbarRect.left - TOOLBAR_MARGIN)) + 'px' : 'calc(100vw - 24px)');
    root.style.setProperty('--buret-selection-controls-top', toolbarRect ? Math.ceil(toolbarRect.bottom - 1) + 'px' : `calc(var(--buret-toolbar-safe-top) + 48px)`);
    const toolbarBottom = toolbarRect ? toolbarRect.bottom + FLOATING_LAYOUT_GAP : toolbarSafeTop() + 40;
    const viewportControls = document.querySelector('.msp-plugin .msp-viewport-controls');
    const viewportControlsRect = viewportControls ? viewportControls.getBoundingClientRect() : null;
    const viewportControlRailRect = visibleRect('.msp-plugin .msp-viewport-controls-buttons');
    const generate3DControlRight = viewportControlRailRect
      ? Math.max(TOOLBAR_MARGIN, Math.ceil(window.innerWidth - viewportControlRailRect.left + FLOATING_LAYOUT_GAP * 2))
      : 70;
    root.style.setProperty('--buret-generate-3d-control-right', generate3DControlRight + 'px');
    const selectionToolbarRect = visibleRect('.msp-plugin .msp-selection-viewport-controls > .msp-flex-row');
    document.body?.classList.toggle('buret-selection-toolbar-open', !!selectionToolbarRect && !!toolbarRect);
    const mainRect = visibleRect('.msp-plugin .msp-layout-main');
    const mainTop = mainRect ? mainRect.top : 0;
    const defaultViewportTop = mainTop + 64;
    const panelOpenTop = selectionToolbarRect
      ? Math.ceil(selectionToolbarRect.bottom + FLOATING_LAYOUT_GAP)
      : defaultViewportTop;
    const controlsOpenTop = selectionToolbarRect
      ? Math.max(defaultViewportTop, panelOpenTop)
      : defaultViewportTop;
    const viewportControlsViewportTop = panelState.open
      ? Math.max(defaultViewportTop, panelOpenTop)
      : selectionToolbarRect
      ? controlsOpenTop
      : toolbarRect && (!viewportControlsRect || rectsOverlapX(toolbarRect, viewportControlsRect, 18))
      ? Math.max(defaultViewportTop, Math.ceil(toolbarBottom))
      : defaultViewportTop;
    const viewportControlsTop = Math.max(TOOLBAR_MARGIN, Math.ceil(viewportControlsViewportTop - mainTop));
    root.style.setProperty('--buret-viewport-controls-top', viewportControlsTop + 'px');
    repositionDockingPoseControlsForLayout(mainRect);

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
    if (
      panelOpen !== molstarViewportPanelOpen ||
      selectionOpen !== molstarSelectionControlsOpen
    ) {
      molstarViewportPanelOpen = panelOpen;
      molstarSelectionControlsOpen = selectionOpen;
      const suppressToolbar = panelOpen;
      if (panelOpen) hideGenerate3DMenu();
      document.body?.classList.toggle(MOLSTAR_VIEWPORT_PANEL_OPEN_CLASS, panelOpen);
      document.body?.classList.toggle('buret-molstar-selection-controls-open', selectionOpen);
      const toolbar = document.getElementById('buret-toolbar');
      if (toolbar) {
        if (!suppressToolbar) {
          delete toolbar.dataset.molstarPanelSuppressOverride;
        }
        toolbar.classList.toggle('buret-suppressed-by-molstar-panel', suppressToolbar && toolbar.dataset.molstarPanelSuppressOverride !== '1');
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
    const styles = window.getComputedStyle(document.documentElement);
    const parsed = Number.parseFloat(styles.getPropertyValue('--buret-toolbar-safe-top'));
    const inset = Number.parseFloat(styles.getPropertyValue('--buret-viewport-top-inset'));
    const base = Number.isFinite(parsed) ? Math.max(TOOLBAR_MARGIN, parsed) : TOOLBAR_MARGIN;
    return base + (Number.isFinite(inset) ? inset : 0);
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
    scheduleViewportCornerLayout();

    updateToolbarButtons();
    scheduleViewerResize(viewer, 40);
    updateFloatingLayoutOffsets();
    const toolbar = document.getElementById('buret-toolbar');
    if (toolbar?.dataset.defaultPosition === '1') {
      requestAnimationFrame(() => applyDefaultToolbarPosition(toolbar));
      setTimeout(() => applyDefaultToolbarPosition(toolbar), 120);
    }
  }

  function applyMobileLayoutState(state, viewer = activeViewer || window.BurreteViewer || null) {
    const next = state && typeof state === 'object' ? state : {};
    const boolRegion = (value, visibleState = 'full') => value === true ? visibleState : 'hidden';
    document.body?.classList.toggle('burette-mobile-show-left', next.left === true);
    document.body?.classList.toggle('burette-mobile-show-right', next.right === true);
    document.body?.classList.toggle('burette-mobile-show-sequence', next.sequence === true);
    document.body?.classList.toggle('burette-mobile-show-log', next.log === true);
    document.body?.classList.toggle('burette-mobile-show-controls', next.molstarControls === true);
    if (next.left !== undefined) layoutState.left = boolRegion(next.left);
    if (next.right !== undefined) layoutState.right = boolRegion(next.right);
    if (next.sequence !== undefined) layoutState.top = boolRegion(next.sequence);
    if (next.log !== undefined) layoutState.bottom = boolRegion(next.log);
    try {
      const plugin = viewer?.plugin;
      if (plugin?.layout?.setProps) {
        const payload = { regionState: { ...layoutState } };
        if (next.molstarControls !== undefined) payload.showControls = next.molstarControls !== false;
        plugin.layout.setProps(payload);
      }
    } catch (error) {
      debug('mobile layout state failed: ' + (error && error.message || String(error)));
    }
    applyLayoutState(viewer);
  }

  function clickFirstMobileControl(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.disabled !== true && element.getAttribute('aria-disabled') !== 'true') {
        element.click();
        return true;
      }
    }
    return false;
  }

  function setMobileTrajectorySpeed(value) {
    const speed = document.querySelector('.buret-docking-poses .buret-docking-pose-speed');
    if (!speed || speed.disabled === true || speed.getAttribute('aria-disabled') === 'true') return false;
    speed.value = String(value);
    speed.dispatchEvent(new Event('input', { bubbles: true }));
    speed.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function runMobileControlAction(action) {
    const name = String(action || '');
    const unavailable = label => setStatus(`[web] ${label} is unavailable. Enable Mol* Controls in the Controls sheet if you need the original Mol* panel.`, 'error');
    if (name === 'reset-camera') {
      const canvas3d = activeViewer?.plugin?.canvas3d;
      if (canvas3d?.requestCameraReset) {
        canvas3d.requestCameraReset({ durationMs: 350 });
        try { canvas3d.requestDraw?.(); } catch (_) {}
        return;
      }
      if (!clickFirstMobileControl([
        '.msp-viewport-controls [title="Reset Zoom"]',
        '.msp-viewport-controls [aria-label="Reset Zoom"]'
      ])) unavailable('Reset Camera');
    } else if (name === 'settings') {
      if (!clickFirstMobileControl([
        '.msp-viewport-controls [title="Settings / Controls Info"]',
        '.msp-viewport-controls [aria-label="Settings / Controls Info"]'
      ])) unavailable('Settings');
    } else if (name === 'screenshot') {
      if (!clickFirstMobileControl([
        '.msp-viewport-controls [title="Screenshot / State Snapshot"]',
        '.msp-viewport-controls [aria-label="Screenshot / State Snapshot"]'
      ])) unavailable('Screenshot');
    } else if (name === 'animation') {
      if (!clickFirstMobileControl([
        '.msp-animation-viewport-controls button',
        '.buret-docking-pose-animation-button'
      ])) unavailable('Animation');
    } else if (name === 'pose-prev' || name === 'trajectory-prev') {
      if (!clickFirstMobileControl(['.buret-docking-poses button[aria-label^="Previous"]'])) unavailable('Previous Pose');
    } else if (name === 'pose-next' || name === 'trajectory-next') {
      if (!clickFirstMobileControl(['.buret-docking-poses button[aria-label^="Next"]'])) unavailable('Next Pose');
    } else if (name === 'pose-all') {
      if (!clickFirstMobileControl([
        '.buret-docking-poses button[aria-label*="all"]',
        '#buret-toolbar [data-buret-action="sdf-poses"]'
      ])) unavailable('All Poses');
    } else if (name.startsWith('pose-index:')) {
      const index = Number(name.slice('pose-index:'.length));
      if (!Number.isFinite(index)) {
        unavailable('Pose Index');
      } else {
        setSdfPoseIndexFromAction({ index }).then(result => {
          if (!result?.ok) unavailable('Pose Index');
        });
      }
    } else if (name === 'trajectory-loop') {
      if (!clickFirstMobileControl(['.buret-docking-poses button[aria-label^="Play"], .buret-docking-poses button[aria-label^="Stop"]'])) unavailable('Trajectory Loop');
    } else if (name.startsWith('trajectory-speed:')) {
      const value = Number(name.slice('trajectory-speed:'.length));
      if (!Number.isFinite(value) || !setMobileTrajectorySpeed(value)) unavailable('Trajectory Speed');
    }
  }

  window.BurreteApplyMobileLayoutState = applyMobileLayoutState;
  window.BurreteRunMobileControlAction = runMobileControlAction;
  if (window.BurreteMobileControls?.pendingLayoutState) {
    requestAnimationFrame(() => applyMobileLayoutState(window.BurreteMobileControls.pendingLayoutState));
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
      scheduleViewportCornerLayout();
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

  // Scene tree: a Burrete-styled stand-in for the Mol* left object tree. It mirrors
  // the same hierarchy Mol* shows — data, model, assembly, components, their
  // representations — but as a compact draggable overlay. Rows carry only the two
  // controls Mol* puts there (visibility, remove); focus and colouring live in the
  // right-click menu. The Mol* panel itself stays reachable under the `L` button.
  const SCENE_TREE_SVG_NS = 'http://www.w3.org/2000/svg';
  // Same left-edge type colours Mol* paints on `.msp-type-class-*` tree rows.
  const SCENE_TREE_TYPE_COLOR = {
    Root: '#eeece7',
    Group: '#e98b39',
    Data: '#bfc8c9',
    Object: '#54d98c',
    Representation3D: '#4aa3df',
    Behavior: '#b07cc6'
  };
  const SCENE_TREE_ICON = {
    chevron: ['m9 6 6 6-6 6'],
    eye: ['M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],
    eyeOff: ['M9.88 9.88a3 3 0 1 0 4.24 4.24', 'M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68', 'M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61', 'm2 2 20 20'],
    trash: ['M3 6h18', 'M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6']
  };
  // Apple system colours: the uniform tints offered next to the real colour themes.
  const SCENE_TREE_UNIFORM_COLORS = [
    { label: 'Purple', value: 0xaf52de },
    { label: 'Blue', value: 0x0a84ff },
    { label: 'Cyan', value: 0x40c8e0 },
    { label: 'Green', value: 0x32d74b },
    { label: 'Yellow', value: 0xffd60a },
    { label: 'Orange', value: 0xff9f0a },
    { label: 'Red', value: 0xff453a },
    { label: 'Pink', value: 0xff6482 },
    { label: 'Grey', value: 0x98989d },
    { label: 'White', value: 0xf2f2f7 }
  ];
  const sceneTreeExpandedRefs = new Set();
  const sceneTreeKnownRefs = new Set();
  let sceneTreeStateDisposer = null;
  let sceneTreeRenderHandle = 0;
  let sceneTreeHoverRef = '';
  let sceneTreeMenuRef = '';

  function sceneTreeIconElement(paths) {
    const svg = document.createElementNS(SCENE_TREE_SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    for (const definition of paths) {
      const path = document.createElementNS(SCENE_TREE_SVG_NS, 'path');
      path.setAttribute('d', definition);
      svg.appendChild(path);
    }
    return svg;
  }

  function sceneTreeColorHex(value) {
    return `#${Number(value).toString(16).padStart(6, '0')}`;
  }

  function sceneTreeChildRefs(state) {
    const children = new Map();
    let rootRef = null;
    state.cells.forEach((cell, ref) => {
      const parent = cell?.transform?.parent;
      if (parent === undefined || parent === ref) {
        if (rootRef === null) rootRef = ref;
        return;
      }
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(ref);
    });
    return { children, rootRef };
  }

  // Only structures and their components accept a colour: Mol* applies themes per
  // component, and a structure row simply forwards the pick to all of its own.
  function sceneTreeColorTargets(viewer) {
    const targets = new Map();
    for (const structure of molstarCurrentStructures(viewer)) {
      const components = structure?.components || [];
      const structureRef = structure?.cell?.transform?.ref;
      if (structureRef) targets.set(structureRef, components);
      for (const component of components) {
        const componentRef = component?.cell?.transform?.ref;
        if (componentRef) targets.set(componentRef, [component]);
      }
    }
    return targets;
  }

  // A row reports a colour theme only when every representation under it agrees;
  // mixed rows show nothing rather than lying about the scene.
  function sceneTreeColorState(components) {
    let theme = null;
    let value = null;
    let seen = false;
    for (const component of components) {
      for (const representation of component?.representations || []) {
        const colorTheme = representation?.cell?.transform?.params?.colorTheme;
        const name = colorTheme?.name || '';
        const uniform = name === 'uniform' ? colorTheme?.params?.value : null;
        if (!seen) {
          theme = name;
          value = Number.isFinite(uniform) ? uniform : null;
          seen = true;
          continue;
        }
        if (theme !== name) return { theme: '', value: null };
        if (value !== (Number.isFinite(uniform) ? uniform : null)) value = null;
      }
    }
    return { theme: theme || '', value };
  }

  function isSceneTreeDecorator(cell) {
    return cell?.transform?.transformer?.definition?.isDecorator === true;
  }

  function sceneTreeNodes(viewer) {
    const state = viewer?.plugin?.state?.data;
    if (!state?.cells) return [];
    const { children, rootRef } = sceneTreeChildRefs(state);
    if (rootRef === null) return [];
    const colorTargets = sceneTreeColorTargets(viewer);
    // Decorators such as custom-model-properties re-wrap their parent under the
    // same label. Mol* shows one row for the whole chain, and the managers address
    // the deepest cell, so the chain collapses onto that ref.
    const decoratorChain = ref => {
      const chain = [ref];
      let current = ref;
      for (;;) {
        const decorators = (children.get(current) || [])
          .filter(childRef => isSceneTreeDecorator(state.cells.get(childRef)));
        if (decorators.length !== 1) break;
        current = decorators[0];
        chain.push(current);
      }
      return chain;
    };
    const build = refs => {
      const nodes = [];
      for (const parentRef of refs) {
        for (const childRef of children.get(parentRef) || []) {
          const cell = state.cells.get(childRef);
          if (!cell || isSceneTreeDecorator(cell)) continue;
          // Mol* hides ghost and pending cells but keeps showing their children.
          if (cell.state?.isGhost === true || !cell.obj) {
            nodes.push(...build(decoratorChain(childRef)));
            continue;
          }
          const chain = decoratorChain(childRef);
          const nodeRef = chain[chain.length - 1];
          const components = colorTargets.get(nodeRef) || null;
          nodes.push({
            ref: nodeRef,
            label: String(cell.obj.label || 'Node'),
            note: String(cell.obj.description || ''),
            typeClass: String(cell.obj.type?.typeClass || 'Object'),
            hidden: cell.state?.isHidden === true,
            colorable: !!components,
            ...(components ? sceneTreeColorState(components) : { theme: '', value: null }),
            children: build(chain)
          });
        }
      }
      return nodes;
    };
    return build([rootRef]);
  }

  // Everything opens on first sight, the way the Mol* tree does; rows are compact
  // enough that a whole structure still fits without scrolling.
  function reconcileSceneTreeExpansion(nodes) {
    const present = new Set();
    // Gate on the first render where a node actually has children: Mol* builds the
    // hierarchy in passes, so a node seen while still childless would otherwise be
    // recorded as "already handled" and never open.
    const walk = list => {
      for (const node of list) {
        present.add(node.ref);
        if (node.children.length && !sceneTreeKnownRefs.has(node.ref)) {
          sceneTreeKnownRefs.add(node.ref);
          sceneTreeExpandedRefs.add(node.ref);
        }
        walk(node.children);
      }
    };
    walk(nodes);
    for (const ref of Array.from(sceneTreeKnownRefs)) {
      if (!present.has(ref)) sceneTreeKnownRefs.delete(ref);
    }
    for (const ref of Array.from(sceneTreeExpandedRefs)) {
      if (!present.has(ref)) sceneTreeExpandedRefs.delete(ref);
    }
    if (sceneTreeMenuRef && !present.has(sceneTreeMenuRef)) closeSceneTreeMenu();
  }

  function sceneTreeActionButton(action, label, icon) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `buret-tree-action buret-tree-action-${action}`;
    button.dataset.sceneTreeAction = action;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.appendChild(sceneTreeIconElement(icon));
    return button;
  }

  function sceneTreeNodeElement(node) {
    const item = document.createElement('div');
    item.className = 'buret-tree-item';
    item.dataset.ref = node.ref;
    const expandable = node.children.length > 0;
    const open = expandable && sceneTreeExpandedRefs.has(node.ref);
    if (expandable) item.dataset.open = open ? 'true' : 'false';
    if (node.hidden) item.dataset.hidden = 'true';

    const row = document.createElement('div');
    row.className = 'buret-tree-row';
    row.dataset.ref = node.ref;

    if (expandable) {
      const twisty = document.createElement('button');
      twisty.type = 'button';
      twisty.className = 'buret-tree-twisty';
      twisty.dataset.sceneTreeAction = 'expand';
      twisty.setAttribute('aria-expanded', open ? 'true' : 'false');
      twisty.setAttribute('aria-label', open ? `Collapse ${node.label}` : `Expand ${node.label}`);
      twisty.appendChild(sceneTreeIconElement(SCENE_TREE_ICON.chevron));
      row.appendChild(twisty);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'buret-tree-twisty buret-tree-twisty-empty';
      row.appendChild(spacer);
    }

    const bar = document.createElement('span');
    bar.className = 'buret-tree-bar';
    bar.style.background = SCENE_TREE_TYPE_COLOR[node.typeClass] || SCENE_TREE_TYPE_COLOR.Object;
    row.appendChild(bar);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'buret-tree-trigger';
    trigger.dataset.sceneTreeAction = 'focus';
    const label = document.createElement('span');
    label.className = 'buret-tree-label';
    label.textContent = node.label;
    trigger.appendChild(label);
    if (node.note) {
      const note = document.createElement('span');
      note.className = 'buret-tree-note';
      note.textContent = node.note;
      trigger.appendChild(note);
    }
    trigger.title = node.note ? `${node.label} — ${node.note}` : node.label;
    row.appendChild(trigger);

    const actions = document.createElement('span');
    actions.className = 'buret-tree-actions';
    if (node.colorable && node.value !== null) {
      const dot = document.createElement('span');
      dot.className = 'buret-tree-dot';
      dot.style.background = sceneTreeColorHex(node.value);
      actions.appendChild(dot);
    }
    actions.appendChild(sceneTreeActionButton('remove', `Remove ${node.label}`, SCENE_TREE_ICON.trash));
    actions.appendChild(sceneTreeActionButton(
      'visibility',
      node.hidden ? `Show ${node.label}` : `Hide ${node.label}`,
      node.hidden ? SCENE_TREE_ICON.eyeOff : SCENE_TREE_ICON.eye
    ));
    row.appendChild(actions);
    item.appendChild(row);

    if (expandable) {
      const content = document.createElement('div');
      content.className = 'buret-tree-content';
      const inner = document.createElement('div');
      inner.className = 'buret-tree-content-inner';
      for (const child of node.children) inner.appendChild(sceneTreeNodeElement(child));
      content.appendChild(inner);
      item.appendChild(content);
    }
    return item;
  }

  // Coalesced with a timer rather than an animation frame: a preview can be laid out
  // while its tab is hidden, and requestAnimationFrame never fires there, which
  // would leave the panel empty until the tab was looked at.
  function scheduleSceneTreeRender() {
    if (sceneTreeRenderHandle) return;
    sceneTreeRenderHandle = window.setTimeout(() => {
      sceneTreeRenderHandle = 0;
      renderSceneTree();
    }, 0);
  }

  function renderSceneTree() {
    const toggle = document.getElementById('buret-scene-tree-toggle');
    const panel = document.getElementById('buret-scene-tree');
    const body = panel?.querySelector('[data-buret-scene-tree-body]');
    if (!toggle || !panel || !body) return;
    const nodes = sceneTreeNodes(activeMolstarViewer());
    reconcileSceneTreeExpansion(nodes);
    const available = nodes.length > 0;
    toggle.classList.toggle('hidden', !available);
    if (!available) {
      setSceneTreeOpen(false);
      body.replaceChildren();
      updateViewportCornerLayout();
      return;
    }
    const root = document.createElement('div');
    root.className = 'buret-tree';
    const highlight = document.createElement('div');
    highlight.className = 'buret-tree-highlight';
    root.appendChild(highlight);
    for (const node of nodes) root.appendChild(sceneTreeNodeElement(node));
    body.replaceChildren(root);
    requestAnimationFrame(() => root.classList.add('buret-tree-animate'));
    const hovered = sceneTreeHoverRef
      ? root.querySelector(`.buret-tree-row[data-ref="${CSS.escape(sceneTreeHoverRef)}"]`)
      : null;
    moveSceneTreeHighlight(hovered, { instant: true });
  }

  // One block slides between rows instead of every row painting its own hover fill.
  function moveSceneTreeHighlight(row, options = {}) {
    const highlight = document.querySelector('#buret-scene-tree .buret-tree-highlight');
    if (!highlight) return;
    const root = highlight.parentElement;
    if (!row || !root) {
      sceneTreeHoverRef = '';
      highlight.classList.remove('buret-tree-highlight-active');
      return;
    }
    sceneTreeHoverRef = row.dataset.ref || '';
    const rootRect = root.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    highlight.classList.toggle('buret-tree-highlight-instant', options.instant === true);
    highlight.style.width = `${rowRect.width}px`;
    highlight.style.height = `${rowRect.height}px`;
    highlight.style.transform = `translate(${rowRect.left - rootRect.left}px, ${rowRect.top - rootRect.top}px)`;
    highlight.classList.add('buret-tree-highlight-active');
    if (options.instant === true) {
      requestAnimationFrame(() => highlight.classList.remove('buret-tree-highlight-instant'));
    }
  }

  function setSceneTreeOpen(open) {
    const toggle = document.getElementById('buret-scene-tree-toggle');
    const panel = document.getElementById('buret-scene-tree');
    if (!toggle || !panel) return;
    panel.classList.toggle('hidden', !open);
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      // Always reopens anchored under the toggle; dragging moves it for as long as
      // it stays open, it does not become the panel's new home.
      panel.style.removeProperty('left');
      panel.style.removeProperty('top');
    } else {
      moveSceneTreeHighlight(null);
      closeSceneTreeMenu();
    }
    updateViewportCornerLayout();
  }

  // Flips the row in place rather than re-rendering: a rebuilt node would start at
  // its final height and the expand transition would never run.
  function toggleSceneTreeNode(ref) {
    const open = !sceneTreeExpandedRefs.has(ref);
    if (open) sceneTreeExpandedRefs.add(ref);
    else sceneTreeExpandedRefs.delete(ref);
    const item = document.querySelector(`#buret-scene-tree .buret-tree-item[data-ref="${CSS.escape(ref)}"]`);
    if (!item) {
      renderSceneTree();
      return;
    }
    item.dataset.open = open ? 'true' : 'false';
    const twisty = item.querySelector(':scope > .buret-tree-row > .buret-tree-twisty');
    const label = item.querySelector(':scope > .buret-tree-row .buret-tree-label')?.textContent || '';
    twisty?.setAttribute('aria-expanded', open ? 'true' : 'false');
    twisty?.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} ${label}`);
  }

  // Mol* hides a cell by walking its subtree, so a representation stays hidden
  // while its component is hidden and comes back with it.
  function sceneTreeSubtreeRefs(state, ref) {
    const { children } = sceneTreeChildRefs(state);
    const refs = [];
    const stack = [ref];
    while (stack.length) {
      const current = stack.pop();
      refs.push(current);
      for (const child of children.get(current) || []) stack.push(child);
    }
    return refs;
  }

  function sceneTreeCellHidden(state, ref) {
    return state?.cells?.get(ref)?.state?.isHidden === true;
  }

  function toggleSceneTreeVisibility(ref) {
    const state = activeMolstarViewer()?.plugin?.state?.data;
    if (typeof state?.updateCellState !== 'function') return;
    const hidden = !sceneTreeCellHidden(state, ref);
    for (const target of sceneTreeSubtreeRefs(state, ref)) {
      state.updateCellState(target, { isHidden: hidden });
    }
    scheduleSceneTreeRender();
  }

  async function removeSceneTreeNode(ref) {
    const state = activeMolstarViewer()?.plugin?.state?.data;
    if (typeof state?.build !== 'function') return;
    try {
      await state.build().delete(ref).commit();
    } catch (error) {
      debug('scene tree remove failed: ' + (error && error.message || String(error)));
    }
    scheduleSceneTreeRender();
  }

  function focusSceneTreeNode(ref) {
    const plugin = activeMolstarViewer()?.plugin;
    const data = plugin?.state?.data?.cells?.get(ref)?.obj?.data;
    const sphere = data?.boundingSphere || data?.sourceData?.boundingSphere;
    if (!sphere || typeof plugin?.managers?.camera?.focusSphere !== 'function') return;
    try {
      plugin.managers.camera.focusSphere(sphere, { durationMs: 250 });
    } catch (error) {
      debug('scene tree focus failed: ' + (error && error.message || String(error)));
    }
  }

  async function applySceneTreeColorTheme(ref, theme, value) {
    const viewer = activeMolstarViewer();
    const manager = viewer?.plugin?.managers?.structure?.component;
    const components = sceneTreeColorTargets(viewer).get(ref) || [];
    if (typeof manager?.updateRepresentationsTheme !== 'function' || !components.length) return;
    const params = theme === 'default'
      ? { color: 'default' }
      : { color: theme, ...(theme === 'uniform' ? { colorParams: { value } } : {}) };
    try {
      await manager.updateRepresentationsTheme(components, params);
    } catch (error) {
      debug('scene tree colour failed: ' + (error && error.message || String(error)));
    }
    scheduleSceneTreeRender();
  }

  function sceneTreeColorThemes(viewer) {
    const types = viewer?.plugin?.representation?.structure?.themes?.colorThemeRegistry?.types;
    if (!Array.isArray(types)) return [];
    return types
      .map(entry => ({ name: String(entry?.[0] || ''), label: String(entry?.[1] || entry?.[0] || '') }))
      .filter(entry => entry.name);
  }

  function sceneTreeCellActions(viewer, ref) {
    const state = viewer?.plugin?.state?.data;
    const cell = state?.cells?.get(ref);
    if (!cell?.obj || typeof state.actions?.fromCell !== 'function') return [];
    try {
      return state.actions.fromCell(cell, viewer.plugin)
        .map(action => ({ action, label: String(action?.definition?.display?.name || '') }))
        .filter(entry => entry.label);
    } catch (error) {
      debug('scene tree actions failed: ' + (error && error.message || String(error)));
      return [];
    }
  }

  // Mol* puts a parameter form in front of every action. These run straight on the
  // action's own defaults, which is what makes the menu usable rather than a form.
  function sceneTreeActionDefaults(action, viewer, cell) {
    const definition = action?.definition;
    const params = typeof definition?.params === 'function'
      ? definition.params(cell?.obj, viewer?.plugin)
      : definition?.params;
    if (!params || typeof params !== 'object') return {};
    const values = {};
    for (const [key, entry] of Object.entries(params)) values[key] = entry?.defaultValue;
    return values;
  }

  async function applySceneTreeAction(ref, index) {
    const viewer = activeMolstarViewer();
    const state = viewer?.plugin?.state?.data;
    const entry = sceneTreeCellActions(viewer, ref)[index];
    if (!entry || typeof state?.applyAction !== 'function') return;
    try {
      await viewer.plugin.runTask(
        state.applyAction(entry.action, sceneTreeActionDefaults(entry.action, viewer, state.cells.get(ref)), ref)
      );
    } catch (error) {
      debug('scene tree action failed: ' + (error && error.message || String(error)));
    }
    scheduleSceneTreeRender();
  }

  function closeSceneTreeMenu() {
    sceneTreeMenuRef = '';
    document.getElementById('buret-scene-tree-menu')?.remove();
  }

  function sceneTreeNodeByRef(nodes, ref) {
    for (const node of nodes) {
      if (node.ref === ref) return node;
      const found = sceneTreeNodeByRef(node.children, ref);
      if (found) return found;
    }
    return null;
  }

  function sceneTreeMenuButton(label, action, extra = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.dataset.sceneTreeAction = action;
    Object.assign(button.dataset, extra);
    button.textContent = label;
    return button;
  }

  function openSceneTreeMenu(ref, clientX, clientY) {
    closeSceneTreeMenu();
    const viewer = activeMolstarViewer();
    const node = sceneTreeNodeByRef(sceneTreeNodes(viewer), ref);
    if (!node) return;
    sceneTreeMenuRef = ref;
    const menu = document.createElement('div');
    menu.id = 'buret-scene-tree-menu';
    menu.className = 'buret-tree-menu';
    menu.dataset.ref = ref;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', `${node.label} actions`);

    const title = document.createElement('div');
    title.className = 'buret-tree-menu-title';
    title.textContent = node.label;
    menu.appendChild(title);

    menu.appendChild(sceneTreeMenuButton('Focus', 'focus'));
    menu.appendChild(sceneTreeMenuButton(node.hidden ? 'Show' : 'Hide', 'visibility'));

    if (node.colorable) {
      const divider = document.createElement('div');
      divider.className = 'buret-tree-menu-divider';
      menu.appendChild(divider);

      const themeRow = document.createElement('label');
      themeRow.className = 'buret-tree-menu-field';
      const themeLabel = document.createElement('span');
      themeLabel.textContent = 'Colour';
      const select = document.createElement('select');
      select.className = 'buret-select';
      select.dataset.sceneTreeColorTheme = '1';
      for (const theme of sceneTreeColorThemes(viewer)) {
        const option = document.createElement('option');
        option.value = theme.name;
        option.textContent = theme.label;
        select.appendChild(option);
      }
      if (node.theme) select.value = node.theme;
      themeRow.append(themeLabel, select);
      menu.appendChild(themeRow);

      const swatches = document.createElement('div');
      swatches.className = 'buret-tree-swatches';
      for (const entry of SCENE_TREE_UNIFORM_COLORS) {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'buret-tree-swatch';
        swatch.dataset.sceneTreeAction = 'uniform-color';
        swatch.dataset.sceneTreeColor = String(entry.value);
        swatch.style.background = sceneTreeColorHex(entry.value);
        swatch.setAttribute('aria-label', `${entry.label} uniform colour`);
        swatch.setAttribute('aria-pressed', node.theme === 'uniform' && node.value === entry.value ? 'true' : 'false');
        swatch.title = entry.label;
        swatches.appendChild(swatch);
      }
      menu.appendChild(swatches);
    }

    const actions = sceneTreeCellActions(viewer, ref);
    if (actions.length) {
      const actionsDivider = document.createElement('div');
      actionsDivider.className = 'buret-tree-menu-divider';
      menu.appendChild(actionsDivider);
      const actionsTitle = document.createElement('div');
      actionsTitle.className = 'buret-tree-menu-title';
      actionsTitle.textContent = 'Apply action';
      menu.appendChild(actionsTitle);
      actions.forEach((entry, index) => {
        menu.appendChild(sceneTreeMenuButton(entry.label, 'apply-action', { sceneTreeActionIndex: String(index) }));
      });
    }

    const divider = document.createElement('div');
    divider.className = 'buret-tree-menu-divider';
    menu.appendChild(divider);
    menu.appendChild(sceneTreeMenuButton('Remove', 'remove'));

    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const left = Math.max(6, Math.min(clientX, window.innerWidth - rect.width - 6));
    const top = Math.max(6, Math.min(clientY, window.innerHeight - rect.height - 6));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }

  function runSceneTreeAction(action, ref, control) {
    if (action === 'expand') toggleSceneTreeNode(ref);
    else if (action === 'visibility') toggleSceneTreeVisibility(ref);
    else if (action === 'focus') focusSceneTreeNode(ref);
    else if (action === 'remove') removeSceneTreeNode(ref);
    else if (action === 'uniform-color') {
      applySceneTreeColorTheme(ref, 'uniform', Number(control.dataset.sceneTreeColor));
    } else if (action === 'apply-action') {
      applySceneTreeAction(ref, Number(control.dataset.sceneTreeActionIndex));
    }
  }

  function onSceneTreeClick(event) {
    const control = event.target.closest('[data-scene-tree-action]');
    if (!control) return;
    const ref = control.closest('[data-ref]')?.dataset.ref;
    if (!ref) return;
    const action = control.dataset.sceneTreeAction;
    runSceneTreeAction(action, ref, control);
    if (control.closest('#buret-scene-tree-menu') && action !== 'uniform-color') closeSceneTreeMenu();
  }

  function onSceneTreeContextMenu(event) {
    const row = event.target.closest('.buret-tree-row');
    if (!row?.dataset.ref) return;
    event.preventDefault();
    openSceneTreeMenu(row.dataset.ref, event.clientX, event.clientY);
  }

  function moveViewportPanel(panel, left, top) {
    const rect = panel.getBoundingClientRect();
    const maxLeft = Math.max(6, window.innerWidth - rect.width - 6);
    const maxTop = Math.max(6, window.innerHeight - rect.height - 6);
    panel.style.left = `${Math.round(Math.max(6, Math.min(left, maxLeft)))}px`;
    panel.style.top = `${Math.round(Math.max(6, Math.min(top, maxTop)))}px`;
    updateViewportCornerLayout();
  }

  // Four things want the top-left corner: the Mol* left panel, our corner buttons,
  // the panels they open, and the Mol* trajectory/animation controls. They queue up
  // left to right, and each one that disappears gives its space back.
  // Mol* re-renders its regions asynchronously after a layout change, so rather than
  // guessing a delay the measurement is driven by the DOM guard's observer below.
  // Timers rather than animation frames: a preview can be laid out while its tab is
  // hidden, where frames never run.
  function scheduleViewportCornerLayout() {
    if (viewportCornerLayoutHandle) return;
    viewportCornerLayoutHandle = window.setTimeout(() => {
      viewportCornerLayoutHandle = 0;
      updateViewportCornerLayout();
    }, 0);
  }

  function updateViewportCornerLayout() {
    const style = document.documentElement.style;
    const corner = document.getElementById('buret-viewport-corner');
    const sceneTree = document.getElementById('buret-scene-tree');

    const cornerWidth = corner?.getBoundingClientRect().width || 0;
    document.body?.classList.toggle('buret-viewport-corner-active', cornerWidth > 0);

    // The Mol* sequence strip owns the whole top edge, so everything anchored there
    // — the corner button, its panel and the toolbar — steps below it.
    const topRegion = document.querySelector('.msp-layout-region.msp-layout-top');
    const topRect = topRegion?.offsetParent === null ? null : topRegion?.getBoundingClientRect();
    const topInset = topRect?.height ? `${Math.round(topRect.height)}px` : '';
    if (style.getPropertyValue('--buret-viewport-top-inset') !== topInset) {
      if (topInset) style.setProperty('--buret-viewport-top-inset', topInset);
      else style.removeProperty('--buret-viewport-top-inset');
      // The toolbar carries an inline position, so the CSS variable alone cannot
      // move it; re-place it whenever it still sits where we put it.
      const toolbar = document.getElementById('buret-toolbar');
      if (toolbar?.dataset.defaultPosition === '1') applyDefaultToolbarPosition(toolbar);
    }

    const leftPanel = document.querySelector('.msp-layout-region.msp-layout-left');
    const leftRect = leftPanel?.offsetParent === null ? null : leftPanel?.getBoundingClientRect();
    if (leftRect?.width) style.setProperty('--buret-corner-left', `${Math.round(leftRect.right + 12)}px`);
    else style.removeProperty('--buret-corner-left');

    const controls = document.querySelector('.msp-plugin .msp-viewport-top-left-controls');
    if (!controls) {
      style.removeProperty('--buret-corner-inset');
      return;
    }
    let edge = cornerWidth ? corner.getBoundingClientRect().right + 8 : null;
    if (sceneTree && !sceneTree.classList.contains('hidden')) {
      const rect = sceneTree.getBoundingClientRect();
      if (rect.top < 56) edge = Math.max(edge ?? 0, rect.right + 10);
    }
    if (edge === null) {
      style.removeProperty('--buret-corner-inset');
      return;
    }
    // The controls sit inside the Mol* main region, so the offset is measured from
    // that region rather than from the window.
    const origin = controls.offsetParent?.getBoundingClientRect().left ?? 0;
    style.setProperty('--buret-corner-inset', `${Math.round(Math.max(10, edge - origin))}px`);
  }

  function initViewportPanelDrag(panel) {
    const handle = panel.querySelector('[data-buret-panel-handle]');
    if (!handle) return;
    let drag = null;
    const onPointerDown = event => {
      if (event.button !== 0 || event.target.closest('button, input, select')) return;
      const rect = panel.getBoundingClientRect();
      drag = { pointerId: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
      try { handle.setPointerCapture(event.pointerId); } catch (_) {}
      panel.classList.add('buret-viewport-panel-dragging');
      event.preventDefault();
    };
    const onPointerMove = event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      moveViewportPanel(panel, event.clientX - drag.dx, event.clientY - drag.dy);
      event.preventDefault();
    };
    const finishDrag = event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      try { handle.releasePointerCapture(event.pointerId); } catch (_) {}
      panel.classList.remove('buret-viewport-panel-dragging');
      drag = null;
    };
    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', finishDrag);
    handle.addEventListener('pointercancel', finishDrag);
  }

  function initSceneTree(viewer) {
    const toggle = document.getElementById('buret-scene-tree-toggle');
    const panel = document.getElementById('buret-scene-tree');
    if (!toggle || !panel) return;
    if (toggle.dataset.sceneTreeBound !== '1') {
      toggle.dataset.sceneTreeBound = '1';
      toggle.addEventListener('click', () => setSceneTreeOpen(panel.classList.contains('hidden')));
      panel.querySelector('[data-buret-action="scene-tree-close"]')
        ?.addEventListener('click', () => setSceneTreeOpen(false));
      // The context menu is portalled to <body> so the scrolling panel cannot clip
      // it, which means the click handler has to live on the document.
      document.addEventListener('click', onSceneTreeClick);
      panel.addEventListener('contextmenu', onSceneTreeContextMenu);
      panel.addEventListener('pointerover', event => {
        moveSceneTreeHighlight(event.target.closest('.buret-tree-row'));
      });
      panel.addEventListener('pointerleave', () => moveSceneTreeHighlight(null));
      panel.addEventListener('focusin', event => {
        moveSceneTreeHighlight(event.target.closest('.buret-tree-row'));
      });
      initViewportPanelDrag(panel);
      window.addEventListener('resize', updateViewportCornerLayout);
      document.addEventListener('click', event => {
        const menu = document.getElementById('buret-scene-tree-menu');
        if (menu && !menu.contains(event.target)) closeSceneTreeMenu();
      }, true);
      document.addEventListener('change', event => {
        const select = event.target.closest('[data-scene-tree-color-theme]');
        const ref = select?.closest('[data-ref]')?.dataset.ref;
        if (select && ref) applySceneTreeColorTheme(ref, select.value, null);
      });
      document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        if (document.getElementById('buret-scene-tree-menu')) closeSceneTreeMenu();
        else if (!panel.classList.contains('hidden')) setSceneTreeOpen(false);
      });
    }
    sceneTreeStateDisposer?.();
    sceneTreeStateDisposer = null;
    const events = viewer?.plugin?.state?.data?.events;
    const subscriptions = [
      events?.changed?.subscribe?.(scheduleSceneTreeRender),
      events?.cell?.stateUpdated?.subscribe?.(scheduleSceneTreeRender)
    ].filter(Boolean);
    if (subscriptions.length) {
      sceneTreeStateDisposer = () => subscriptions.forEach(subscription => subscription?.unsubscribe?.());
    }
    scheduleSceneTreeRender();
  }


  function updateThemeButton() {
    const button = document.querySelector('#buret-toolbar [data-buret-action="theme"]');
    if (!button) return;
    const isDark = resolveViewerTheme() === 'dark';
    const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';
    setButtonLabel(button, isDark ? 'Light' : 'Dark');
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    setTooltipLabel(button, label);
    button.classList.toggle('active', !isDark);
  }

  function setButtonLabel(button, label) {
    const tooltip = button.querySelector('.buret-tooltip');
    button.textContent = label;
    if (tooltip) button.append(tooltip);
  }

  function setTooltipLabel(root, label) {
    const tooltip = root?.querySelector?.('.buret-tooltip');
    if (tooltip) tooltip.textContent = label;
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


  function previewReadyPayload(config = activeConfig || window.BurreteConfig || {}, extra = {}) {
    const cfg = config && typeof config === 'object' ? config : {};
    return {
      mode: cfg.mode || 'structure',
      renderer: normalizeRenderer(extra.renderer || cfg.renderer),
      format: cfg.molstarFormat || cfg.format || '',
      sourceExtension: cfg.sourceExtension || '',
      trajectoryFrameCount: Number(cfg.trajectoryFrameCount || 0),
      externalArtifact: Boolean(cfg.externalArtifact || extra.externalArtifact),
      ...extra
    };
  }

  function molstarReadyPayload(config, prepared, extra = {}) {
    const poseCount = Number(prepared?.poseCount || prepared?.sdfPoseRecordCount || prepared?.xyzFrameCount || config?.trajectoryFrameCount || 0);
    return previewReadyPayload(config, {
      renderer: 'molstar',
      molstarStructureCount: Number(extra.molstarStructureCount || 0),
      poseCount: Number.isFinite(poseCount) ? poseCount : 0,
      trajectoryFrameCount: Math.max(Number(config?.trajectoryFrameCount || 0), Number.isFinite(poseCount) ? poseCount : 0),
      ...extra
    });
  }

  function currentMolstarStructureCount(viewer = activeViewer) {
    try {
      return Array.from(viewer?.plugin?.managers?.structure?.hierarchy?.current?.structures || []).length;
    } catch (_) {
      return 0;
    }
  }

  function hideStatus(payload = null) {
    post('ready', 'ready', payload || previewReadyPayload());
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

  function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, offset + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  function base64ToText(base64) {
    const bytes = base64ToBytes(base64);
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }

  function appendCacheBuster(url, cb) {
    if (String(url || '').startsWith('asset://')) return url;
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

  function installNativeRuntimeFileBridge() {
    if (typeof window.BurreteReceiveNativeRuntimeFile === 'function') return;
    window.BurreteReceiveNativeRuntimeFile = function (payload) {
      window.dispatchEvent(new CustomEvent('BurreteNativeRuntimeFileReady', { detail: payload || {} }));
    };
  }

  function requestRuntimeFileFromNative(path) {
    installNativeRuntimeFileBridge();
    return new Promise((resolve, reject) => {
      if (typeof window.__mqlPost !== 'function') {
        reject(new Error('Native Quick Look bridge is unavailable.'));
        return;
      }
      const requestToken = 'native-file-' + Math.random().toString(36).slice(2);
      let settled = false;
      const cleanup = () => {
        window.removeEventListener('BurreteNativeRuntimeFileReady', onReady);
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
        if (typeof payload.base64 !== 'string' || payload.base64.length === 0) {
          finish(reject, new Error('Native Quick Look bridge returned an empty runtime file.'));
          return;
        }
        finish(resolve, base64ToBytes(payload.base64));
      };
      const timeout = setTimeout(() => {
        finish(reject, new Error('Timed out while waiting for runtime file from native Quick Look.'));
      }, 10000);
      window.addEventListener('BurreteNativeRuntimeFileReady', onReady);
      try {
        window.__mqlPost('requestRuntimeFile', 'requestRuntimeFile', { requestToken, path });
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

  async function loadPayloadBytes(path, cb) {
    const requestURL = appendCacheBuster(path, cb);
    try {
      const response = await fetch(requestURL, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Could not load staged payload: HTTP ' + response.status);
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      debug('fetch staged payload failed, falling back to XMLHttpRequest: ' + (error && error.message || String(error)));
    }
    try {
      return await loadArrayBufferViaXHR(requestURL);
    } catch (error) {
      debug('XMLHttpRequest staged payload failed, requesting native runtime file: ' + (error && error.message || String(error)));
    }
    return requestRuntimeFileFromNative(path);
  }

  async function loadStagedEntryData(entry, cb) {
    if (typeof entry?.dataBase64 === 'string' && entry.dataBase64.trim()) {
      return entry.binary ? base64ToBytes(entry.dataBase64) : base64ToText(entry.dataBase64);
    }
    const path = typeof entry?.path === 'string' ? entry.path.trim() : '';
    if (!path) throw new Error('Staged Mol* entry is missing path.');
    const bytes = await loadPayloadBytes(path, cb);
    return entry.binary ? bytes : new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }

  function isStructureSceneEntry(entry) {
    return entry?.representation === 'structure-scene-entry';
  }

  function structureSceneEntriesFromConfig(config) {
    const entries = Array.isArray(config?.stagedEntries) ? config.stagedEntries : [];
    return entries
      .filter(entry => isStructureSceneEntry(entry) && entry?.binary !== true && typeof entry?.dataBase64 === 'string' && entry.dataBase64.trim())
      .map((entry, index) => ({
        data: base64ToText(entry.dataBase64),
        format: normalizeFormat(entry.format || 'pdb'),
        label: entry.label || `Structure ${index + 1}`,
        sourcePath: config?.sourcePath || ''
      }))
      .filter(entry => entry.data.trim());
  }

  function normalizeFormat(format) {
    const value = String(format || 'auto').toLowerCase();
    if (value === 'cifcore' || value === 'corecif' || value === 'core-cif') return 'cifCore';
    if (value === 'cif' || value === 'mmcif' || value === 'mcif') return 'mmcif';
    if (value === 'bcif' || value === 'binarycif') return 'mmcif';
    if (value === 'sd') return 'sdf';
    if (value === 'xyzr') return 'xyz';
    if (value === 'nc' || value === 'ncdf' || value === 'netcdf' || value === 'ncrst') return 'nctraj';
    if (value === 'molviewspec' || value === 'mol-view-spec') return 'mvsj';
    return value;
  }

  function isMolViewSpecFormat(format) {
    return format === 'mvsj' || format === 'mvsx';
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
      waterRepresentation: 'line',
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

  function dockingSceneMode(config) {
    const mode = String(config?.docking?.sceneMode || config?.structureSceneMode || '').trim();
    return mode === 'structureAll' || mode === 'structurePoses' ? mode : '';
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

  function trajectoryControlStorageKey(config, prepared) {
    if (prepared?.kind === 'docking') return dockingPoseStorageKey(config);
    const documentId = String(config?.documentId || '').trim();
    if (documentId) return `burrete.trajectoryControl.${documentId}`;
    const fallback = `${config?.label || 'active'}:${window.location.pathname}:${window.location.search}`;
    return `burrete.trajectoryControl.fallback-${stableTextHash(fallback)}`;
  }

  function readTrajectoryControlIndex(config, prepared, poseCount) {
    if (prepared?.kind === 'docking') return readDockingPoseIndex(config, poseCount);
    if (prepared?.sdfPoseMode === 'single' && prepared?.nativeTrajectoryControls === true) {
      const value = Number(prepared?.activePose || 0);
      return Math.max(0, Math.min(poseCount - 1, Number.isFinite(value) ? Math.trunc(value) : 0));
    }
    let value = Number(config?.activeModel || 0);
    try {
      const stored = sessionStorage.getItem(trajectoryControlStorageKey(config, prepared));
      if (stored !== null) value = Number(stored);
    } catch (_) {}
    if (!Number.isFinite(value)) value = 0;
    return Math.max(0, Math.min(poseCount - 1, Math.trunc(value)));
  }

  const DEFAULT_TRAJECTORY_LOOP_FPS = 20;
  const NATIVE_TRAJECTORY_LOOP_SKIP_FPS_THRESHOLD = 25;

  function trajectoryLoopFpsStorageKey(config, prepared) {
    return `${trajectoryControlStorageKey(config, prepared)}.fps.v1`;
  }

  function minimumTrajectoryLoopDelay(prepared) {
    return prepared?.nativeTrajectoryControls ? 0 : 300;
  }

  function minimumTrajectoryLoopTimerDelay(prepared) {
    return prepared?.nativeTrajectoryControls ? 0 : 60;
  }

  function trajectoryFpsToDelay(value, prepared) {
    const fps = Number(value);
    const clamped = Number.isFinite(fps) ? Math.max(fps, 0.1) : DEFAULT_TRAJECTORY_LOOP_FPS;
    return Math.max(minimumTrajectoryLoopDelay(prepared), 1000 / clamped);
  }

  function trajectoryDelayToFps(delayMs, prepared) {
    const delay = Number(delayMs);
    if (!Number.isFinite(delay) || delay <= 0) return DEFAULT_TRAJECTORY_LOOP_FPS;
    return Math.max(1000 / delay, 0.1);
  }

  function formatTrajectoryFps(value) {
    const fps = Number(value);
    if (!Number.isFinite(fps)) return String(DEFAULT_TRAJECTORY_LOOP_FPS);
    return String(Math.round(fps * 100) / 100);
  }

  function formatTrajectoryTimeNs(timePs) {
    const ns = Number(timePs) / 1000;
    if (!Number.isFinite(ns)) return null;
    const abs = Math.abs(ns);
    const decimals = abs >= 100 ? 1 : abs >= 1 ? 2 : abs >= 0.001 ? 3 : 6;
    return String(Number(ns.toFixed(decimals)));
  }

  function pdbTrajectoryTimesPs(data) {
    const text = typeof data === 'string' ? data : '';
    if (!text.includes('time_ps=')) return [];
    const times = [];
    for (const line of text.split(/\r?\n/u)) {
      if (!line.startsWith('REMARK') || !line.includes('time_ps=')) continue;
      const match = line.match(/\btime_ps=([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)/u);
      if (!match) continue;
      const timePs = Number(match[1]);
      if (Number.isFinite(timePs)) times.push(timePs);
    }
    return times;
  }

  function trajectoryTimesPsForPrepared(prepared) {
    if (!prepared || normalizeFormat(prepared.format) !== 'pdb') return [];
    return pdbTrajectoryTimesPs(prepared.data);
  }

  function trajectoryPoseLabel(prepared, controlLabel, activePose) {
    const indexText = `${activePose + 1}/${prepared.poseCount}`;
    const timeNs = formatTrajectoryTimeNs(prepared?.trajectoryTimesPs?.[activePose]);
    return timeNs ? `Time ${timeNs} ns - ${indexText}` : `${controlLabel} ${activePose + 1} / ${prepared.poseCount}`;
  }

  function readTrajectoryLoopFps(config, prepared) {
    try {
      const stored = Number(localStorage.getItem(trajectoryLoopFpsStorageKey(config, prepared)));
      if (Number.isFinite(stored) && stored > 0) return Math.max(stored, 0.1);
    } catch (_) {}
    return DEFAULT_TRAJECTORY_LOOP_FPS;
  }

  function trajectoryControlsForPrepared(prepared) {
    if (prepared?.kind === 'sdf-collection') {
      const poseCount = Number(prepared?.poseCount || prepared?.sdfPoseRecordCount || 0);
      if (!Number.isFinite(poseCount) || poseCount <= 1) return null;
      return {
        kind: 'sdf-collection',
        activePose: readTrajectoryControlIndex(activeConfig, prepared, poseCount),
        poseCount,
        nativeTrajectoryControls: false,
        ligandLabel: prepared?.label || activeConfig?.label || 'Mol* molecule collection',
        controlLabel: prepared?.controlLabel || 'Molecule',
        sdfPoseOverlayAvailable: true,
        sdfPoseRecordCount: poseCount,
        collectionResidues: prepared?.collectionResidues || [],
        collectionSinglePdbs: prepared?.collectionSinglePdbs || []
      };
    }
    if (prepared?.kind === 'docking' && prepared?.sdfPoseOverlayAvailable === true) {
      const poseCount = Number(prepared?.poseCount || 0);
      if (!Number.isFinite(poseCount) || poseCount <= 1) return null;
      return {
        kind: 'docking',
        activePose: readTrajectoryControlIndex(activeConfig, prepared, poseCount),
        poseCount,
        nativeTrajectoryControls: false,
        ligandLabel: prepared?.ligandLabel || activeConfig?.label || 'Docking poses',
        controlLabel: prepared?.controlLabel || 'Pose',
        sdfPoseOverlayAvailable: true
      };
    }
    if (prepared?.sdfPoseMode === 'all' || prepared?.pdbModelMode === 'all') {
      const poseCount = Number(prepared?.xyzFrameCount || prepared?.sdfPoseRecordCount || prepared?.pdbModelCount || activeConfig?.trajectoryFrameCount || 0);
      return {
        kind: 'trajectory-overlay',
        activePose: 0,
        poseCount: Number.isFinite(poseCount) && poseCount > 0 ? poseCount : 1,
        nativeTrajectoryControls: false,
        ligandLabel: prepared?.label || activeConfig?.label || 'Mol* overlay',
        controlLabel: prepared?.xyzFrameOverlayAvailable === true ? 'Frame' : prepared?.pdbModelOverlayAvailable === true ? 'Model' : 'Pose',
        sdfPoseOverlayAvailable: prepared?.sdfPoseOverlayAvailable === true,
        xyzFrameOverlayAvailable: prepared?.xyzFrameOverlayAvailable === true,
        pdbModelOverlayAvailable: prepared?.pdbModelOverlayAvailable === true,
        overlayOnly: true
      };
    }
    if (prepared?.xyzFrameOverlayAvailable === true) {
      const poseCount = Number(prepared?.poseCount || prepared?.xyzFrameCount || activeConfig?.trajectoryFrameCount || 0);
      if (!Number.isFinite(poseCount) || poseCount <= 1) return null;
      if (prepared?.nativeTrajectoryControls === true && activeSdfPoseMode !== 'all') {
        return {
          kind: 'trajectory',
          activePose: readTrajectoryControlIndex(activeConfig, prepared, poseCount),
          poseCount,
          nativeTrajectoryControls: true,
          trajectoryTimesPs: trajectoryTimesPsForPrepared(prepared),
          ligandLabel: prepared?.label || activeConfig?.label || 'Mol* XYZ frames',
          controlLabel: prepared?.controlLabel || 'Frame',
          xyzFrameOverlayAvailable: true
        };
      }
      return {
        kind: 'xyz-frame-overlay',
        activePose: readTrajectoryControlIndex(activeConfig, prepared, poseCount),
        poseCount,
        nativeTrajectoryControls: false,
        ligandLabel: prepared?.label || activeConfig?.label || 'Mol* XYZ frames',
        controlLabel: prepared?.controlLabel || 'Frame',
        xyzFrameOverlayAvailable: true
      };
    }
    const poseCount = Number(prepared?.poseCount || activeConfig?.trajectoryFrameCount || 0);
    const enabled = prepared?.nativeTrajectoryControls === true ||
      activeConfig?.trajectoryControls === true ||
      activeConfig?.sdfPosePager === true;
    if (!enabled || !Number.isFinite(poseCount) || poseCount <= 1) return null;
    const label = prepared?.controlLabel || (activeConfig?.sdfPosePager === true ? 'Pose' : 'Model');
    return {
      kind: 'trajectory',
      activePose: readTrajectoryControlIndex(activeConfig, prepared, poseCount),
      poseCount,
      nativeTrajectoryControls: prepared?.nativeTrajectoryControls === true,
      trajectoryTimesPs: trajectoryTimesPsForPrepared(prepared),
      ligandLabel: prepared?.label || activeConfig?.label || 'Mol* trajectory',
      controlLabel: label,
      sdfPoseOverlayAvailable: prepared?.sdfPoseOverlayAvailable === true,
      xyzFrameOverlayAvailable: prepared?.xyzFrameOverlayAvailable === true
    };
  }

  function isDockingCoordinateTrajectoryEntry(entry) {
    return DOCKING_COORDINATE_TRAJECTORY_FORMATS.has(normalizeFormat(entry?.format));
  }

  function dockingTrajectoryModelKind(entry) {
    const format = normalizeFormat(entry?.format);
    if (DOCKING_TOPOLOGY_TRAJECTORY_FORMATS.has(format)) return 'topology-data';
    if (DOCKING_MODEL_TRAJECTORY_FORMATS.has(format)) return 'model-data';
    return null;
  }

  function dockingTrajectoryPair(entries) {
    const coordinateEntry = entries.find(isDockingCoordinateTrajectoryEntry);
    if (!coordinateEntry) return null;
    const modelEntry = entries.find(entry => entry !== coordinateEntry && dockingTrajectoryModelKind(entry));
    if (!modelEntry) return null;
    return {
      modelEntry,
      modelKind: dockingTrajectoryModelKind(modelEntry),
      coordinateEntry
    };
  }

  function prepareDockingStructure(config) {
    const docking = config.docking || {};
    const payloads = window.BurreteDockingPayloads || {};
    const receptor = docking.receptor;
    if (!receptor) throw new Error('Docking view is missing a receptor.');
    const ligandSources = Array.isArray(docking.ligands) ? docking.ligands : [];
    const ligandPayloads = Array.isArray(payloads.ligands) ? payloads.ligands : [];
    const poses = [];
    const receptorEntry = {
      data: dockingPayloadData(receptor, payloads.receptor),
      format: normalizeFormat(receptor.format),
      label: receptor.label || 'Receptor',
      sourcePath: receptor.path || ''
    };
    const entries = [receptorEntry];
    ligandSources.forEach((source, ligandIndex) => {
      const data = dockingPayloadData(source, ligandPayloads[ligandIndex]);
      const format = normalizeFormat(source.format);
      if (format === 'sdf') {
        const records = splitSdfRecords(data);
        if (records.length > 1) {
          records.forEach((record, poseIndex) => {
            poses.push({
              data: `${record}\n$$$$\n`,
              format: 'sdf',
              label: `${source.label || `Ligand ${ligandIndex + 1}`} pose ${poseIndex + 1}`,
              sourcePath: source.path || '',
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
        sourcePath: source.path || '',
        ligandIndex,
        poseIndex: 0,
        poseCount: 1
      });
    });
    const trajectoryPair = dockingTrajectoryPair(entries);
    if (trajectoryPair) {
      return {
        kind: 'docking',
        label: config.label || 'Docking trajectory',
        activePose: readDockingPoseIndex(config, Number.MAX_SAFE_INTEGER),
        poseCount: 1,
        nativeTrajectoryControls: true,
        ligandLabel: trajectoryPair.coordinateEntry.label || 'Mol* trajectory',
        controlLabel: 'Frame',
        receptorEntry,
        poses,
        entries,
        trajectoryPair
      };
    }
    const sceneMode = dockingSceneMode(config);
    if (sceneMode) {
      const sceneReceptorEntry = sceneEntryWithPdbLigandAtomRecords(receptorEntry);
      const sceneEntries = [sceneReceptorEntry];
      ligandSources.forEach((source, ligandIndex) => {
        const data = dockingPayloadData(source, ligandPayloads[ligandIndex]);
        sceneEntries.push(sceneEntryWithPdbLigandAtomRecords({
          data,
          format: normalizeFormat(source.format),
          label: source.label || `Structure ${ligandIndex + 2}`,
          sourcePath: source.path || ''
        }));
      });
      const poses = sceneEntries.map((entry, poseIndex) => ({
        ...entry,
        ligandIndex: poseIndex,
        poseIndex,
        poseCount: sceneEntries.length
      }));
      const activePose = readDockingPoseIndex(config, poses.length);
      const allMode = activeSdfPoseMode === 'all';
      return {
        kind: 'docking',
        dockingSceneMode: sceneMode,
        label: config.label || 'Mol* scene',
        activePose,
        poseCount: poses.length,
        ligandLabel: poses[activePose].label,
        controlLabel: 'Structure',
        receptorEntry: sceneReceptorEntry,
        poses,
        entries: allMode ? sceneEntries : [poses[activePose]]
      };
    }
    if (poses.length === 0) throw new Error('Docking view has no ligand poses.');
    const activePose = readDockingPoseIndex(config, poses.length);
    return {
      kind: 'docking',
      label: config.label || 'Docking view',
      activePose,
      poseCount: poses.length,
      ligandLabel: poses[activePose].label,
      controlLabel: 'Pose',
      nativeTrajectoryControls: false,
      sdfPoseOverlayAvailable: poses.length > 1,
      receptorEntry,
      poses,
      entries: [
        entries[0],
        poses[activePose]
      ]
    };
  }

  function normalizeRenderer(renderer) {
    const value = String(renderer || 'molstar').toLowerCase();
    if (value === 'xyzrender-external' || value === 'external-xyzrender') return 'xyzrender-external';
    return 'molstar';
  }

  function structureDataForMolstar(config) {
    if (config.docking) {
      return prepareDockingStructure(config);
    }
    const normalized = normalizeFormat(config.format);
    const sourceFormat = normalizeFormat(config.sourceExtension || config.molstarFormat || config.format);
    const sceneEntries = structureSceneEntriesFromConfig(config);
    if (sceneEntries.length > 1) {
      return prepareStagedStructureScene(config, sceneEntries);
    }
    if (isMolViewSpecFormat(normalized)) {
      return {
        kind: 'mvs',
        data: rawStructureData(config),
        format: normalized,
        label: config.label || 'MolViewSpec scene'
      };
    }
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
    if (normalized === 'xyz') {
      return prepareXyzStructure(rawStructureData(config), config);
    }
    if (normalized === 'pdb' || normalized === 'pdbqt') {
      const preparedPdbModels = preparePdbModelStructure(rawStructureData(config), config, sourceFormat);
      if (preparedPdbModels) return preparedPdbModels;
    }

    return {
      data: rawStructureData(config),
      format: normalized,
      label: config.label || 'structure'
    };
  }

  const PDB_SCENE_BACKBONE_ATOM_NAMES = new Set(['N', 'CA', 'C', 'O']);
  const PDB_SCENE_POLYMER_VARIANT_RESIDUES = new Set([
    'HID', 'HIE', 'HIP', 'HSD', 'HSE', 'HSP',
    'ASH', 'GLH', 'LYN', 'ARN', 'CYX', 'CYM',
    'NTR', 'CTR', 'ACE', 'NME'
  ]);
  let pdbSceneIgnoredCompIdsCache = null;

  function sceneEntryWithPdbLigandAtomRecords(entry) {
    const normalized = normalizeFormat(entry?.format);
    if (normalized !== 'pdb' && normalized !== 'pdbqt') return entry;
    const data = pdbSceneDataWithLigandHetatmRecords(entry?.data);
    return data === entry?.data ? entry : { ...entry, data };
  }

  function pdbSceneDataWithLigandHetatmRecords(data) {
    if (typeof data !== 'string' || !data.includes('ATOM  ')) return data;
    const lines = data.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const residues = new Map();
    let modelIndex = 0;
    for (const line of lines) {
      if (line.startsWith('MODEL')) modelIndex += 1;
      if (!line.startsWith('ATOM  ')) continue;
      const compId = pdbSceneLineCompId(line);
      if (!compId || pdbSceneIgnoredCompIds().has(compId)) continue;
      const key = pdbSceneResidueKey(line, modelIndex);
      const atomName = line.slice(12, 16).trim().toUpperCase();
      const residue = residues.get(key) || { atomNames: new Set(), atomCount: 0 };
      residue.atomNames.add(atomName);
      residue.atomCount += 1;
      residues.set(key, residue);
    }
    const ligandResidues = new Set();
    for (const [key, residue] of residues) {
      const hasBackbone = Array.from(PDB_SCENE_BACKBONE_ATOM_NAMES).every(atomName => residue.atomNames.has(atomName));
      if (residue.atomCount >= 3 && !hasBackbone) ligandResidues.add(key);
    }
    if (!ligandResidues.size) return data;
    modelIndex = 0;
    return lines.map(line => {
      if (line.startsWith('MODEL')) modelIndex += 1;
      if (!line.startsWith('ATOM  ')) return line;
      return ligandResidues.has(pdbSceneResidueKey(line, modelIndex)) ? `HETATM${line.slice(6)}` : line;
    }).join('\n');
  }

  function pdbSceneIgnoredCompIds() {
    if (!pdbSceneIgnoredCompIdsCache) {
      pdbSceneIgnoredCompIdsCache = new Set([
        ...MOLSTAR_CONTEXT_STANDARD_RESIDUES,
        ...MOLSTAR_CONTEXT_WATER,
        ...MOLSTAR_CONTEXT_COMMON_IONS,
        ...PDB_SCENE_POLYMER_VARIANT_RESIDUES
      ]);
    }
    return pdbSceneIgnoredCompIdsCache;
  }

  function pdbSceneLineCompId(line) {
    return line.slice(17, 20).trim().toUpperCase();
  }

  function pdbSceneResidueKey(line, modelIndex) {
    return [
      modelIndex,
      pdbSceneLineCompId(line),
      line.slice(21, 22).trim(),
      line.slice(22, 26).trim(),
      line.slice(26, 27).trim()
    ].join('|');
  }

  function prepareStagedStructureScene(config, entries) {
    const activePose = readTrajectoryControlIndex(config, { kind: 'docking' }, entries.length);
    const allMode = activeSdfPoseMode === 'all';
    const poses = entries.map((entry, poseIndex) => ({
      ...entry,
      ligandIndex: poseIndex,
      poseIndex,
      poseCount: entries.length
    }));
    return {
      kind: 'docking',
      dockingSceneMode: 'structurePoses',
      label: config.label || 'Mol* scene',
      activePose,
      poseCount: poses.length,
      ligandLabel: poses[activePose]?.label || config.label || 'Structure',
      controlLabel: 'Structure',
      poses,
      entries: allMode ? poses : [poses[activePose]]
    };
  }

  function preparePdbModelStructure(data, config, sourceFormat) {
    const modelTexts = splitPdbModelTexts(data);
    const poseCount = modelTexts.length;
    if (poseCount <= 1) return null;
    const controlLabel = sourceFormat === 'pdbqt' ? 'Pose' : 'Model';
    const allMode = activeSdfPoseMode === 'all';
    return {
      data,
      format: 'pdb',
      label: config.label || 'structure',
      loadPreset: allMode ? 'all-models' : 'default',
      nativeTrajectoryControls: !allMode,
      poseCount,
      activePose: readTrajectoryControlIndex(config, { controlLabel }, poseCount),
      controlLabel,
      pdbModelOverlayAvailable: true,
      pdbModelCount: poseCount,
      pdbModelMode: allMode ? 'all' : 'single'
    };
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
      ? `<div class="buret-external-artifact-stage">${externalArtifactSheetHTML(externalArtifactBaseItemHTML(inlineSvg, config.label || 'xyzrender artifact'))}</div>`
      : `<div class="buret-external-artifact-stage">${externalArtifactSheetHTML(externalArtifactObjectHTML(artifact.path, config.label || 'xyzrender artifact'))}</div>`;
    container.innerHTML = `
      <div class="buret-external-artifact-root">
        ${content}
        <div class="buret-xyz-badge"><strong>External xyzrender</strong><span>SVG${preset}${elapsed}</span></div>
      </div>`;
    const root = container.querySelector('.buret-external-artifact-root');
    if (root) installExternalArtifactInteractions(root);
    initStaticRendererToolbar();
    setStatus(`[web] Rendered ${config.label || 'structure'} with external xyzrender`);
    setTimeout(() => hideStatus(previewReadyPayload(config, {
      renderer: 'xyzrender-external',
      externalArtifact: true,
      xyzrenderSvgBytes: inlineSvg ? inlineSvg.length : 0
    })), 450);
  }

  function initStaticRendererToolbar() {
    const toolbar = document.getElementById('buret-toolbar');
    if (!toolbar) return;
    toolbar.querySelectorAll('.buret-panel-toggle').forEach(button => { button.classList.add('hidden'); });
    bindThemeButton(toolbar, null);
    bindMolstarLassoButton(toolbar);
    bindMolstarLassoKeyboardButton(toolbar);
    installMolstarLassoSelection();
    installMolstarToolbarActionDelegates();
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

  function externalArtifactBaseItemHTML(content, label) {
    const safeLabel = escapeHTML(label || 'xyzrender artifact');
    return `
      <div class="buret-xyzrender-sheet-item buret-xyzrender-sheet-item-large buret-xyzrender-sheet-item-base" aria-label="${safeLabel}">
        <div class="buret-xyzrender-sheet-item-background"></div>
        <div class="buret-xyzrender-sheet-item-body">${content}</div>
        ${rotatableArtifactControlsHTML()}
      </div>`;
  }

  function externalArtifactSheetHTML(content) {
    return `<div class="buret-xyzrender-sheet" aria-label="xyzrender sheet overlays">${content}</div>`;
  }

  function rotatableArtifactControlsHTML() {
    const rotationDegrees = [-120, -90, -60, -45, -30, 0, 30, 45, 60, 90, 120, 150, 180];
    const degreeLabels = rotationDegrees
      .map(degree => `<span class="buret-xyzrender-rotate-label" data-buret-degree="${degree}" style="--buret-degree-angle: ${degree}deg; --buret-degree-counter-angle: ${-degree}deg;">${degree}°</span>`)
      .join('');
    const ticks = rotationDegrees
      .map(degree => `<span class="buret-xyzrender-rotate-tick" style="--buret-degree-angle: ${degree}deg;"></span>`)
      .join('');
    const resizeHandles = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']
      .map(handle => `<span class="buret-xyzrender-resize-handle buret-xyzrender-resize-${handle}" data-buret-resize-handle="${handle}" aria-hidden="true"></span>`)
      .join('');
    return `
      <div class="buret-xyzrender-rotate-hud" aria-hidden="true">
        <div class="buret-xyzrender-rotate-ring"></div>
        <div class="buret-xyzrender-rotate-needle"></div>
        <div class="buret-xyzrender-rotate-current"><span>0°</span></div>
        ${ticks}
        ${degreeLabels}
      </div>
      ${resizeHandles}
      <div class="buret-xyzrender-sheet-rotate-handle" aria-label="Rotate structure" title="Rotate">
        <span class="buret-xyzrender-rotate-handle-dot"></span>
        <span class="buret-xyzrender-rotate-handle-degree">0°</span>
      </div>`;
  }

  function externalArtifactObjectHTML(path, label) {
    return externalArtifactBaseItemHTML(
      `<object class="buret-external-artifact-object" data="${safeRelativeArtifactPath(path)}" type="image/svg+xml" aria-label="${escapeHTML(label || 'xyzrender artifact')}"></object>`,
      label
    );
  }

  function sheetItemExportLabel(item) {
    const config = activeConfig || window.BurreteConfig || {};
    return item?.getAttribute?.('aria-label') || config.label || 'xyzrender';
  }

  function normalizeSvgForExport(svgText) {
    let text = String(svgText || '').trim();
    if (!text) return '';
    const svgStart = text.search(/<svg[\s>]/iu);
    if (svgStart > 0) text = text.slice(svgStart);
    if (!/^<svg[\s>]/iu.test(text)) return '';
    if (!/\sxmlns=/iu.test(text)) text = text.replace(/<svg\b/iu, '<svg xmlns="http://www.w3.org/2000/svg"');
    return text;
  }

  async function xyzrenderSheetItemSvgText(item) {
    const inlineSvg = item?.querySelector?.('.buret-xyzrender-sheet-item-body > svg');
    if (inlineSvg) return new XMLSerializer().serializeToString(inlineSvg);

    const object = item?.querySelector?.('.buret-external-artifact-object');
    const objectSvg = object?.contentDocument?.querySelector?.('svg');
    if (objectSvg) return new XMLSerializer().serializeToString(objectSvg);

    const data = object?.getAttribute?.('data');
    if (data) {
      const response = await fetch(data);
      if (!response.ok) throw new Error(`Could not read xyzrender SVG: HTTP ${response.status}`);
      return await response.text();
    }
    return '';
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = safeDownloadFileName(name);
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      link.remove();
    }, 1000);
  }

  async function svgTextToCanvas(svgText, item) {
    const normalized = normalizeSvgForExport(svgText);
    if (!normalized) throw new Error('No xyzrender SVG payload to export.');
    const rect = item?.getBoundingClientRect?.();
    const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const width = Math.max(256, Math.min(4096, Math.round((rect?.width || 1200) * ratio)));
    const height = Math.max(256, Math.min(4096, Math.round((rect?.height || 900) * ratio)));
    const imageBlob = new Blob([normalized], { type: 'image/svg+xml;charset=utf-8' });
    const imageUrl = URL.createObjectURL(imageBlob);
    try {
      const image = new Image();
      image.decoding = 'async';
      const loaded = new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('Could not rasterize xyzrender SVG.'));
      });
      image.src = imageUrl;
      await loaded;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas export is unavailable.');
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      return canvas;
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  }

  async function svgTextToPngBlob(svgText, item) {
    const canvas = await svgTextToCanvas(svgText, item);
    return await new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('Could not encode PNG export.'));
      }, 'image/png');
    });
  }

  async function svgTextToGifBlob(svgText, item) {
    return new Blob([encodeCanvasAsGif(await svgTextToCanvas(svgText, item))], { type: 'image/gif' });
  }

  function encodeCanvasAsGif(canvas) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas export is unavailable.');
    const { width, height } = canvas;
    if (width > 4096 || height > 4096) throw new Error('GIF export is limited to 4096 px per side.');
    const pixels = context.getImageData(0, 0, width, height).data;
    const indexed = new Uint8Array(width * height);
    for (let pixel = 0, index = 0; pixel < pixels.length; pixel += 4, index += 1) {
      indexed[index] = ((pixels[pixel] >> 5) << 5) | ((pixels[pixel + 1] >> 5) << 2) | (pixels[pixel + 2] >> 6);
    }
    const bytes = [];
    const writeByte = value => bytes.push(value & 255);
    const writeText = value => { for (let index = 0; index < value.length; index += 1) writeByte(value.charCodeAt(index)); };
    const writeWord = value => { writeByte(value); writeByte(value >> 8); };
    writeText('GIF89a');
    writeWord(width);
    writeWord(height);
    writeByte(0xf7);
    writeByte(0);
    writeByte(0);
    for (let index = 0; index < 256; index += 1) {
      writeByte(Math.round(((index >> 5) & 7) * 255 / 7));
      writeByte(Math.round(((index >> 2) & 7) * 255 / 7));
      writeByte(Math.round((index & 3) * 255 / 3));
    }
    writeByte(0x21); writeByte(0xf9); writeByte(4); writeByte(0); writeWord(0); writeByte(0); writeByte(0);
    writeByte(0x2c); writeWord(0); writeWord(0); writeWord(width); writeWord(height); writeByte(0);
    writeByte(8);
    const lzw = gifLzwEncode(indexed);
    for (let offset = 0; offset < lzw.length; offset += 255) {
      const chunk = lzw.slice(offset, offset + 255);
      writeByte(chunk.length);
      for (const value of chunk) writeByte(value);
    }
    writeByte(0);
    writeByte(0x3b);
    return new Uint8Array(bytes);
  }

  function gifLzwEncode(indices) {
    const minCodeSize = 8;
    const clearCode = 1 << minCodeSize;
    const endCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let nextCode = endCode + 1;
    let dictionary = new Map();
    const output = [];
    let currentByte = 0;
    let bitCount = 0;
    const reset = () => {
      dictionary = new Map();
      for (let index = 0; index < clearCode; index += 1) dictionary.set(String(index), index);
      codeSize = minCodeSize + 1;
      nextCode = endCode + 1;
    };
    const writeCode = code => {
      currentByte |= code << bitCount;
      bitCount += codeSize;
      while (bitCount >= 8) {
        output.push(currentByte & 255);
        currentByte >>= 8;
        bitCount -= 8;
      }
    };
    reset();
    writeCode(clearCode);
    let phrase = String(indices[0] ?? 0);
    for (let offset = 1; offset < indices.length; offset += 1) {
      const symbol = String(indices[offset]);
      const combined = `${phrase},${symbol}`;
      if (dictionary.has(combined)) {
        phrase = combined;
        continue;
      }
      writeCode(dictionary.get(phrase));
      if (nextCode < 4096) {
        dictionary.set(combined, nextCode);
        nextCode += 1;
        if (nextCode === (1 << codeSize) && codeSize < 12) codeSize += 1;
      } else {
        writeCode(clearCode);
        reset();
      }
      phrase = symbol;
    }
    writeCode(dictionary.get(phrase));
    writeCode(endCode);
    if (bitCount > 0) output.push(currentByte & 255);
    return output;
  }

  function hideXyzrenderSheetContextMenu() {
    document.querySelector('.buret-xyzrender-context-menu')?.remove();
  }

  function appendXyzrenderMenuButton(actions, label, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      Promise.resolve()
        .then(action)
        .catch(error => setStatus(error instanceof Error ? error.message : String(error), 'error'));
    });
    actions.appendChild(button);
  }

  function appendXyzrenderMenuLabel(actions, label) {
    const element = document.createElement('div');
    element.className = 'buret-molecule-context-menu-section-label';
    element.textContent = label;
    actions.appendChild(element);
  }

  function showXyzrenderSheetContextMenu(event, item) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    hideMolstarContextMenu({ keepMoleculePreview: true });
    hideXyzrenderSheetContextMenu();

    const label = sheetItemExportLabel(item);
    const baseName = safeExportBaseName(label, 'xyzrender');
    const menu = document.createElement('div');
    menu.className = 'buret-molecule-context-menu buret-xyzrender-context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'xyzrender actions');

    const title = document.createElement('div');
    title.className = 'buret-molecule-context-menu-title';
    title.textContent = 'xyzrender';
    menu.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.className = 'buret-molecule-context-menu-subtitle';
    subtitle.textContent = label;
    menu.appendChild(subtitle);

    const actions = document.createElement('div');
    actions.className = 'buret-molecule-context-menu-actions';
    menu.appendChild(actions);

    appendXyzrenderMenuButton(actions, 'Hide Display', () => {
      item.remove();
      hideXyzrenderSheetContextMenu();
      setStatus(`[web] Hid xyzrender display: ${baseName}`);
      setTimeout(hideStatus, 900);
    });
    if (hasHiddenXyzrenderElements(item)) {
      appendXyzrenderMenuButton(actions, 'Show Hidden', () => {
        pushXyzrenderActionHistory(item, 'show hidden');
        showHiddenXyzrenderElements(item);
        hideXyzrenderSheetContextMenu();
      });
    }
    if (hasXyzrenderSelection()) {
      appendXyzrenderMenuButton(actions, 'Hide Selected', () => {
        pushXyzrenderActionHistory(item, 'hide selected');
        hideSelectedXyzrenderElements();
        hideXyzrenderSheetContextMenu();
      });
      appendXyzrenderMenuButton(actions, 'Dim Others', () => {
        pushXyzrenderActionHistory(item, 'dim others');
        dimUnselectedXyzrenderElements(item);
        hideXyzrenderSheetContextMenu();
      });
    }
    appendXyzrenderMenuLabel(actions, 'Save to');
    appendXyzrenderMenuButton(actions, 'SVG', async () => {
      const svgText = normalizeSvgForExport(await xyzrenderSheetItemSvgText(item));
      if (!svgText) throw new Error('No xyzrender SVG payload to export.');
      downloadBlob(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }), `${baseName}.svg`);
      hideXyzrenderSheetContextMenu();
      setStatus(`[web] Saved xyzrender SVG: ${baseName}.svg`);
      setTimeout(hideStatus, 900);
    });
    appendXyzrenderMenuButton(actions, 'PNG', async () => {
      const pngBlob = await svgTextToPngBlob(await xyzrenderSheetItemSvgText(item), item);
      downloadBlob(pngBlob, `${baseName}.png`);
      hideXyzrenderSheetContextMenu();
      setStatus(`[web] Saved xyzrender PNG: ${baseName}.png`);
      setTimeout(hideStatus, 900);
    });
    appendXyzrenderMenuButton(actions, 'GIF', async () => {
      const gifBlob = await svgTextToGifBlob(await xyzrenderSheetItemSvgText(item), item);
      downloadBlob(gifBlob, `${baseName}.gif`);
      hideXyzrenderSheetContextMenu();
      setStatus(`[web] Saved xyzrender GIF: ${baseName}.gif`);
      setTimeout(hideStatus, 900);
    });
    document.body.appendChild(menu);
    positionMolstarContextMenu(menu, event.clientX, event.clientY);
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
      .buret-external-artifact-root.sheet-drop-active::after { content: "Drop onto xyzrender sheet"; position: absolute; inset: 14px; z-index: 36; border: 2px solid color-mix(in srgb, var(--buret-accent, #b45cff) 72%, transparent); border-radius: 14px; background: color-mix(in srgb, var(--buret-accent, #b45cff) 12%, transparent); color: var(--buret-toolbar-color, rgba(255,255,255,0.92)); display: flex; align-items: center; justify-content: center; font: 400 13px/1.2 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; pointer-events: none; }
      .buret-molstar-lasso.active { background: color-mix(in srgb, var(--buret-accent, #b45cff) 24%, var(--buret-toolbar-hover, rgba(255,255,255,0.13))); box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--buret-accent, #b45cff) 82%, white), 0 0 0 2px color-mix(in srgb, var(--buret-accent, #b45cff) 18%, transparent); color: var(--buret-toolbar-color, rgba(255,255,255,0.96)); }
      .buret-molstar-lasso-overlay { position: fixed; inset: 0; z-index: 2147483645; width: 100vw; height: 100vh; pointer-events: none; }
      .buret-molstar-lasso-overlay polygon { fill: color-mix(in srgb, var(--buret-accent, #b45cff) 18%, transparent); stroke: none; }
      .buret-molstar-lasso-overlay polyline { fill: none; stroke: color-mix(in srgb, var(--buret-accent, #b45cff) 88%, white); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; filter: drop-shadow(0 1px 3px rgba(0,0,0,0.36)); }
      .buret-xyzrender-sheet { position: absolute; inset: 0; z-index: 14; pointer-events: auto; }
      .buret-xyzrender-sheet-item { --buret-sheet-rotation: 0deg; --buret-sheet-rotation-negative: 0deg; --buret-active-angle: 0deg; --buret-rotate-radius: 76px; --buret-rotate-lift: 24px; --buret-rotate-handle-scale: 1; position: absolute; left: 50%; top: 50%; width: clamp(118px, 24vw, 280px); height: clamp(118px, 24vw, 280px); transform: translate(-50%, -50%) rotate(var(--buret-sheet-rotation)); transform-origin: 50% 50%; pointer-events: auto; touch-action: none; cursor: grab; border-radius: 10px; outline: 0 solid transparent; }
      .buret-xyzrender-sheet-item:not(.buret-xyzrender-sheet-item-base) { z-index: 2; }
      .buret-xyzrender-sheet-item-large { width: max(180px, min(calc(100vw - 220px), 860px)); height: max(180px, min(calc(100vh - 230px), 620px)); border-radius: 8px; }
      .buret-xyzrender-sheet-item-base { z-index: 1; }
      .buret-xyzrender-sheet-item.dragging { cursor: grabbing; }
      .buret-xyzrender-sheet-item.rotating { cursor: grabbing; }
      .buret-xyzrender-sheet-item.resizing { cursor: nwse-resize; }
      body.buret-xyzrender-lasso-active .buret-xyzrender-sheet-item { cursor: crosshair; }
      .buret-xyzrender-sheet-item.selected { outline: 0 solid transparent; box-shadow: none; }
      .buret-xyzrender-sheet-item.has-xyzrender-selection { box-shadow: none; }
      .buret-xyzrender-svg-selection { outline: none; }
      .buret-xyzrender-sheet-item:has(.buret-xyzrender-resize-handle:hover),
      .buret-xyzrender-sheet-item.resizing { outline: 1.5px solid color-mix(in srgb, var(--buret-accent, #b45cff) 74%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--buret-accent, #b45cff) 18%, transparent); }
      .buret-xyzrender-sheet-item-background { position: absolute; inset: 0; z-index: 0; border-radius: 10px; background: #fff; pointer-events: none; }
      .buret-xyzrender-sheet-item-large .buret-xyzrender-sheet-item-background { border-radius: 8px; box-shadow: 0 18px 54px rgba(0,0,0,0.28); }
      .buret-xyzrender-sheet-item-body { position: relative; z-index: 1; width: 100%; height: 100%; pointer-events: none; }
      .buret-xyzrender-sheet-item-body > svg,
      .buret-external-artifact-object { display: block; width: 100%; height: 100%; overflow: visible; border: 0; border-radius: inherit; }
      .buret-xyzrender-rotate-hud { position: absolute; left: 50%; top: 50%; z-index: 7; width: calc(var(--buret-rotate-radius) * 2 + 78px); height: calc(var(--buret-rotate-radius) * 2 + 78px); transform: translate(-50%, -50%) rotate(var(--buret-sheet-rotation-negative)); transform-origin: 50% 50%; opacity: 0; pointer-events: none; transition: opacity 120ms ease; }
      .buret-xyzrender-rotate-ring { position: absolute; inset: 29px; border: 1.25px dashed color-mix(in srgb, var(--buret-accent, #b45cff) 18%, rgba(160,173,214,0.24)); border-radius: 999px; }
      .buret-xyzrender-rotate-needle { position: absolute; left: 50%; top: 50%; width: 1px; height: var(--buret-rotate-radius); transform: translateX(-50%) rotate(var(--buret-active-angle)); transform-origin: 50% 0%; border-left: 1.5px dashed color-mix(in srgb, var(--buret-accent, #b45cff) 46%, transparent); }
      .buret-xyzrender-rotate-needle::after { content: ""; position: absolute; left: 50%; bottom: -7px; width: 15px; height: 15px; transform: translateX(-50%); border-radius: 999px; background: color-mix(in srgb, var(--buret-accent, #b45cff) 58%, var(--buret-toolbar-background, #111)); box-shadow: 0 6px 14px color-mix(in srgb, var(--buret-accent, #b45cff) 18%, transparent); }
      .buret-xyzrender-rotate-current { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) rotate(var(--buret-active-angle)) translateY(calc(-1 * (var(--buret-rotate-radius) + 18px))) rotate(calc(-1 * var(--buret-active-angle))); transform-origin: 50% 50%; color: var(--buret-toolbar-color, rgba(255,255,255,0.94)); }
      .buret-xyzrender-rotate-current span { display: block; padding: 5px 11px; border-radius: 999px; background: color-mix(in srgb, var(--buret-toolbar-background, rgba(17,19,24,0.82)) 84%, transparent); border: 1px solid color-mix(in srgb, var(--buret-accent, #b45cff) 34%, var(--buret-toolbar-border, rgba(255,255,255,0.16))); font: 400 18px/1.15 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; box-shadow: 0 8px 18px rgba(0,0,0,0.20); }
      .buret-xyzrender-rotate-label { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) rotate(var(--buret-degree-angle)) translateY(calc(-1 * (var(--buret-rotate-radius) + 38px))) rotate(var(--buret-degree-counter-angle)); color: rgba(160,173,214,0.64); font: 400 16px/1 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; }
      .buret-xyzrender-rotate-label.active { color: color-mix(in srgb, var(--buret-accent, #b45cff) 70%, var(--buret-toolbar-color, #fff)); }
      .buret-xyzrender-rotate-tick { position: absolute; left: 50%; top: 50%; width: 1.25px; height: 10px; transform: translate(-50%, -50%) rotate(var(--buret-degree-angle)) translateY(calc(-1 * var(--buret-rotate-radius))); transform-origin: 50% 100%; background: rgba(125,142,183,0.25); border-radius: 999px; }
      .buret-xyzrender-sheet-rotate-handle { position: absolute; left: 50%; top: 0; z-index: 12; width: 54px; height: 54px; transform: translate(-50%, calc(-1 * var(--buret-rotate-lift) - 50%)) scale(var(--buret-rotate-handle-scale)); border: 0; border-radius: 999px; cursor: grab; opacity: 0; pointer-events: auto; touch-action: none; transition: opacity 120ms ease, transform 120ms ease; }
      .buret-xyzrender-sheet-rotate-handle::before { content: ""; position: absolute; left: 50%; top: 34px; width: 1.5px; height: max(18px, calc(var(--buret-rotate-lift) - 12px)); transform: translateX(-50%); background: color-mix(in srgb, var(--buret-accent, #b45cff) 38%, transparent); border-radius: 999px; }
      .buret-xyzrender-rotate-handle-dot { position: absolute; left: 50%; top: 50%; width: 24px; height: 24px; transform: translate(-50%, -50%); border: 1.5px solid color-mix(in srgb, var(--buret-accent, #b45cff) 72%, var(--buret-toolbar-color, #fff)); border-radius: 999px; background: var(--buret-toolbar-background, rgba(12,13,14,0.92)); box-shadow: 0 8px 16px rgba(0,0,0,0.22); }
      .buret-xyzrender-rotate-handle-degree { position: absolute; left: calc(100% + 4px); top: 50%; transform: translateY(-50%) rotate(var(--buret-sheet-rotation-negative)); transform-origin: 0 50%; padding: 4px 9px; border-radius: 999px; color: var(--buret-toolbar-color, #fff); background: color-mix(in srgb, var(--buret-accent, #b45cff) 36%, var(--buret-toolbar-background, #111)); font: 400 14px/1.15 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; opacity: 0; white-space: nowrap; box-shadow: 0 6px 15px color-mix(in srgb, var(--buret-accent, #b45cff) 14%, transparent); }
      .buret-xyzrender-resize-n:hover ~ .buret-xyzrender-sheet-rotate-handle,
      .buret-xyzrender-sheet-rotate-handle:hover,
      .buret-xyzrender-sheet-item.rotating .buret-xyzrender-sheet-rotate-handle { opacity: 1; }
      .buret-xyzrender-sheet-item.rotating .buret-xyzrender-rotate-hud { opacity: 1; }
      .buret-xyzrender-sheet-rotate-handle:hover,
      .buret-xyzrender-sheet-item.rotating .buret-xyzrender-sheet-rotate-handle { --buret-rotate-handle-scale: 1.1; }
      .buret-xyzrender-sheet-item.rotating .buret-xyzrender-sheet-rotate-handle { transition: none; }
      .buret-xyzrender-sheet-item.rotating .buret-xyzrender-rotate-handle-degree { opacity: 1; }
      .buret-xyzrender-resize-handle { position: absolute; z-index: 11; pointer-events: auto; touch-action: none; border-radius: 999px; background: transparent; }
      .buret-xyzrender-resize-handle::after { content: ""; position: absolute; left: 50%; top: 50%; opacity: 0; transform: translate(-50%, -50%) scale(0.92); border-radius: 999px; background: color-mix(in srgb, var(--buret-accent, #b45cff) 86%, var(--buret-toolbar-color, #fff)); box-shadow: 0 0 0 1px rgba(13,14,16,0.72), 0 4px 12px color-mix(in srgb, var(--buret-accent, #b45cff) 24%, transparent); transition: opacity 100ms ease, transform 100ms ease; }
      .buret-xyzrender-resize-handle:hover::after,
      .buret-xyzrender-sheet-item.resizing .buret-xyzrender-resize-handle::after { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      .buret-xyzrender-resize-n,
      .buret-xyzrender-resize-s { left: 50%; width: 84px; height: 30px; transform: translateX(-50%); cursor: ns-resize; }
      .buret-xyzrender-resize-n::after,
      .buret-xyzrender-resize-s::after { width: 26px; height: 6px; }
      .buret-xyzrender-resize-n { top: -13px; }
      .buret-xyzrender-resize-s { bottom: -13px; }
      .buret-xyzrender-resize-e,
      .buret-xyzrender-resize-w { top: 50%; width: 30px; height: 84px; transform: translateY(-50%); cursor: ew-resize; }
      .buret-xyzrender-resize-e::after,
      .buret-xyzrender-resize-w::after { width: 6px; height: 26px; }
      .buret-xyzrender-resize-e { right: -13px; }
      .buret-xyzrender-resize-w { left: -13px; }
      .buret-xyzrender-resize-ne,
      .buret-xyzrender-resize-nw,
      .buret-xyzrender-resize-se,
      .buret-xyzrender-resize-sw { width: 38px; height: 38px; }
      .buret-xyzrender-resize-ne::after,
      .buret-xyzrender-resize-nw::after,
      .buret-xyzrender-resize-se::after,
      .buret-xyzrender-resize-sw::after { width: 11px; height: 11px; }
      .buret-xyzrender-resize-ne { top: -16px; right: -16px; cursor: nesw-resize; }
      .buret-xyzrender-resize-nw { top: -16px; left: -16px; cursor: nwse-resize; }
      .buret-xyzrender-resize-se { bottom: -16px; right: -16px; cursor: nwse-resize; }
      .buret-xyzrender-resize-sw { bottom: -16px; left: -16px; cursor: nesw-resize; }
      .buret-xyzrender-sheet-item-label { position: absolute; left: 50%; bottom: -23px; transform: translateX(-50%); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 3px 7px; border-radius: 999px; color: var(--buret-toolbar-color, rgba(255,255,255,0.92)); background: var(--buret-toolbar-background, rgba(12,13,14,0.84)); font: 10px/1.2 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; opacity: 0; transition: opacity 120ms ease; }
      .buret-xyzrender-sheet-item.selected .buret-xyzrender-sheet-item-label { opacity: 1; }
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

  function readStructureDropPaths(dataTransfer) {
    return readStructureDropPayload(dataTransfer).paths;
  }

  function readStructureDropPayload(dataTransfer) {
    const payload = { paths: [], records: [] };
    if (!dataTransfer) return payload;
    try {
      const custom = dataTransfer.getData(STRUCTURE_DRAG_MIME);
      if (custom) {
        const parsed = JSON.parse(custom);
        if (Array.isArray(parsed)) payload.paths.push(...parsed);
        else {
          if (Array.isArray(parsed?.paths)) payload.paths.push(...parsed.paths);
          if (Array.isArray(parsed?.records)) payload.records.push(...parsed.records.map(normalizeStructureDropRecord).filter(Boolean));
        }
      }
    } catch (_) {}
    if (payload.paths.length === 0 && payload.records.length === 0 && dataTransfer.files) {
      for (const file of Array.from(dataTransfer.files)) {
        if (file && typeof file.path === 'string') payload.paths.push(file.path);
      }
    }
    if (payload.paths.length === 0 && payload.records.length === 0) {
      try {
        const text = dataTransfer.getData('text/plain');
        const inlineRecord = structureDropRecordFromPlainText(text);
        if (inlineRecord) payload.records.push(inlineRecord);
        else payload.paths.push(...structureDropPathsFromPlainText(text));
      } catch (_) {}
    }
    payload.paths = payload.paths.map(path => String(path || '').trim()).filter(Boolean);
    return payload;
  }

  function normalizeStructureDropRecord(record) {
    if (!record || typeof record !== 'object') return null;
    const text = String(record.text || '').trim();
    if (!text) return null;
    const extension = String(record.inputExtension || record.extension || 'xyz')
      .trim()
      .toLowerCase()
      .replace(/^\./u, '');
    const path = String(record.path || `structure.${extension || 'xyz'}`).trim();
    return {
      path: path || `structure.${extension || 'xyz'}`,
      inputExtension: extension || 'xyz',
      text
    };
  }

  function structureDropRecordFromPlainText(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return null;
    if (/^[/~.]|\r?\n[/~.]/u.test(trimmed)) return null;
    if (!/\r?\n/u.test(trimmed)) return null;
    if (!/(?:V2000|V3000|\$\$\$\$|M\s+END)/u.test(trimmed)) return null;
    return {
      path: 'structure.sdf',
      inputExtension: 'sdf',
      text: trimmed
    };
  }

  function structureDropPathsFromPlainText(text) {
    return String(text || '')
      .split(/\r?\n/gu)
      .map(line => line.trim())
      .filter(looksLikeStructurePathLine);
  }

  function looksLikeStructurePathLine(line) {
    if (!line || /\s/u.test(line)) return false;
    if (/^(?:file:\/\/|\/|~\/|\.{1,2}\/|[A-Za-z]:[\\/])/u.test(line)) return true;
    return /\.(?:abi|bcif|cif|cms|com|cub|cube|csv|ent|fdf|in|inp|mae|maegz|mmcif|mol|mol2|nw|out|pdb|psi4|qcin|sd|sdf|smi|smiles|tsv|vasp|xyz)$/iu.test(line);
  }

  function normalizeSheetClientPoint(point) {
    if (!point || typeof point !== 'object') return null;
    const x = Number(point.x);
    const y = Number(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  }

  function ensureXyzrenderSheet(stage) {
    let sheet = stage.querySelector('.buret-xyzrender-sheet');
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.className = 'buret-xyzrender-sheet';
      sheet.setAttribute('aria-label', 'xyzrender sheet overlays');
      stage.appendChild(sheet);
    }
    return sheet;
  }

  function installExternalArtifactSheet(root, stage, toStagePoint, getStageScale) {
    const sheet = ensureXyzrenderSheet(stage);
    let sheetItemSerial = sheet.querySelectorAll('.buret-xyzrender-sheet-item').length;

    const addSheetItems = async (entries, point = null) => {
      const config = activeConfig || window.BurreteConfig || {};
      const cleanEntries = uniqueSheetEntries(entries);
      if (cleanEntries.length === 0) return;
      setStatus(`[web] Adding ${cleanEntries.length} structure${cleanEntries.length === 1 ? '' : 's'} to xyzrender sheet…`);
      const baseControls = normalizeXyzrenderControls(config.xyzrenderControls || DEFAULT_XYZRENDER_CONTROLS, config);
      const controls = {
        ...baseControls,
        transparentBackground: true,
        fieldMode: 'off',
        showCell: false,
        showGhosts: false,
        showAxes: false
      };
      const preset = normalizeXyzrenderPreset(config.externalArtifact?.preset || config.xyzrenderPreset || 'default');
      for (const entry of cleanEntries) {
        const label = sheetEntryLabel(entry);
        try {
          const payload = await renderXyzrenderSheetItemPayload(entry, preset, controls);
          sheetItemSerial += 1;
          addXyzrenderSheetItem(sheet, payload.svg, label, point, sheetItemSerial, getStageScale, entry);
        } catch (error) {
          setStatus(`Could not add ${label} to xyzrender sheet: ${error instanceof Error ? error.message : String(error)}`, 'error');
        }
      }
      setTimeout(hideStatus, 450);
    };

    const onDragOver = event => {
      const payload = readStructureDropPayload(event.dataTransfer);
      if (payload.paths.length === 0 && payload.records.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      root.classList.add('sheet-drop-active');
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = event => {
      if (root.contains(event.relatedTarget)) return;
      root.classList.remove('sheet-drop-active');
    };
    const onDrop = event => {
      const payload = readStructureDropPayload(event.dataTransfer);
      const entries = [...payload.paths, ...payload.records];
      if (entries.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      root.classList.remove('sheet-drop-active');
      void addSheetItems(entries, toStagePoint(event.clientX, event.clientY));
    };
    const onMessage = event => {
      const data = event.data || {};
      const body = data.body || {};
      if (data.source === 'burrete-host' && (
        body.type === 'xyzrenderSheetItemRendered' ||
        body.type === 'xyzrenderSheetItemError'
      )) {
        resolveHostXyzrenderSheetItem(body);
        return;
      }
      if (data.source !== 'burrete-host' || body.type !== 'addXyzrenderSheetItems') return;
      const documentId = String((activeConfig || window.BurreteConfig || {}).documentId || '');
      if (body.documentId && documentId && String(body.documentId) !== documentId) return;
      const point = normalizeSheetClientPoint(body.point);
      void addSheetItems(
        [...(body.paths || []), ...(body.records || [])],
        point ? toStagePoint(point.x, point.y) : null
      );
    };

    root.addEventListener('dragover', onDragOver);
    root.addEventListener('dragleave', onDragLeave);
    root.addEventListener('drop', onDrop);
    window.addEventListener('message', onMessage);
    return () => {
      root.removeEventListener('dragover', onDragOver);
      root.removeEventListener('dragleave', onDragLeave);
      root.removeEventListener('drop', onDrop);
      window.removeEventListener('message', onMessage);
      root.classList.remove('sheet-drop-active');
    };
  }

  function uniqueSheetEntries(entries) {
    const seen = new Set();
    const result = [];
    for (const entry of entries || []) {
      const normalized = normalizeSheetEntry(entry);
      if (!normalized) continue;
      const key = typeof normalized === 'string'
        ? `path:${normalized}`
        : `record:${normalized.path}:${normalized.inputExtension}:${normalized.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(normalized);
    }
    return result;
  }

  function normalizeSheetEntry(entry) {
    if (typeof entry === 'string') {
      const path = entry.trim();
      return path ? path : null;
    }
    return normalizeStructureDropRecord(entry);
  }

  function sheetEntryLabel(entry) {
    return typeof entry === 'string' ? entry : String(entry?.path || 'structure.xyz');
  }

  function sheetEntryInputExtension(entry) {
    return typeof entry === 'string' ? undefined : String(entry?.inputExtension || 'xyz');
  }

  function sheetEntryInputDataBase64(entry) {
    if (typeof entry === 'string') return undefined;
    if (typeof entry?.inputDataBase64 === 'string' && entry.inputDataBase64.trim()) {
      return entry.inputDataBase64.trim();
    }
    const text = String(entry?.text || '');
    if (!text) return undefined;
    return bytesToBase64(new TextEncoder().encode(text));
  }

  function baseXyzrenderSheetEntry(config = activeConfig || window.BurreteConfig || {}) {
    const path = String(
      config.xyzrenderSourcePath ||
      config.sourcePath ||
      config.path ||
      config.filePath ||
      config.label ||
      'structure.xyz'
    ).trim() || 'structure.xyz';
    const inputDataBase64 = typeof config.xyzrenderInputDataBase64 === 'string'
      ? config.xyzrenderInputDataBase64.trim()
      : '';
    const inputExtension = typeof config.xyzrenderInputExtension === 'string'
      ? config.xyzrenderInputExtension.trim()
      : String(config.sourceExtension || config.molstarFormat || config.format || '').trim();
    return {
      path,
      inputDataBase64: inputDataBase64 || undefined,
      inputExtension: inputExtension || undefined
    };
  }

  function setXyzrenderSheetItemEntry(item, entry) {
    if (!item || !entry) return;
    xyzrenderSheetItemEntries.set(item, entry);
    item.dataset.buretXyzrenderSourcePath = sheetEntryLabel(entry);
  }

  function xyzrenderSheetItemEntry(item) {
    if (!item) return null;
    const stored = xyzrenderSheetItemEntries.get(item);
    if (stored) return stored;
    if (item.classList?.contains('buret-xyzrender-sheet-item-base')) {
      const entry = baseXyzrenderSheetEntry();
      setXyzrenderSheetItemEntry(item, entry);
      return entry;
    }
    const path = item.dataset?.buretXyzrenderSourcePath;
    return path ? path : null;
  }

  function selectedXyzrenderSheetItems(root = document) {
    return Array.from(root.querySelectorAll('.buret-xyzrender-sheet-item.selected'));
  }

  function frontmostXyzrenderSheetItem(root = document) {
    const items = Array.from(root.querySelectorAll('.buret-xyzrender-sheet-item'))
      .filter(item => item.querySelector('.buret-xyzrender-sheet-item-body'));
    if (!items.length) return null;
    return items.reduce((frontmost, item) => {
      const frontmostZ = Number.parseFloat(window.getComputedStyle(frontmost).zIndex);
      const itemZ = Number.parseFloat(window.getComputedStyle(item).zIndex);
      return (Number.isFinite(itemZ) ? itemZ : 0) >= (Number.isFinite(frontmostZ) ? frontmostZ : 0)
        ? item
        : frontmost;
    }, items[0]);
  }

  function xyzrenderSheetItemPreset(item, config = activeConfig || window.BurreteConfig || {}) {
    return normalizeXyzrenderPreset(
      item?.dataset?.buretXyzrenderPreset ||
      config.externalArtifact?.preset ||
      config.xyzrenderPreset ||
      'default'
    );
  }

  function xyzrenderSheetItemRegions(item) {
    const raw = item?.dataset?.buretXyzrenderRegions;
    if (!raw) return [];
    try {
      return normalizeXyzrenderRegions(JSON.parse(raw));
    } catch (_) {
      return [];
    }
  }

  function setXyzrenderSheetItemRegions(item, regions) {
    if (!item) return;
    const normalized = normalizeXyzrenderRegions(regions);
    if (!normalized.length) {
      delete item.dataset.buretXyzrenderRegions;
      return;
    }
    item.dataset.buretXyzrenderRegions = JSON.stringify(normalized);
  }

  function xyzrenderSheetItemVdwAtoms(item) {
    return normalizeXyzrenderAtomSelector(item?.dataset?.buretXyzrenderVdwAtoms);
  }

  function setXyzrenderSheetItemVdwAtoms(item, atoms) {
    if (!item) return;
    const normalized = normalizeXyzrenderAtomSelector(atoms);
    if (!normalized) {
      delete item.dataset.buretXyzrenderVdwAtoms;
      return;
    }
    item.dataset.buretXyzrenderVdwAtoms = normalized;
  }

  function xyzrenderAtomIndexFromElement(element) {
    if (!element?.getAttribute) return null;
    const directIndex = Number(
      element.getAttribute('data-atom-index') ||
      element.getAttribute('data-atom') ||
      element.getAttribute('data-index')
    );
    if (Number.isInteger(directIndex) && directIndex > 0) return directIndex;
    const values = [
      element.getAttribute('fill'),
      element.getAttribute('stroke'),
      element.getAttribute('style'),
      element.getAttribute('id'),
      element.getAttribute('class'),
      element.getAttribute('filter'),
      element.getAttribute('clip-path'),
      element.getAttribute('mask')
    ].filter(Boolean).join(' ');
    const gradientMatch = values.match(/url\(#x\d+g(\d+)\)/u);
    if (gradientMatch) {
      const gradientIndex = Number(gradientMatch[1]) + 1;
      return Number.isInteger(gradientIndex) && gradientIndex > 0 ? gradientIndex : null;
    }
    const match = values.match(/(?:atom|idx|index)[-_:\s]*(\d+)/iu);
    if (!match) return null;
    const index = Number(match[1]);
    return Number.isInteger(index) && index > 0 ? index : null;
  }

  function xyzrenderAtomNodes(item) {
    return xyzrenderGraphicElements(item).map(element => {
      const index = xyzrenderAtomIndexFromElement(element);
      if (!index || !element.getBoundingClientRect) return null;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      return {
        element,
        index,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        radius: Math.max(5, Math.min(18, Math.max(rect.width, rect.height) / 2))
      };
    }).filter(Boolean);
  }

  function xyzrenderAtomSelectorForElements(item, elements) {
    const atoms = new Set();
    const atomNodes = xyzrenderAtomNodes(item);
    for (const element of elements || []) {
      const directIndex = xyzrenderAtomIndexFromElement(element);
      if (directIndex) atoms.add(directIndex);
    }
    if (atoms.size === 0) {
      for (const element of elements || []) {
        addAtomsNearXyzrenderElement(atoms, atomNodes, element);
      }
    }
    return compactXyzrenderAtomSelector(atoms);
  }

  function addAtomsNearXyzrenderElement(atoms, atomNodes, element) {
    if (!element?.getBoundingClientRect) return;
    const tagName = String(element.tagName || '').toLowerCase();
    if (tagName === 'line') {
      const x1 = Number(element.getAttribute('x1'));
      const y1 = Number(element.getAttribute('y1'));
      const x2 = Number(element.getAttribute('x2'));
      const y2 = Number(element.getAttribute('y2'));
      const svg = element.ownerSVGElement;
      if (svg && [x1, y1, x2, y2].every(Number.isFinite)) {
        const p1 = svgPointToClient(svg, x1, y1);
        const p2 = svgPointToClient(svg, x2, y2);
        for (const atom of atomNodes) {
          if (distanceToSegment(atom.x, atom.y, p1.x, p1.y, p2.x, p2.y) <= 18) atoms.add(atom.index);
        }
        return;
      }
    }
    const rect = element.getBoundingClientRect();
    const padding = Math.max(16, Math.min(34, Math.max(rect.width, rect.height) * 0.18));
    for (const atom of atomNodes) {
      if (
        atom.x >= rect.left - padding &&
        atom.x <= rect.right + padding &&
        atom.y >= rect.top - padding &&
        atom.y <= rect.bottom + padding
      ) {
        atoms.add(atom.index);
      }
    }
  }

  function svgPointToClient(svg, x, y) {
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x, y };
    const point = svg.createSVGPoint();
    point.x = x;
    point.y = y;
    const transformed = point.matrixTransform(matrix);
    return { x: transformed.x, y: transformed.y };
  }

  function distanceToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function compactXyzrenderAtomSelector(values) {
    const atoms = Array.from(values || [])
      .map(Number)
      .filter(value => Number.isInteger(value) && value > 0)
      .sort((a, b) => a - b);
    if (!atoms.length) return null;
    const parts = [];
    let start = atoms[0];
    let previous = atoms[0];
    for (const atom of atoms.slice(1)) {
      if (atom === previous) continue;
      if (atom === previous + 1) {
        previous = atom;
        continue;
      }
      parts.push(start === previous ? String(start) : `${start}-${previous}`);
      start = atom;
      previous = atom;
    }
    parts.push(start === previous ? String(start) : `${start}-${previous}`);
    return parts.join(',');
  }

  function xyzrenderAtomSetFromSelector(selector) {
    const atoms = new Set();
    String(selector || '').split(',').forEach(part => {
      const trimmed = part.trim();
      if (!trimmed) return;
      const [startValue, endValue] = trimmed.split('-').map(value => Number(value.trim()));
      if (!Number.isInteger(startValue) || startValue <= 0) return;
      const end = Number.isInteger(endValue) && endValue >= startValue ? endValue : startValue;
      for (let atom = startValue; atom <= end; atom += 1) atoms.add(atom);
    });
    return atoms;
  }

  function xyzrenderAtomSetsIntersect(left, right) {
    for (const atom of left || []) {
      if (right?.has?.(atom)) return true;
    }
    return false;
  }

  function requestSelectedXyzrenderSheetItemsUpdate(options = {}) {
    const selectedItems = selectedXyzrenderSheetItems().filter(item => item.querySelector('.buret-xyzrender-sheet-item-body'));
    const frontmostItem = selectedItems.length === 0 ? frontmostXyzrenderSheetItem() : null;
    const items = selectedItems.length > 0 ? selectedItems : (frontmostItem ? [frontmostItem] : []);
    if (items.length === 0) return false;
    void updateSelectedXyzrenderSheetItems(items, options);
    return true;
  }

  async function applyXyzrenderSelectionPreset(preset, controls) {
    const groups = xyzrenderSelectionGroups();
    if (!groups.length) {
      clearXyzrenderSelection();
      return;
    }
    const normalizedPreset = normalizeXyzrenderPreset(preset);
    setStatus(`[web] Applying ${normalizedPreset} preset to selected xyzrender atoms…`);
    let updated = 0;
    for (const group of groups) {
      const entry = xyzrenderSheetItemEntry(group.item);
      if (!entry) continue;
      const atomSelector = xyzrenderAtomSelectorForElements(group.item, group.elements);
      if (!atomSelector) continue;
      try {
        const regions = [...xyzrenderSheetItemRegions(group.item), { atoms: atomSelector, preset: normalizedPreset }];
        const nextControls = normalizeXyzrenderControls({ ...controls, regions }, activeConfig || window.BurreteConfig || {});
        const basePreset = xyzrenderSheetItemPreset(group.item);
        const payload = await renderXyzrenderSheetItemPayload(entry, basePreset, nextControls);
        pushXyzrenderActionHistory(group.item, `apply ${normalizedPreset} region`);
        updateXyzrenderSheetItemBody(group.item, payload.svg);
        setXyzrenderSheetItemEntry(group.item, entry);
        group.item.dataset.buretXyzrenderPreset = normalizeXyzrenderPreset(payload.preset || basePreset);
        setXyzrenderSheetItemRegions(group.item, regions);
        updated += atomSelector.split(',').reduce((count, part) => {
          const [start, end] = part.split('-').map(Number);
          return count + (end ? end - start + 1 : 1);
        }, 0);
      } catch (error) {
        setStatus(`Could not apply ${normalizedPreset} preset to ${sheetEntryLabel(entry)}: ${error instanceof Error ? error.message : String(error)}`, 'error');
      }
    }
    if (updated > 0) {
      clearXyzrenderSelection();
      setStatus(`[web] Applied ${normalizedPreset} preset to ${updated} selected xyzrender atom${updated === 1 ? '' : 's'}.`);
      setTimeout(hideStatus, 900);
    }
  }

  async function applyXyzrenderSelectionVdw(controls, preset) {
    const groups = xyzrenderSelectionGroups();
    if (!groups.length) {
      setStatus('Select atoms first, then apply partial vdW spheres.', 'error');
      return;
    }
    const normalizedPreset = normalizeXyzrenderPreset(preset);
    setStatus('[web] Applying partial vdW spheres to selected xyzrender atoms…');
    let updated = 0;
    for (const group of groups) {
      const entry = xyzrenderSheetItemEntry(group.item);
      if (!entry) continue;
      const atomSelector = xyzrenderAtomSelectorForElements(group.item, group.elements);
      if (!atomSelector) continue;
      try {
        const nextControls = normalizeXyzrenderControls({
          ...controls,
          showVdw: true,
          vdwAtoms: atomSelector,
          regions: xyzrenderSheetItemRegions(group.item)
        }, activeConfig || window.BurreteConfig || {});
        const basePreset = xyzrenderSheetItemPreset(group.item);
        const payload = await renderXyzrenderSheetItemPayload(entry, normalizedPreset || basePreset, nextControls);
        pushXyzrenderActionHistory(group.item, 'apply partial vdW');
        updateXyzrenderSheetItemBody(group.item, payload.svg);
        setXyzrenderSheetItemEntry(group.item, entry);
        group.item.dataset.buretXyzrenderPreset = normalizeXyzrenderPreset(payload.preset || normalizedPreset || basePreset);
        setXyzrenderSheetItemVdwAtoms(group.item, atomSelector);
        updated += atomSelector.split(',').reduce((count, part) => {
          const [start, end] = part.split('-').map(Number);
          return count + (end ? end - start + 1 : 1);
        }, 0);
      } catch (error) {
        setStatus(`Could not apply partial vdW spheres to ${sheetEntryLabel(entry)}: ${error instanceof Error ? error.message : String(error)}`, 'error');
      }
    }
    if (updated > 0) {
      clearXyzrenderSelection();
      setStatus(`[web] Applied partial vdW spheres to ${updated} selected xyzrender atom${updated === 1 ? '' : 's'}.`);
      setTimeout(hideStatus, 900);
    }
  }

  async function updateSelectedXyzrenderSheetItems(items, options = {}) {
    const config = activeConfig || window.BurreteConfig || {};
    const controls = normalizeXyzrenderControls(options.controls || config.xyzrenderControls || DEFAULT_XYZRENDER_CONTROLS, config);
    const preset = normalizeXyzrenderPreset(options.preset || config.externalArtifact?.preset || config.xyzrenderPreset || 'default');
    setStatus(`[web] Updating ${items.length} selected xyzrender structure${items.length === 1 ? '' : 's'}…`);
    let updated = 0;
    for (const item of items) {
      const entry = xyzrenderSheetItemEntry(item);
      if (!entry) continue;
      try {
        const itemControls = normalizeXyzrenderControls({
          ...controls,
          vdwAtoms: xyzrenderSheetItemVdwAtoms(item) || controls.vdwAtoms,
          regions: xyzrenderSheetItemRegions(item)
        }, config);
        const payload = await renderXyzrenderSheetItemPayload(entry, preset, itemControls, options);
        updateXyzrenderSheetItemBody(item, payload.svg);
        setXyzrenderSheetItemEntry(item, entry);
        item.dataset.buretXyzrenderPreset = normalizeXyzrenderPreset(payload.preset || preset);
        updated += 1;
      } catch (error) {
        setStatus(`Could not update ${sheetEntryLabel(entry)}: ${error instanceof Error ? error.message : String(error)}`, 'error');
      }
    }
    if (updated > 0) {
      setStatus(`[web] Updated ${updated} selected xyzrender structure${updated === 1 ? '' : 's'}.`);
      setTimeout(hideStatus, 700);
    }
  }

  async function renderXyzrenderSheetItemPayload(entry, preset, controls, options = {}) {
    const config = activeConfig || window.BurreteConfig || {};
    const endpoint = String(config.xyzrenderEndpoint || '').trim();
    const path = sheetEntryLabel(entry);
    const inputDataBase64 = sheetEntryInputDataBase64(entry);
    const inputExtension = sheetEntryInputExtension(entry);
    const orientationRef = captureCurrentXyzrenderOrientationRef(options);
    if (!endpoint) return requestHostXyzrenderSheetItem(entry, preset, controls, options);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await fetch(xyzrenderBrowserDevEndpointUrl(endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          path,
          preset,
          controls,
          inputDataBase64,
          inputExtension,
          orientationRef: orientationRef?.text || undefined
        })
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('xyzrender sheet render timed out');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : `xyzrender sheet request failed with status ${response.status}`);
    if (typeof payload?.svg !== 'string' || !payload.svg.trim()) throw new Error('xyzrender sheet endpoint returned no SVG payload');
    return payload;
  }

  function xyzrenderBrowserDevEndpointUrl(endpoint) {
    try {
      return new URL(endpoint).toString();
    } catch (_) {}
    try {
      const parentLocation = window.parent && window.parent !== window ? window.parent.location.href : '';
      return new URL(endpoint, parentLocation || window.location.href).toString();
    } catch (_) {
      return endpoint;
    }
  }

  function requestHostXyzrenderSheetItem(entry, preset, controls, options = {}) {
    const requestId = `xyzrender-sheet-${++xyzrenderSheetRequestSerial}`;
    const path = sheetEntryLabel(entry);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        xyzrenderSheetRequests.delete(requestId);
        reject(new Error('xyzrender sheet render timed out'));
      }, 30000);
      xyzrenderSheetRequests.set(requestId, { resolve, reject, timeout });
      const sent = postHostMessage({
        type: 'renderXyzrenderSheetItem',
        requestId,
        path,
        preset,
        controls,
        inputDataBase64: sheetEntryInputDataBase64(entry),
        inputExtension: sheetEntryInputExtension(entry),
        orientationRef: captureCurrentXyzrenderOrientationRef(options)?.text || null
      });
      if (!sent) {
        clearTimeout(timeout);
        xyzrenderSheetRequests.delete(requestId);
        reject(new Error('xyzrender sheet rendering is available only in Burette or browser-dev.'));
      }
    });
  }

  function resolveHostXyzrenderSheetItem(body) {
    const requestId = String(body?.requestId || '');
    if (!requestId) return;
    const pending = xyzrenderSheetRequests.get(requestId);
    if (!pending) return;
    xyzrenderSheetRequests.delete(requestId);
    clearTimeout(pending.timeout);
    if (body.type === 'xyzrenderSheetItemError') {
      pending.reject(new Error(String(body.error || 'Could not render xyzrender sheet item')));
      return;
    }
    if (typeof body.svg !== 'string' || !body.svg.trim()) {
      pending.reject(new Error('Host returned no xyzrender SVG payload'));
      return;
    }
    pending.resolve({
      svg: body.svg,
      preset: body.preset || null,
      elapsedMs: body.elapsedMs || null,
      log: body.log || ''
    });
  }

  function addXyzrenderSheetItem(sheet, svg, path, point, serial, getStageScale, entry = path) {
    const item = document.createElement('div');
    item.className = 'buret-xyzrender-sheet-item buret-xyzrender-sheet-item-large selected';
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-label', `Sheet structure ${path}`);
    setXyzrenderSheetItemEntry(item, entry);
    const rect = sheet.getBoundingClientRect();
    const fallbackX = rect.width * (0.42 + ((serial - 1) % 4) * 0.06);
    const fallbackY = rect.height * (0.42 + (Math.floor((serial - 1) / 4) % 4) * 0.06);
    item.style.left = `${Number.isFinite(point?.x) ? point.x : fallbackX}px`;
    item.style.top = `${Number.isFinite(point?.y) ? point.y : fallbackY}px`;
    item.innerHTML = `<div class="buret-xyzrender-sheet-item-background"></div><div class="buret-xyzrender-sheet-item-body">${svg}</div>${rotatableArtifactControlsHTML()}<div class="buret-xyzrender-sheet-item-label">${escapeHTML(path.split('/').pop() || path)}</div>`;
    sheet.appendChild(item);
    selectRotatableArtifact(item);
    installXyzrenderSheetItemInteractions(item, getStageScale, { removable: true });
  }

  function setSheetItemRotation(item, rotation) {
    const normalized = Number.isFinite(rotation) ? rotation : 0;
    item.dataset.rotation = String(normalized);
    item.style.setProperty('--buret-sheet-rotation', `${normalized}deg`);
    item.style.setProperty('--buret-sheet-rotation-negative', `${-normalized}deg`);
    updateRotatableArtifactDegree(item, normalized);
  }

  function normalizedDisplayRotation(rotation) {
    const normalized = ((((Number(rotation) || 0) + 180) % 360) + 360) % 360 - 180;
    return Object.is(normalized, -0) ? 0 : normalized;
  }

  function snapRotation(rotation, event) {
    const step = event?.ctrlKey ? 1 : 15;
    return Math.round(rotation / step) * step;
  }

  function updateRotatableArtifactDegree(item, rotation) {
    const displayRotation = Math.round(normalizedDisplayRotation(rotation));
    item.dataset.currentDegree = String(displayRotation);
    item.style.setProperty('--buret-active-angle', `${displayRotation + 180}deg`);
    item.querySelectorAll('.buret-xyzrender-rotate-current span, .buret-xyzrender-rotate-handle-degree').forEach(node => {
      node.textContent = `${displayRotation}°`;
    });
    item.querySelectorAll('.buret-xyzrender-rotate-label').forEach(node => {
      node.classList.toggle('active', Number(node.getAttribute('data-buret-degree')) === displayRotation);
    });
  }

  function resetRotatableArtifactRotateRadius(item) {
    if (!item) return;
    const rect = item.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const radius = Math.min(520, Math.max(48, rect.height / 2 + 24));
    item.style.setProperty('--buret-rotate-radius', `${radius.toFixed(1)}px`);
    item.style.setProperty('--buret-rotate-lift', `${Math.max(18, radius - rect.height / 2).toFixed(1)}px`);
  }

  function updateRotatableArtifactRotateRadius(item, event) {
    if (!item || !event) return;
    const rect = item.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distance = Math.hypot(event.clientX - centerX, event.clientY - centerY);
    if (!Number.isFinite(distance) || distance <= 0) return;
    const minRadius = Math.max(48, Math.min(rect.width, rect.height) * 0.28);
    const maxRadius = Math.max(minRadius, Math.min(360, Math.max(rect.width, rect.height) * 0.88));
    const nextRadius = Math.min(maxRadius, Math.max(minRadius, distance));
    item.style.setProperty('--buret-rotate-radius', `${nextRadius.toFixed(1)}px`);
    item.style.setProperty('--buret-rotate-lift', `${Math.max(18, nextRadius - rect.height / 2).toFixed(1)}px`);
  }

  function selectRotatableArtifact(item) {
    const root = item?.closest?.('.buret-external-artifact-root') || document;
    root.querySelectorAll('.buret-xyzrender-sheet-item.selected').forEach(existing => {
      if (existing !== item) existing.classList.remove('selected');
    });
    item.classList.add('selected');
    bringXyzrenderSheetItemToFront(item, root);
  }

  function bringXyzrenderSheetItemToFront(item, root = document) {
    const current = Number(root?.dataset?.buretXyzrenderTopZ || 20);
    const next = Math.max(20, current) + 1;
    if (root?.dataset) root.dataset.buretXyzrenderTopZ = String(next);
    item.style.zIndex = String(next);
  }

  function selectAllRotatableArtifacts(root = document) {
    root.querySelectorAll('.buret-xyzrender-sheet-item').forEach(item => {
      item.classList.add('selected');
    });
  }

  function clearRotatableArtifactSelection(root = document) {
    root.querySelectorAll('.buret-xyzrender-sheet-item.selected').forEach(existing => {
      existing.classList.remove('selected');
      existing.classList.remove('rotating', 'resizing', 'dragging');
    });
  }

  function installRotatableArtifactSelectionClear(root) {
    if (!root || root.dataset.buretSelectionClearInstalled === 'true') return;
    root.dataset.buretSelectionClearInstalled = 'true';
    const clearSelectionOnPointerDown = event => {
      if (event.button !== 0) return;
      if (event.target?.closest?.('.buret-xyzrender-sheet-item, #buret-toolbar, .buret-xyzrender-popover, .buret-xyz-badge')) return;
      clearRotatableArtifactSelection(root);
    };
    root.addEventListener('pointerdown', clearSelectionOnPointerDown, true);
    document.addEventListener('pointerdown', clearSelectionOnPointerDown, true);
    root.addEventListener('click', clearSelectionOnPointerDown, true);
    document.addEventListener('click', clearSelectionOnPointerDown, true);
  }

  function installRotatableArtifactKeyboard(item, options = {}) {
    const removable = options.removable !== false;
    const onKeyDown = event => {
      if ((event.key === 'Backspace' || event.key === 'Delete') && removable && item.classList.contains('selected')) {
        event.preventDefault();
        item.remove();
        return;
      }
      if (!item.classList.contains('selected')) return;
      if (event.key === '[' || event.key === ']') {
        event.preventDefault();
        const direction = event.key === ']' ? 1 : -1;
        setSheetItemRotation(item, (parseFloat(item.dataset.rotation || '0') || 0) + direction * 15);
        return;
      }
      if (event.key === '0') {
        event.preventDefault();
        setSheetItemRotation(item, 0);
      }
    };
    item.addEventListener('keydown', onKeyDown);
  }

  function localResizeDelta(dx, dy, rotationRadians) {
    const cos = Math.cos(rotationRadians);
    const sin = Math.sin(rotationRadians);
    return {
      x: dx * cos + dy * sin,
      y: -dx * sin + dy * cos
    };
  }

  function screenDeltaFromLocal(dx, dy, rotationRadians) {
    const cos = Math.cos(rotationRadians);
    const sin = Math.sin(rotationRadians);
    return {
      x: dx * cos - dy * sin,
      y: dx * sin + dy * cos
    };
  }

  function sheetItemCenterPosition(item) {
    const inlineLeft = String(item.style.left || '');
    const inlineTop = String(item.style.top || '');
    if (inlineLeft.endsWith('px') && inlineTop.endsWith('px')) {
      return {
        left: parseFloat(inlineLeft) || 0,
        top: parseFloat(inlineTop) || 0
      };
    }
    const parentRect = item.offsetParent?.getBoundingClientRect?.() || item.parentElement?.getBoundingClientRect?.();
    const rect = item.getBoundingClientRect();
    if (parentRect && rect.width > 0 && rect.height > 0) {
      return {
        left: rect.left - parentRect.left + rect.width / 2,
        top: rect.top - parentRect.top + rect.height / 2
      };
    }
    return {
      left: item.offsetLeft || 0,
      top: item.offsetTop || 0
    };
  }

  function initializeSheetItemCenterPosition(item) {
    const inlineLeft = String(item?.style?.left || '');
    const inlineTop = String(item?.style?.top || '');
    if (inlineLeft.endsWith('px') && inlineTop.endsWith('px')) return;
    const position = sheetItemCenterPosition(item);
    item.style.left = `${position.left}px`;
    item.style.top = `${position.top}px`;
  }

  function installRotatableArtifactResize(item, getStageScale) {
    if (!item || item.dataset.buretResizeInstalled === 'true') return;
    item.dataset.buretResizeInstalled = 'true';
    const minSize = 72;
    const maxSize = 1800;
    let pointerId = null;
    let handleName = '';
    let startX = 0;
    let startY = 0;
    let startWidth = 0;
    let startHeight = 0;
    let startLeft = 0;
    let startTop = 0;
    let startRotation = 0;

    const setSheetItemSize = (width, height) => {
      item.style.width = `${width.toFixed(2)}px`;
      item.style.height = `${height.toFixed(2)}px`;
    };

    const setCenterOffset = (dx, dy) => {
      item.style.left = `${(startLeft + dx).toFixed(2)}px`;
      item.style.top = `${(startTop + dy).toFixed(2)}px`;
    };

    const onPointerDown = event => {
      if (event.button !== 0) return;
      const handle = event.target?.closest?.('[data-buret-resize-handle]');
      if (!handle || !item.contains(handle)) return;
      event.preventDefault();
      event.stopPropagation();
      selectRotatableArtifact(item);
      try { item.focus({ preventScroll: true }); } catch (_) {}
      pointerId = event.pointerId;
      handleName = String(handle.getAttribute('data-buret-resize-handle') || '');
      startX = event.clientX;
      startY = event.clientY;
      startWidth = parseFloat(item.style.width || '') || item.offsetWidth || item.getBoundingClientRect().width;
      startHeight = parseFloat(item.style.height || '') || item.offsetHeight || item.getBoundingClientRect().height;
      const position = sheetItemCenterPosition(item);
      startLeft = position.left;
      startTop = position.top;
      startRotation = ((parseFloat(item.dataset.rotation || '0') || 0) * Math.PI) / 180;
      item.classList.add('resizing');
      try { handle.setPointerCapture(event.pointerId); } catch (_) {}
    };

    const onPointerMove = event => {
      if (pointerId !== event.pointerId) return;
      const stageScale = Math.max(0.05, Number(getStageScale?.() || 1));
      const delta = localResizeDelta((event.clientX - startX) / stageScale, (event.clientY - startY) / stageScale, startRotation);
      let nextWidth = startWidth;
      let nextHeight = startHeight;
      let centerLocalX = 0;
      let centerLocalY = 0;

      if (handleName.includes('e')) {
        nextWidth = Math.min(maxSize, Math.max(minSize, startWidth + delta.x));
        centerLocalX = (nextWidth - startWidth) / 2;
      }
      if (handleName.includes('w')) {
        nextWidth = Math.min(maxSize, Math.max(minSize, startWidth - delta.x));
        centerLocalX = -(nextWidth - startWidth) / 2;
      }
      if (handleName.includes('s')) {
        nextHeight = Math.min(maxSize, Math.max(minSize, startHeight + delta.y));
        centerLocalY = (nextHeight - startHeight) / 2;
      }
      if (handleName.includes('n')) {
        nextHeight = Math.min(maxSize, Math.max(minSize, startHeight - delta.y));
        centerLocalY = -(nextHeight - startHeight) / 2;
      }

      const center = screenDeltaFromLocal(centerLocalX, centerLocalY, startRotation);
      setCenterOffset(center.x, center.y);
      setSheetItemSize(nextWidth, nextHeight);
      resetRotatableArtifactRotateRadius(item);
    };

    const finish = event => {
      if (pointerId !== event.pointerId) return;
      pointerId = null;
      item.classList.remove('resizing');
      try { event.target?.releasePointerCapture?.(event.pointerId); } catch (_) {}
    };

    item.addEventListener('pointerdown', onPointerDown);
    item.addEventListener('pointermove', onPointerMove);
    item.addEventListener('pointerup', finish);
    item.addEventListener('pointercancel', finish);
  }

  function installExternalArtifactBaseItemInteractions(root, getStageScale) {
    if (!root) return;
    installRotatableArtifactSelectionClear(root);
    installXyzrenderContextMenuInterception(root);
    const readStageScale = getStageScale || (() => parseFloat(root.dataset.buretXyzrenderStageScale || '1') || 1);
    root.querySelectorAll('.buret-xyzrender-sheet-item-base').forEach(item => {
      setXyzrenderSheetItemEntry(item, baseXyzrenderSheetEntry());
      installXyzrenderSheetItemInteractions(item, readStageScale, { removable: false });
    });
  }

  function installXyzrenderContextMenuInterception(root) {
    if (!root || root.dataset.buretContextMenuInterceptInstalled === 'true') return;
    root.dataset.buretContextMenuInterceptInstalled = 'true';
    const intercept = event => {
      const item = xyzrenderSheetItemFromContextEvent(event, root);
      if (!item) return;
      showXyzrenderSheetContextMenu(event, item);
    };
    root.addEventListener('contextmenu', intercept, true);
    document.addEventListener('contextmenu', intercept, true);
  }

  function xyzrenderSheetItemFromContextEvent(event, root = document) {
    const target = event.target instanceof Element ? event.target : null;
    const direct = target?.closest?.('.buret-xyzrender-sheet-item');
    if (direct && root.contains(direct)) return direct;
    const hit = document.elementFromPoint?.(event.clientX, event.clientY);
    const hitItem = hit?.closest?.('.buret-xyzrender-sheet-item');
    if (hitItem && root.contains(hitItem)) return hitItem;
    return Array.from(root.querySelectorAll('.buret-xyzrender-sheet-item')).find(item => {
      const rect = item.getBoundingClientRect();
      return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    }) || (() => {
      const rootRect = root.getBoundingClientRect?.();
      if (!rootRect || event.clientX < rootRect.left || event.clientX > rootRect.right || event.clientY < rootRect.top || event.clientY > rootRect.bottom) return null;
      return Array.from(root.querySelectorAll('.buret-xyzrender-sheet-item')).find(item => hasHiddenXyzrenderElements(item)) || null;
    })();
  }

  function installXyzrenderSheetItemInteractions(item, getStageScale, options = {}) {
    if (!item || item.dataset.buretRotatableInstalled === 'true') return;
    item.dataset.buretRotatableInstalled = 'true';
    initializeSheetItemCenterPosition(item);
    item.addEventListener('contextmenu', event => showXyzrenderSheetContextMenu(event, item));
    item.addEventListener('click', event => {
      if (event.button !== 0) return;
      event.stopPropagation();
      selectRotatableArtifact(item);
      try { item.focus({ preventScroll: true }); } catch (_) {}
    });
    item.addEventListener('dblclick', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      selectAllRotatableArtifacts(item.closest('.buret-external-artifact-root') || document);
    });
    installXyzrenderSheetItemDrag(item, getStageScale);
    installXyzrenderSheetItemRotation(item);
    installRotatableArtifactResize(item, getStageScale);
    installRotatableArtifactKeyboard(item, options);
    updateRotatableArtifactDegree(item, parseFloat(item.dataset.rotation || '0') || 0);
    resetRotatableArtifactRotateRadius(item);
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => resetRotatableArtifactRotateRadius(item));
      observer.observe(item);
    }
  }

  function installXyzrenderSheetItemDrag(item, getStageScale) {
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    const onPointerDown = event => {
      if (xyzrenderLassoEnabled) return;
      if (event.button !== 0) return;
      if (event.target?.closest?.('.buret-xyzrender-sheet-rotate-handle, [data-buret-resize-handle]')) return;
      event.preventDefault();
      event.stopPropagation();
      selectRotatableArtifact(item);
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      const position = sheetItemCenterPosition(item);
      startLeft = position.left;
      startTop = position.top;
      item.classList.add('dragging');
      try { item.setPointerCapture(event.pointerId); } catch (_) {}
    };
    const onPointerMove = event => {
      if (pointerId !== event.pointerId) return;
      const stageScale = Math.max(0.05, Number(getStageScale?.() || 1));
      item.style.left = `${startLeft + (event.clientX - startX) / stageScale}px`;
      item.style.top = `${startTop + (event.clientY - startY) / stageScale}px`;
    };
    const finish = event => {
      if (pointerId !== event.pointerId) return;
      pointerId = null;
      item.classList.remove('dragging');
      try { item.releasePointerCapture(event.pointerId); } catch (_) {}
    };
    item.addEventListener('pointerdown', onPointerDown);
    item.addEventListener('pointermove', onPointerMove);
    item.addEventListener('pointerup', finish);
    item.addEventListener('pointercancel', finish);
    item.addEventListener('click', event => { event.stopPropagation(); selectRotatableArtifact(item); });
  }

  function installXyzrenderSheetItemRotation(item) {
    const handle = item.querySelector('.buret-xyzrender-sheet-rotate-handle');
    if (!handle) return;
    let pointerId = null;
    let startAngle = 0;
    let startRotation = 0;
    const removeGlobalRotationGuards = () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', cancelRotation);
    };
    const cancelRotation = () => {
      pointerId = null;
      item.classList.remove('rotating');
      removeGlobalRotationGuards();
    };
    const angleForEvent = event => {
      const rect = item.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      return Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180 / Math.PI;
    };
    const onPointerDown = event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      selectRotatableArtifact(item);
      try { item.focus({ preventScroll: true }); } catch (_) {}
      pointerId = event.pointerId;
      updateRotatableArtifactRotateRadius(item, event);
      startAngle = angleForEvent(event);
      startRotation = parseFloat(item.dataset.rotation || '0') || 0;
      item.classList.add('rotating');
      try { handle.setPointerCapture(event.pointerId); } catch (_) {}
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
      window.addEventListener('blur', cancelRotation);
    };
    const onPointerMove = event => {
      if (pointerId !== event.pointerId) return;
      updateRotatableArtifactRotateRadius(item, event);
      setSheetItemRotation(item, snapRotation(startRotation + angleForEvent(event) - startAngle, event));
    };
    const finish = event => {
      if (pointerId !== event.pointerId) return;
      pointerId = null;
      item.classList.remove('rotating');
      try { handle.releasePointerCapture(event.pointerId); } catch (_) {}
      removeGlobalRotationGuards();
    };
    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('lostpointercapture', cancelRotation);
    resetRotatableArtifactRotateRadius(item);
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
      root.dataset.buretXyzrenderStageScale = String(scale);
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
    const toStagePoint = (clientX, clientY) => {
      const rect = root.getBoundingClientRect();
      return {
        x: (Number(clientX) - rect.left - translateX) / scale,
        y: (Number(clientY) - rect.top - translateY) / scale
      };
    };
    installExternalArtifactBaseItemInteractions(root, () => scale);
    const sheetCleanup = installExternalArtifactSheet(root, stage, toStagePoint, () => scale);

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
      sheetCleanup?.();
    };
  }

  function prepareSdfStructure(text, config) {
    const label = config.label || 'structure';
    const controlLabel = String(config.sdfPoseControlLabel || 'Pose').trim() || 'Pose';
    const records = splitSdfRecords(text);
    if (records.length >= 1 && config.sdfPosePager === true) {
      const molecules = records.map(parseV2000SdfRecord);
      const allMoleculesParsed = molecules.every(Boolean);
      const collection = records.length > 1 && allMoleculesParsed
        ? sdfMoleculesToPdbCollection(molecules, label)
        : null;
      if (collection) {
        const activePose = readTrajectoryControlIndex(config, { kind: 'sdf-collection', controlLabel }, records.length);
        return {
          kind: 'sdf-collection',
          data: collection.data,
          format: 'pdb',
          label: `${label} (${records.length} molecules)`,
          loadPreset: 'default',
          nativeTrajectoryControls: false,
          poseCount: records.length,
          activePose,
          controlLabel,
          sdfPoseMode: 'collection',
          sdfPoseOverlayAvailable: true,
          sdfPoseRecordCount: records.length,
          collectionResidues: collection.residues,
          collectionSinglePdbs: collection.singlePdbs,
          collectionMolecules: collection.molecules
        };
      }
      const activeRecord = readTrajectoryControlIndex(config, { controlLabel }, records.length);
      const recordText = `${records[activeRecord].replace(/\n?\$\$\$\$\s*$/u, '').trimEnd()}\n$$$$\n`;
      const pdbText = molecules[activeRecord]
        ? sdfMoleculesToPdbStructure([molecules[activeRecord]], `${label} ${controlLabel} ${activeRecord + 1}`)
        : null;
      return {
        data: pdbText || recordText,
        format: pdbText ? 'pdb' : 'sdf',
        label: `${label} (${controlLabel.toLowerCase()} ${activeRecord + 1} of ${records.length})`,
        loadPreset: 'default',
        nativeTrajectoryControls: false,
        poseCount: records.length,
        activePose: activeRecord,
        controlLabel,
        sdfPoseMode: 'single',
        sdfPoseOverlayAvailable: Boolean(collection),
        sdfPoseRecordCount: records.length
      };
    }
    if (records.length >= 1 && config.sdfGrid !== false) {
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

  function prepareXyzStructure(text, config) {
    const label = config.label || 'structure';
    const frames = splitXyzFrames(text);
    if (frames.length > 1) {
      const overlay = buildXyzFrameOverlay(frames, label);
      return {
        data: text,
        format: 'xyz',
        label: `${label} (${frames.length} XYZ frames)`,
        loadPreset: 'default',
        nativeTrajectoryControls: true,
        activePose: readTrajectoryControlIndex(config, { controlLabel: 'Frame' }, frames.length),
        poseCount: frames.length,
        controlLabel: 'Frame',
        xyzFrameMode: 'single',
        xyzFrameOverlayAvailable: Boolean(overlay),
        xyzFrameCount: frames.length
      };
    }
    return {
      data: text,
      format: 'xyz',
      label
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

  function buildSdfPoseOverlay(records, label) {
    const molecules = [];
    let totalAtoms = 0;
    let totalBonds = 0;
    for (const record of records) {
      const molecule = parseV2000SdfRecord(record);
      if (!molecule) return null;
      molecules.push(molecule);
      totalAtoms += molecule.atomCount;
      totalBonds += molecule.bondCount;
    }
    if (molecules.length <= 1 || totalAtoms <= 0) return null;

    const atoms = [];
    const bonds = [];
    let atomIndex = 1;
    let bondIndex = 1;
    let atomOffset = 0;
    for (const molecule of molecules) {
      for (const atom of molecule.atoms) {
        atoms.push(`M  V30 ${atomIndex} ${atom.element} ${formatV3000Coord(atom.x)} ${formatV3000Coord(atom.y)} ${formatV3000Coord(atom.z)} 0`);
        atomIndex += 1;
      }
      for (const bond of molecule.bonds) {
        bonds.push(`M  V30 ${bondIndex} ${bond.order} ${bond.a + atomOffset} ${bond.b + atomOffset}`);
        bondIndex += 1;
      }
      atomOffset += molecule.atomCount;
    }

    return {
      data: [
        'Burrete SDF Pose Overlay',
        '  Burrete',
        `${molecules.length} poses overlaid from ${label}`,
        '  0  0  0     0  0            999 V3000',
        'M  V30 BEGIN CTAB',
        `M  V30 COUNTS ${totalAtoms} ${totalBonds} 0 0 0`,
        'M  V30 BEGIN ATOM',
        ...atoms,
        'M  V30 END ATOM',
        'M  V30 BEGIN BOND',
        ...bonds,
        'M  V30 END BOND',
        'M  V30 END CTAB',
        'M  END',
        '$$$$',
        ''
      ].join('\n'),
      format: 'sdf',
      label: `${label} (all ${molecules.length} poses)`,
      loadPreset: 'default'
    };
  }

  function sdfRecordToPdbStructure(record, label) {
    const molecule = parseV2000SdfRecord(record);
    return molecule ? sdfMoleculesToPdbStructure([molecule], label) : null;
  }

  function sdfMoleculesToPdbCollection(molecules, label) {
    const totalAtoms = molecules.reduce((sum, molecule) => sum + molecule.atomCount, 0);
    if (totalAtoms <= 0 || totalAtoms > 99999) return null;
    const residues = molecules.map((molecule, index) => ({
      index,
      chainId: 'A',
      seqId: 1,
      compId: 'MOL',
      label: `Molecule ${index + 1}`,
      atomCount: molecule.atomCount
    }));
    const lines = [
      `REMARK ${String(label || 'Burrete molecule collection').slice(0, 66)}`,
      `REMARK Burrete SDF collection with ${molecules.length} molecules`
    ];
    let serialOffset = 0;
    const adjacency = new Map();
    molecules.forEach((molecule, moleculeIndex) => {
      const residue = residues[moleculeIndex];
      lines.push(`REMARK ${residue.label}`);
      for (let index = 0; index < molecule.atoms.length; index += 1) {
        lines.push(pdbAtomLine(serialOffset + index + 1, molecule.atoms[index], {
          chainId: residue.chainId,
          seqId: residue.seqId,
          compId: residue.compId
        }));
      }
      for (const bond of molecule.bonds) {
        const a = serialOffset + bond.a;
        const b = serialOffset + bond.b;
        if (!adjacency.has(a)) adjacency.set(a, new Set());
        if (!adjacency.has(b)) adjacency.set(b, new Set());
        adjacency.get(a).add(b);
        adjacency.get(b).add(a);
      }
      serialOffset += molecule.atomCount;
    });
    appendPdbConectLines(lines, adjacency);
    lines.push('END', '');
    const singlePdbs = molecules.map((molecule, index) => (
      sdfMoleculesToPdbStructure([molecule], `${label || 'Burrete molecule'} Molecule ${index + 1}`)
    ));
    return { data: lines.join('\n'), residues, singlePdbs, molecules };
  }

  function sdfMoleculesToPdbStructure(molecules, label) {
    const totalAtoms = molecules.reduce((sum, molecule) => sum + molecule.atomCount, 0);
    if (totalAtoms <= 0 || totalAtoms > 99999) return null;
    const lines = [`REMARK ${String(label || 'Burrete molecule').slice(0, 66)}`];
    let serialOffset = 0;
    const adjacency = new Map();
    for (const molecule of molecules) {
      for (let index = 0; index < molecule.atoms.length; index += 1) {
        lines.push(pdbAtomLine(serialOffset + index + 1, molecule.atoms[index]));
      }
      for (const bond of molecule.bonds) {
        const a = serialOffset + bond.a;
        const b = serialOffset + bond.b;
        if (!adjacency.has(a)) adjacency.set(a, new Set());
        if (!adjacency.has(b)) adjacency.set(b, new Set());
        adjacency.get(a).add(b);
        adjacency.get(b).add(a);
      }
      serialOffset += molecule.atomCount;
    }
    appendPdbConectLines(lines, adjacency);
    lines.push('END', '');
    return lines.join('\n');
  }

  function sdfCollectionBackgroundPdb(prepared, activeIndex) {
    const molecules = Array.isArray(prepared?.collectionMolecules) ? prepared.collectionMolecules : [];
    if (molecules.length <= 1) return null;
    const background = molecules.filter((_, index) => index !== activeIndex);
    if (background.length === 0) return null;
    return sdfMoleculesToPdbStructure(background, `${prepared.label || 'Molecule collection'} background`);
  }

  function appendPdbConectLines(lines, adjacency) {
    for (const [serial, targets] of Array.from(adjacency.entries()).sort((a, b) => a[0] - b[0])) {
      const orderedTargets = Array.from(targets).sort((a, b) => a - b);
      for (let index = 0; index < orderedTargets.length; index += 4) {
        lines.push(`CONECT${String(serial).padStart(5, ' ')}${orderedTargets.slice(index, index + 4).map(target => String(target).padStart(5, ' ')).join('')}`);
      }
    }
  }

  function splitXyzFrames(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const frames = [];
    let index = 0;
    while (index < lines.length) {
      while (index < lines.length && !lines[index].trim()) index += 1;
      if (index >= lines.length) break;
      const atomCount = Number.parseInt(lines[index].trim().split(/\s+/u)[0] || '', 10);
      if (!Number.isFinite(atomCount) || atomCount <= 0 || index + atomCount + 1 >= lines.length) return [];
      const atoms = [];
      for (let offset = 0; offset < atomCount; offset += 1) {
        const parts = (lines[index + 2 + offset] || '').trim().split(/\s+/u);
        if (parts.length < 4) return [];
        const x = Number(parts[1]);
        const y = Number(parts[2]);
        const z = Number(parts[3]);
        if (![x, y, z].every(Number.isFinite)) return [];
        atoms.push({
          symbol: normalizeElementSymbol(parts[0]),
          x,
          y,
          z
        });
      }
      frames.push({ atoms });
      index += atomCount + 2;
    }
    return frames;
  }

  function buildXyzFrameOverlay(frames, label) {
    const totalAtoms = frames.reduce((sum, frame) => sum + frame.atoms.length, 0);
    if (frames.length <= 1 || totalAtoms <= 0) return null;
    const lines = [
      String(totalAtoms),
      `${frames.length} XYZ frames overlaid from ${label}`
    ];
    frames.forEach(frame => {
      frame.atoms.forEach(atom => {
        lines.push([
          atom.symbol,
          formatCoordinate(atom.x),
          formatCoordinate(atom.y),
          formatCoordinate(atom.z)
        ].join(' '));
      });
    });
    return {
      data: lines.join('\n') + '\n',
      format: 'xyz',
      label: `${label} (all ${frames.length} frames)`,
      loadPreset: 'default'
    };
  }

  function xyzFrameEntry(frame, label) {
    const atoms = Array.isArray(frame?.atoms) ? frame.atoms : [];
    if (!atoms.length) return null;
    return {
      data: [
        String(atoms.length),
        label,
        ...atoms.map(atom => [
          atom.symbol,
          formatCoordinate(atom.x),
          formatCoordinate(atom.y),
          formatCoordinate(atom.z)
        ].join(' '))
      ].join('\n') + '\n',
      format: 'xyz',
      label
    };
  }

  function xyzFramesCombinedEntry(frames, indexes, label) {
    const selectedAtoms = [];
    for (const index of indexes) {
      const atoms = Array.isArray(frames[index]?.atoms) ? frames[index].atoms : [];
      selectedAtoms.push(...atoms);
    }
    if (!selectedAtoms.length) return null;
    return {
      data: [
        String(selectedAtoms.length),
        label,
        ...selectedAtoms.map(atom => [
          atom.symbol,
          formatCoordinate(atom.x),
          formatCoordinate(atom.y),
          formatCoordinate(atom.z)
        ].join(' '))
      ].join('\n') + '\n',
      format: 'xyz',
      label
    };
  }

  function sampledXyzFrameBackgroundIndexes(frameCount, activeIndex) {
    const count = Math.max(0, Math.trunc(Number(frameCount) || 0));
    if (count <= 1) return [];
    const all = Array.from({ length: count }, (_, index) => index).filter(index => index !== activeIndex);
    if (all.length <= XYZ_FRAME_OVERLAY_BACKGROUND_LIMIT) return all;
    const picked = new Set();
    const last = count - 1;
    for (let slot = 0; slot < XYZ_FRAME_OVERLAY_BACKGROUND_LIMIT; slot += 1) {
      const rawIndex = Math.round((slot * last) / Math.max(1, XYZ_FRAME_OVERLAY_BACKGROUND_LIMIT - 1));
      const candidates = [rawIndex];
      for (let delta = 1; delta < count && candidates.length < count; delta += 1) {
        candidates.push(rawIndex - delta, rawIndex + delta);
      }
      const next = candidates.find(index => index >= 0 && index < count && index !== activeIndex && !picked.has(index));
      if (next !== undefined) picked.add(next);
    }
    return Array.from(picked).sort((left, right) => left - right);
  }

  function xyzFrameBackgroundLayerOpacity(contextOpacity, layerCount) {
    const opacity = normalizeSdfCollectionContextOpacity(contextOpacity);
    const count = Math.max(1, Math.trunc(Number(layerCount) || 0));
    if (count <= 1 || opacity >= 1) return opacity;
    return 1 - Math.pow(1 - opacity, 1 / count);
  }

  function xyzFrameOverlayRawSignature(raw) {
    const text = String(raw || '');
    if (!text) return 'empty';
    const hashText = text.length > 8192 ? `${text.slice(0, 4096)}\n${text.slice(-4096)}` : text;
    return `${text.length}:${stableTextHash(hashText)}`;
  }

  function xyzFrameOverlayStateKey(rawSignature, frames, prepared, style, contextStyle, contextOpacity, contextColor, backgroundIndexes) {
    return [
      activeConfig?.documentId || '',
      prepared?.label || '',
      rawSignature,
      frames.length,
      style,
      contextStyle,
      contextOpacity,
      contextColor,
      backgroundIndexes.join(',')
    ].join('|');
  }

  function resetXyzFrameOverlayState(viewer = null) {
    if (!viewer || activeXyzFrameOverlayState?.viewer === viewer) {
      activeXyzFrameOverlayState = null;
    }
  }

  async function removeMolstarStructures(viewer, structures) {
    const list = Array.from(structures || []).filter(Boolean);
    if (!list.length) return;
    const hierarchy = viewer?.plugin?.managers?.structure?.hierarchy;
    if (typeof hierarchy?.remove !== 'function') return;
    try {
      await hierarchy.remove(list, false);
    } catch (error) {
      debug('Mol* structure removal failed: ' + (error && error.message || String(error)));
    }
  }

  function xyzFrameOverlayStateStillLoaded(viewer, state) {
    if (!state || state.viewer !== viewer) return false;
    const structures = Array.from(molstarCurrentStructures(viewer));
    const background = Array.isArray(state.backgroundStructures) ? state.backgroundStructures : [];
    if (!background.length) return false;
    return background.every(structure => structures.includes(structure));
  }

  function sdfCollectionStateKey(prepared, style, allMode, contextStyle, contextOpacity, contextColor) {
    return [
      activeConfig?.documentId || '',
      prepared?.label || '',
      Number(prepared?.poseCount || prepared?.sdfPoseRecordCount || 0),
      style,
      allMode ? 'all' : 'single',
      contextStyle,
      contextOpacity,
      contextColor
    ].join('|');
  }

  function resetSdfCollectionVisibilityState(viewer = null) {
    if (!viewer || activeSdfCollectionVisibilityState?.viewer === viewer) {
      activeSdfCollectionVisibilityState = null;
    }
  }

  function sdfCollectionVisibilityStateStillLoaded(viewer, state) {
    if (!state || state.viewer !== viewer) return false;
    const structures = Array.from(molstarCurrentStructures(viewer));
    const background = Array.isArray(state.backgroundStructures) ? state.backgroundStructures : [];
    const active = Array.isArray(state.activeStructures) ? state.activeStructures : [];
    const required = background.length ? background : active;
    return required.length > 0 && required.every(structure => structures.includes(structure));
  }

  function parseV2000SdfRecord(record) {
    const lines = String(record || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const countsIndex = lines.findIndex(line => /\bV2000\b/u.test(line) || /^\s*\d+\s+\d+\s+/.test(line));
    if (countsIndex < 0 || lines[countsIndex].includes('V3000')) return null;
    const countParts = lines[countsIndex].trim().split(/\s+/u);
    const atomCount = parseInt(lines[countsIndex].slice(0, 3), 10) || parseInt(countParts[0], 10);
    const bondCount = parseInt(lines[countsIndex].slice(3, 6), 10) || parseInt(countParts[1], 10);
    if (!Number.isFinite(atomCount) || !Number.isFinite(bondCount) || atomCount <= 0 ||
        lines.length < countsIndex + 1 + atomCount + bondCount) {
      return null;
    }

    const atoms = [];
    for (let i = 0; i < atomCount; i++) {
      const line = lines[countsIndex + 1 + i] || '';
      const atom = parseSdfAtomLine(line);
      if (!atom) return null;
      atoms.push(atom);
    }
    const bonds = [];
    for (let i = 0; i < bondCount; i++) {
      const bond = parseSdfBondLine(lines[countsIndex + 1 + atomCount + i] || '');
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
    let element = normalizeSdfElement(tail.trim().split(/\s+/)[0]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      const parts = line.trim().split(/\s+/);
      x = Number(parts[0]);
      y = Number(parts[1]);
      z = Number(parts[2]);
      element = normalizeSdfElement(parts[3]);
      tail = ` ${element}   0  0  0  0  0  0  0  0  0  0  0  0`;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return { x, y, z, element, tail: tail || ' C   0  0  0  0  0  0  0  0  0  0  0  0' };
  }

  function parseSdfBondLine(line) {
    let a = parseInt(line.slice(0, 3), 10);
    let b = parseInt(line.slice(3, 6), 10);
    let tail = line.length >= 6 ? line.slice(6) : '';
    let order = normalizeSdfBondOrder(tail.trim().split(/\s+/)[0]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      const parts = line.trim().split(/\s+/);
      a = parseInt(parts[0], 10);
      b = parseInt(parts[1], 10);
      order = normalizeSdfBondOrder(parts[2]);
      tail = ` ${order}  0  0  0  0`;
    }
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return { a, b, order, tail: tail || '  1  0  0  0  0' };
  }

  function normalizeSdfElement(value) {
    const text = String(value || '').trim();
    return /^[A-Z][a-z]?$/u.test(text) ? text : 'C';
  }

  function normalizeSdfBondOrder(value) {
    const order = parseInt(value, 10);
    return Number.isFinite(order) && order > 0 ? order : 1;
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

  function formatV3000Coord(value) {
    return Number(value).toFixed(6);
  }

  function padSdfInt(value) {
    return String(value).padStart(3, ' ');
  }

  function molstarCurrentStructures(viewer) {
    return viewer?.plugin?.managers?.structure?.hierarchy?.current?.structures || [];
  }

  function isMolstarBoxComponent(component) {
    const key = String(component?.key || '').toLowerCase();
    const label = String(component?.cell?.obj?.label || '').trim().toLowerCase();
    return key.includes('box') || label === 'box' || label.includes(' box');
  }

  async function tryCreateMolstarComponent(plugin, structure, kind) {
    for (const target of [structure?.cell, structure]) {
      if (!target) continue;
      try {
        const component = await plugin.builders.structure.tryCreateComponentStatic(target, kind);
        if (component) return component;
      } catch (error) {
        debug(`Mol* static ${kind} component creation failed: ` + (error && error.message || String(error)));
      }
      if (kind === 'all') {
        try {
          const allExpression = molstarAllAtomsExpression();
          if (allExpression) {
            const component = await plugin.builders.structure.tryCreateComponentFromExpression(
              target,
              allExpression,
              'burette-all',
              { label: 'All' }
            );
            if (component) return component;
          }
        } catch (error) {
          debug('Mol* expression all component creation failed: ' + (error && error.message || String(error)));
        }
      }
    }
    return null;
  }

  function molstarAllAtomsExpression() {
    const lib = molstarExportLib();
    const builder = lib.MolScriptBuilder || lib.molScript?.MolScriptBuilder || lib.script?.MolScriptBuilder;
    return builder?.struct?.generator?.all?.() || builder?.struct?.generator?.all || null;
  }

  async function applySdfCollectionVisibility(viewer, prepared, activePose = 0, options = {}) {
    if (!viewer || prepared?.kind !== 'sdf-collection') return;
    const plugin = viewer.plugin;
    if (!plugin?.builders?.data?.rawData || !plugin?.builders?.structure?.parseTrajectory || !plugin?.builders?.structure?.hierarchy?.applyPreset) {
      throw new Error('Mol* structure builders are not available in this runtime.');
    }
    const allMode = activeSdfPoseMode === 'all';
    const singlePdbs = Array.isArray(prepared.collectionSinglePdbs) ? prepared.collectionSinglePdbs : [];
    const activeIndex = Math.max(0, Math.min(singlePdbs.length - 1, Math.trunc(Number(activePose) || 0)));
    const activeData = singlePdbs[activeIndex];
    if (!activeData) throw new Error('Mol* collection molecule data is unavailable.');
    const style = configuredMolstarStyle(activeConfig);
    const contextStyle = options.contextStyle ?? readSdfCollectionContextStyle(activeConfig);
    const contextOpacity = options.contextOpacity ?? readSdfCollectionContextOpacity(activeConfig);
    const contextColor = options.contextColor ?? readSdfCollectionContextColor(activeConfig);
    const stateKey = sdfCollectionStateKey(prepared, style, allMode, contextStyle, contextOpacity, contextColor);
    let state = activeSdfCollectionVisibilityState;
    if (!state || state.key !== stateKey || !sdfCollectionVisibilityStateStillLoaded(viewer, state)) {
      resetXyzFrameOverlayState(viewer);
      resetDockingPoseCollectionState(viewer);
      if (typeof plugin.clear === 'function') await plugin.clear();
      const backgroundStructures = [];
      if (allMode) {
        const backgroundData = sdfCollectionBackgroundPdb(prepared, -1);
        if (backgroundData) {
          backgroundStructures.push(...await loadSdfCollectionPdbLayer(viewer, backgroundData, `${prepared.label || 'Molecule collection'} (background)`));
        }
        if (backgroundStructures.length) {
          await applySdfCollectionMolstarStyle(
            viewer,
            contextStyle === 'match' ? style : contextStyle,
            backgroundStructures,
            contextOpacity,
            contextColor
          );
        }
      }
      state = {
        viewer,
        key: stateKey,
        backgroundStructures,
        activeStructures: [],
        activeIndex: -1
      };
      activeSdfCollectionVisibilityState = state;
    }

    if (state.activeIndex === activeIndex && sdfCollectionVisibilityStateStillLoaded(viewer, state)) {
      updateStructureOverlayToggleButton(document.querySelector('[data-buret-action="structure-overlay-toggle"]'), prepared);
      if (options.focus === true) scheduleMolstarStructureFocus(viewer, { reason: 'sdf-collection', durationMs: 180 });
      return;
    }

    await removeMolstarStructures(viewer, state.activeStructures);
    state.activeStructures = [];
    const label = `${prepared.label || 'Molecule collection'} (${prepared.controlLabel || 'Molecule'} ${activeIndex + 1})`;
    const structures = await loadSdfCollectionPdbLayer(viewer, activeData, label);
    await applySdfCollectionMolstarStyle(viewer, style, structures, 1, 'colored');
    state.activeStructures = structures;
    state.activeIndex = activeIndex;
    updateStructureOverlayToggleButton(document.querySelector('[data-buret-action="structure-overlay-toggle"]'), prepared);
    if (options.focus !== false) scheduleMolstarStructureFocus(viewer, { reason: 'sdf-collection', durationMs: 180 });
  }

  function dockingPoseCollectionStateKey(prepared, style, allMode, contextStyle, contextOpacity, contextColor) {
    const receptor = prepared?.receptorEntry || {};
    const poses = Array.isArray(prepared?.poses) ? prepared.poses : [];
    const firstPose = poses[0] || {};
    const lastPose = poses[poses.length - 1] || {};
    return [
      activeConfig?.documentId || '',
      prepared?.label || '',
      receptor.sourcePath || receptor.label || '',
      xyzFrameOverlayRawSignature(receptor.data || ''),
      poses.length,
      firstPose.sourcePath || firstPose.label || '',
      lastPose.sourcePath || lastPose.label || '',
      style,
      allMode ? 'all' : 'single',
      contextStyle,
      contextOpacity,
      contextColor
    ].join('|');
  }

  function resetDockingPoseCollectionState(viewer = null) {
    if (!viewer || activeDockingPoseCollectionState?.viewer === viewer) {
      activeDockingPoseCollectionState = null;
    }
  }

  function dockingPoseCollectionStateStillLoaded(viewer, state) {
    if (!state || state.viewer !== viewer) return false;
    const structures = Array.from(molstarCurrentStructures(viewer));
    const receptor = Array.isArray(state.receptorStructures) ? state.receptorStructures : [];
    const background = Array.isArray(state.backgroundStructures) ? state.backgroundStructures : [];
    const active = Array.isArray(state.activeStructures) ? state.activeStructures : [];
    const required = [...receptor, ...background, ...active];
    return required.length > 0 && required.every(structure => structures.includes(structure));
  }

  async function applyDockingPoseCollectionVisibility(viewer, prepared, activePose = 0, options = {}) {
    if (!viewer || prepared?.kind !== 'docking' || prepared?.dockingSceneMode) return;
    const plugin = viewer.plugin;
    if (!plugin?.builders?.data?.rawData || !plugin?.builders?.structure?.parseTrajectory || !plugin?.builders?.structure?.hierarchy?.applyPreset) {
      throw new Error('Mol* structure builders are not available in this runtime.');
    }
    const poses = Array.isArray(prepared.poses) ? prepared.poses : [];
    if (!poses.length) throw new Error('Docking view has no ligand poses.');
    const activeIndex = Math.max(0, Math.min(poses.length - 1, Math.trunc(Number(activePose) || 0)));
    const activeEntry = poses[activeIndex];
    if (!activeEntry) throw new Error('Docking pose data is unavailable.');
    const style = configuredMolstarStyle(activeConfig);
    const allMode = activeSdfPoseMode === 'all' && prepared.sdfPoseOverlayAvailable === true;
    const contextStyle = options.contextStyle ?? readSdfCollectionContextStyle(activeConfig);
    const resolvedContextStyle = dockingSceneBackgroundStyle(contextStyle, style);
    const contextOpacity = options.contextOpacity ?? readSdfCollectionContextOpacity(activeConfig);
    const contextColor = options.contextColor ?? readSdfCollectionContextColor(activeConfig);
    const stateKey = dockingPoseCollectionStateKey(prepared, style, allMode, resolvedContextStyle, contextOpacity, contextColor);
    let state = activeDockingPoseCollectionState;
    if (!state || state.key !== stateKey || !dockingPoseCollectionStateStillLoaded(viewer, state)) {
      resetXyzFrameOverlayState(viewer);
      resetSdfCollectionVisibilityState(viewer);
      if (typeof plugin.clear === 'function') await plugin.clear();
      const receptorStructures = prepared.receptorEntry
        ? await loadMolstarEntryWithStructureRefs(viewer, prepared.receptorEntry)
        : [];
      if (receptorStructures.length) {
        await applySdfCollectionMolstarStyle(viewer, style, receptorStructures, 1, 'colored');
      }
      const backgroundStructures = [];
      if (allMode) {
        for (const entry of poses) {
          backgroundStructures.push(...await loadMolstarEntryWithStructureRefs(viewer, entry, { representationPreset: 'empty' }));
        }
        if (backgroundStructures.length) {
          await applySdfCollectionMolstarStyle(viewer, resolvedContextStyle, backgroundStructures, contextOpacity, contextColor);
        }
      }
      state = {
        viewer,
        key: stateKey,
        receptorStructures,
        backgroundStructures,
        activeStructures: [],
        activeIndex: -1
      };
      activeDockingPoseCollectionState = state;
    }

    if (state.activeIndex === activeIndex && dockingPoseCollectionStateStillLoaded(viewer, state)) {
      updateStructureOverlayToggleButton(document.querySelector('[data-buret-action="structure-overlay-toggle"]'), prepared);
      if (options.focus === true) scheduleMolstarStructureFocus(viewer, { reason: 'docking-poses', durationMs: 180 });
      return;
    }

    await removeMolstarStructures(viewer, state.activeStructures);
    state.activeStructures = [];
    const activeStructures = await loadMolstarEntryWithStructureRefs(viewer, activeEntry, { representationPreset: 'empty' });
    if (activeStructures.length) {
      await applySdfCollectionMolstarStyle(viewer, style, activeStructures, 1, 'colored');
    }
    state.activeStructures = activeStructures;
    state.activeIndex = activeIndex;
    updateStructureOverlayToggleButton(document.querySelector('[data-buret-action="structure-overlay-toggle"]'), prepared);
    await applyMolstarWaterLineRepresentation(viewer);
    if (options.focus !== false) scheduleMolstarStructureFocus(viewer, { reason: 'docking-poses', durationMs: 180 });
  }

  async function applyXyzFrameOverlayVisibility(viewer, prepared, activePose = 0, options = {}) {
    if (!viewer || prepared?.xyzFrameOverlayAvailable !== true) return;
    const plugin = viewer.plugin;
    if (!plugin?.builders?.data?.rawData || !plugin?.builders?.structure?.parseTrajectory || !plugin?.builders?.structure?.hierarchy?.applyPreset) {
      throw new Error('Mol* structure builders are not available in this runtime.');
    }
    const raw = rawStructureData(activeConfig);
    const rawSignature = xyzFrameOverlayRawSignature(raw);
    let frames = activeXyzFrameOverlayState?.viewer === viewer && activeXyzFrameOverlayState.rawSignature === rawSignature
      ? activeXyzFrameOverlayState.frames
      : null;
    if (!Array.isArray(frames)) frames = splitXyzFrames(raw);
    if (frames.length <= 1) {
      resetXyzFrameOverlayState(viewer);
      await reloadActiveMolstarStructure();
      return;
    }
    const activeIndex = Math.max(0, Math.min(frames.length - 1, Math.trunc(Number(activePose) || 0)));
    const label = activeConfig?.label || prepared?.label || 'XYZ frames';
    const style = configuredMolstarStyle(activeConfig);
    const foregroundStyle = xyzFrameForegroundStyle(style);
    if (activeSdfPoseMode !== 'all') {
      resetXyzFrameOverlayState(viewer);
      resetSdfCollectionVisibilityState(viewer);
      resetDockingPoseCollectionState(viewer);
      if (typeof plugin.clear === 'function') await plugin.clear();
      const activeEntry = xyzFrameEntry(frames[activeIndex], `${label} (${prepared.controlLabel || 'Frame'} ${activeIndex + 1})`);
      if (!activeEntry) throw new Error('XYZ frame data is unavailable.');
      const activeStructures = await loadMolstarEntryWithStructureRefs(viewer, activeEntry, { representationPreset: 'empty' });
      if (!activeStructures.length) throw new Error('Mol* did not expose the active XYZ frame structure.');
      await applyXyzFrameMolstarStyle(viewer, foregroundStyle, activeStructures, 1, 'colored');
      await applyMolstarWaterLineRepresentation(viewer);
      if (options.installControls !== false) installDockingPoseControls(viewer, trajectoryControlsForPrepared(prepared));
      updateStructureOverlayToggleButton(document.querySelector('[data-buret-action="structure-overlay-toggle"]'), prepared);
      if (options.focus !== false) scheduleMolstarStructureFocus(viewer, { reason: 'xyz-frame', durationMs: 180 });
      return;
    }
    const contextStyle = options.contextStyle ?? readSdfCollectionContextStyle(activeConfig);
    const resolvedContextStyle = xyzFrameBackgroundStyle(contextStyle, foregroundStyle);
    const contextOpacity = options.contextOpacity ?? readSdfCollectionContextOpacity(activeConfig);
    const contextColor = options.contextColor ?? readXyzFrameContextColor(activeConfig);
    const backgroundIndexes = sampledXyzFrameBackgroundIndexes(frames.length, activeIndex);
    const stateKey = xyzFrameOverlayStateKey(rawSignature, frames, prepared, foregroundStyle, resolvedContextStyle, contextOpacity, contextColor, backgroundIndexes);
    let state = activeXyzFrameOverlayState;
    if (!state || state.key !== stateKey || !xyzFrameOverlayStateStillLoaded(viewer, state)) {
      resetSdfCollectionVisibilityState(viewer);
      resetDockingPoseCollectionState(viewer);
      if (typeof plugin.clear === 'function') await plugin.clear();
      const contextStructures = [];
      for (const index of backgroundIndexes) {
        const entry = xyzFrameEntry(frames[index], `${label} (background frame ${index + 1})`);
        if (!entry) continue;
        contextStructures.push(...await loadMolstarEntryWithStructureRefs(viewer, entry, { representationPreset: 'empty' }));
      }
      if (contextStructures.length) {
        const backgroundOpacity = xyzFrameBackgroundLayerOpacity(contextOpacity, contextStructures.length);
        await applyXyzFrameMolstarStyle(viewer, resolvedContextStyle, contextStructures, backgroundOpacity, contextColor, XYZ_FRAME_BACKGROUND_MIN_ALPHA);
      }
      state = {
        viewer,
        key: stateKey,
        rawSignature,
        frames,
        backgroundStructures: contextStructures,
        activeStructures: [],
        activeIndex: -1
      };
      activeXyzFrameOverlayState = state;
    }

    if (state.activeIndex === activeIndex && xyzFrameOverlayStateStillLoaded(viewer, state)) {
      if (options.installControls !== false) installDockingPoseControls(viewer, trajectoryControlsForPrepared(prepared));
      updateStructureOverlayToggleButton(document.querySelector('[data-buret-action="structure-overlay-toggle"]'), prepared);
      return;
    }
    await removeMolstarStructures(viewer, state.activeStructures);
    state.activeStructures = [];
    const activeEntry = xyzFrameEntry(frames[activeIndex], `${label} (${prepared.controlLabel || 'Frame'} ${activeIndex + 1})`);
    if (!activeEntry) throw new Error('XYZ frame data is unavailable.');
    const structuresBeforeActive = new Set(molstarCurrentStructures(viewer));
    const activeStructures = await loadMolstarEntryWithStructureRefs(viewer, activeEntry, { representationPreset: 'empty' });
    const scopedActiveStructures = activeStructures.length
      ? activeStructures
      : Array.from(molstarCurrentStructures(viewer)).filter(structure => !structuresBeforeActive.has(structure));
    if (!scopedActiveStructures.length) throw new Error('Mol* did not expose the active XYZ frame structure.');
    await applyXyzFrameMolstarStyle(viewer, resolvedContextStyle, scopedActiveStructures, 1, 'colored');
    state.activeStructures = scopedActiveStructures;
    state.activeIndex = activeIndex;
    if (options.installControls !== false) installDockingPoseControls(viewer, trajectoryControlsForPrepared(prepared));
    updateStructureOverlayToggleButton(document.querySelector('[data-buret-action="structure-overlay-toggle"]'), prepared);
  }

  function xyzFrameRepresentationStyle(style) {
    const normalized = normalizeMolstarStyle(style);
    if (normalized === 'line' || normalized === 'ball-and-stick' || normalized === 'spacefill' || normalized === 'molecular-surface') return normalized;
    return 'line';
  }

  function xyzFrameForegroundStyle(style) {
    const normalized = normalizeMolstarStyle(style);
    if (normalized === 'line' || normalized === 'ball-and-stick' || normalized === 'spacefill' || normalized === 'molecular-surface') return normalized;
    return 'ball-and-stick';
  }

  function xyzFrameBackgroundStyle(contextStyle, foregroundStyle) {
    const normalized = normalizeSdfCollectionContextStyle(contextStyle);
    if (normalized === 'match') return xyzFrameRepresentationStyle(foregroundStyle);
    return xyzFrameRepresentationStyle(normalized);
  }

  async function applyXyzFrameMolstarStyle(viewer, style, structures = null, alpha = 1, colorMode = 'gray', minAlpha = 0.04) {
    const normalized = xyzFrameRepresentationStyle(style);
    const targets = Array.isArray(structures) && structures.length ? structures : Array.from(molstarCurrentStructures(viewer));
    await applyMolstarRepresentationsToStructures(viewer, targets, sdfCollectionRepresentationForStyle(normalized, alpha, colorMode, minAlpha));
    await applyMolstarNonIllustrativePostprocessing(viewer);
  }

  async function applyDockingSceneVisibility(viewer, prepared, activePose = 0, options = {}) {
    if (!viewer || prepared?.kind !== 'docking' || !prepared.dockingSceneMode) return;
    const plugin = viewer.plugin;
    resetXyzFrameOverlayState(viewer);
    resetSdfCollectionVisibilityState(viewer);
    resetDockingPoseCollectionState(viewer);
    if (typeof plugin.clear === 'function') await plugin.clear();
    const poses = Array.isArray(prepared.poses) ? prepared.poses : [];
    const activeIndex = Math.max(0, Math.min(poses.length - 1, Math.trunc(Number(activePose) || 0)));
    const activeEntry = poses[activeIndex];
    if (!activeEntry) throw new Error('Mol* structure scene has no active structure.');
    const style = configuredMolstarStyle(activeConfig);

    if (activeSdfPoseMode === 'all') {
      const contextStyle = readSdfCollectionContextStyle(activeConfig);
      const resolvedContextStyle = dockingSceneBackgroundStyle(contextStyle, style);
      const backgroundEntries = poses.filter((_, index) => index !== activeIndex);
      if (resolvedContextStyle === 'default' || resolvedContextStyle === 'illustrative') {
        const sceneStructures = [];
        for (const entry of [...backgroundEntries, activeEntry]) {
          sceneStructures.push(...await loadMolstarEntryWithStructureRefs(viewer, entry, { representationPreset: 'empty' }));
        }
        if (sceneStructures.length) {
          await applySdfCollectionMolstarStyle(viewer, resolvedContextStyle, sceneStructures, 1, 'colored');
        }
      } else {
        const contextStructures = [];
        for (const entry of backgroundEntries) {
          contextStructures.push(...await loadMolstarEntryWithStructureRefs(viewer, entry, { representationPreset: 'empty' }));
        }
        const contextOpacity = readSdfCollectionContextOpacity(activeConfig);
        const contextColor = readSdfCollectionContextColor(activeConfig);
        if (contextStructures.length) {
          await applySdfCollectionMolstarStyle(viewer, resolvedContextStyle, contextStructures, contextOpacity, contextColor);
        }
        const activeStyle = normalizeMolstarStyle(style);
        if (activeStyle === 'default' || activeStyle === 'illustrative') {
          await loadMolstarEntry(viewer, activeEntry);
          await applyMolstarIllustrativePostprocessing(viewer);
        } else {
          const activeStructures = await loadMolstarEntryWithStructureRefs(viewer, activeEntry, { representationPreset: 'empty' });
          if (activeStructures.length) {
            await applySdfCollectionMolstarStyle(viewer, activeStyle, activeStructures, 1, 'colored');
          }
        }
      }
      await applyMolstarWaterLineRepresentation(viewer);
      updateStructureOverlayToggleButton(document.querySelector('[data-buret-action="structure-overlay-toggle"]'), prepared);
      if (options.focus !== false) scheduleMolstarStructureFocus(viewer, { reason: 'docking-scene', durationMs: 180 });
      return;
    }

    await loadMolstarEntry(viewer, activeEntry);
    await applyMolstarStyle(viewer, style);
    await applyMolstarWaterLineRepresentation(viewer);
    updateStructureOverlayToggleButton(document.querySelector('[data-buret-action="structure-overlay-toggle"]'), prepared);
    if (options.focus !== false) scheduleMolstarStructureFocus(viewer, { reason: 'docking-scene', durationMs: 180 });
  }

  function dockingSceneBackgroundStyle(contextStyle, foregroundStyle) {
    return contextStyle !== 'match' ? normalizeMolstarStyle(contextStyle) : normalizeMolstarStyle(foregroundStyle);
  }

  async function loadSdfCollectionPdbLayer(viewer, data, label) {
    const plugin = viewer?.plugin;
    const raw = await plugin.builders.data.rawData({ data, label });
    const trajectory = await plugin.builders.structure.parseTrajectory(raw, 'pdb');
    const preset = await plugin.builders.structure.hierarchy.applyPreset(trajectory, 'default', { representationPreset: 'empty' });
    const structure = preset?.structureProperties || preset?.structure || null;
    return structure ? [structure] : [];
  }

  async function applySdfCollectionMolstarStyle(viewer, style, structures = null, alpha = 1, colorMode = 'gray') {
    const normalized = normalizeMolstarStyle(style);
    const targets = Array.isArray(structures) && structures.length ? structures : Array.from(molstarCurrentStructures(viewer));
    if (normalized === 'default' || normalized === 'illustrative' || normalized === 'cartoon' || normalized === 'polymer-ligand') {
      await applyMolstarPolymerLigandRepresentationToStructures(
        viewer,
        targets,
        sdfCollectionCartoonRepresentation(alpha),
        sdfCollectionLigandRepresentationForStyle(normalized, alpha, colorMode)
      );
    } else {
      await applyMolstarRepresentationsToStructures(viewer, targets, sdfCollectionRepresentationForStyle(normalized, alpha, colorMode));
    }
    if (normalized === 'illustrative') await applyMolstarIllustrativePostprocessing(viewer);
    else await applyMolstarNonIllustrativePostprocessing(viewer);
  }

  function sdfCollectionAlphaHelpers(alpha = 1, colorMode = 'gray', minAlpha = 0.04) {
    const ghost = Number.isFinite(Number(alpha)) && Number(alpha) < 1;
    const withAlpha = (params = {}) => {
      const value = Number(alpha);
      return ghost ? { ...params, alpha: Math.max(minAlpha, Math.min(value, 1)), transparentBackfaces: 'on' } : params;
    };
    const color = normalizeSdfCollectionContextColor(colorMode) === 'colored' ? 'element-symbol' : 'uniform';
    const colorParams = color === 'uniform' ? { value: 0x6f7886 } : undefined;
    const themed = (representation) => colorParams ? { ...representation, color, colorParams } : { ...representation, color };
    return { ghost, withAlpha, themed };
  }

  function sdfCollectionRepresentationForStyle(style, alpha = 1, colorMode = 'gray', minAlpha = 0.04) {
    const normalized = normalizeMolstarStyle(style);
    const { ghost, withAlpha, themed } = sdfCollectionAlphaHelpers(alpha, colorMode, minAlpha);
    if (normalized === 'line') {
      return themed({ type: 'line', typeParams: withAlpha({ sizeFactor: ghost ? 0.035 : 0.08 }) });
    }
    if (normalized === 'spacefill') {
      return themed({ type: 'spacefill', typeParams: withAlpha({ sizeFactor: ghost ? 0.28 : 0.45 }) });
    }
    if (normalized === 'molecular-surface') {
      return themed({ type: 'molecular-surface', typeParams: withAlpha({ alpha: ghost ? 0.16 : 0.72 }) });
    }
    return themed({ type: 'ball-and-stick', typeParams: withAlpha({ sizeFactor: ghost ? 0.095 : 0.16 }) });
  }

  function sdfCollectionCartoonRepresentation(alpha = 1) {
    const { withAlpha } = sdfCollectionAlphaHelpers(alpha);
    return {
      type: 'cartoon',
      typeParams: withAlpha({}),
      color: 'chain-id'
    };
  }

  function sdfCollectionLigandRepresentationForStyle(style, alpha = 1, colorMode = 'gray') {
    const { ghost, withAlpha, themed } = sdfCollectionAlphaHelpers(alpha, colorMode);
    return themed({
      type: 'ball-and-stick',
      typeParams: withAlpha({ sizeFactor: ghost ? 0.095 : 0.16 })
    });
  }

  async function applyMolstarRepresentationsToStructures(viewer, structures, representation) {
    const plugin = viewer?.plugin;
    if (!plugin) return;
    await clearMolstarMainRepresentationsForStructures(viewer, structures);
    let created = 0;
    for (const structure of structures || []) {
      const component = await tryCreateMolstarComponent(plugin, structure, 'all');
      if (await addMolstarRepresentation(plugin, component, representation)) created += 1;
    }
    if (created === 0) throw new Error('Mol* could not create a component for this style.');
  }

  async function applyMolstarPolymerLigandRepresentationToStructures(viewer, structures, polymerRepresentation, ligandRepresentation) {
    const plugin = viewer?.plugin;
    if (!plugin) return;
    await clearMolstarMainRepresentationsForStructures(viewer, structures);
    let created = 0;
    for (const structure of structures || []) {
      const polymer = await tryCreateMolstarComponent(plugin, structure, 'polymer');
      if (await addMolstarRepresentation(plugin, polymer, polymerRepresentation)) created += 1;
      for (const kind of ['ligand', 'ion']) {
        const component = await tryCreateMolstarComponent(plugin, structure, kind);
        if (await addMolstarRepresentation(plugin, component, ligandRepresentation)) created += 1;
      }
    }
    if (created === 0) await applyMolstarRepresentationsToStructures(viewer, structures, ligandRepresentation);
  }

  async function clearMolstarMainRepresentationsForStructures(viewer, structures) {
    const plugin = viewer?.plugin;
    const components = [];
    for (const structure of structures || []) {
      for (const component of structure.components || []) {
        if (isMolstarWaterComponent(component) || isMolstarBoxComponent(component)) continue;
        components.push(component);
      }
    }
    if (components.length) {
      await plugin.managers.structure.component.removeRepresentations(components);
    }
  }

  async function clearMolstarMainRepresentations(viewer) {
    const plugin = viewer?.plugin;
    const components = [];
    for (const structure of molstarCurrentStructures(viewer)) {
      for (const component of structure.components || []) {
        if (isMolstarWaterComponent(component) || isMolstarBoxComponent(component)) continue;
        components.push(component);
      }
    }
    if (components.length) {
      await plugin.managers.structure.component.removeRepresentations(components);
    }
  }

  async function addMolstarRepresentation(plugin, component, representation) {
    if (!component) return false;
    try {
      await plugin.builders.structure.representation.addRepresentation(component.cell || component, representation);
      return true;
    } catch (error) {
      debug('Mol* representation failed: ' + (error && error.message || String(error)));
      return false;
    }
  }

  async function applyMolstarUniformRepresentation(viewer, representation) {
    const plugin = viewer?.plugin;
    if (!plugin) return;
    await clearMolstarMainRepresentations(viewer);
    let created = 0;
    for (const structure of molstarCurrentStructures(viewer)) {
      const component = await tryCreateMolstarComponent(plugin, structure, 'all');
      if (await addMolstarRepresentation(plugin, component, representation)) created += 1;
    }
    if (created === 0) throw new Error('Mol* could not create a component for this style.');
  }

  async function applyMolstarPolymerLigandRepresentation(viewer, polymerRepresentation, ligandRepresentation) {
    await applyMolstarPolymerLigandRepresentationToStructures(
      viewer,
      Array.from(molstarCurrentStructures(viewer)),
      polymerRepresentation,
      ligandRepresentation
    );
  }

  function resetMolstarPostprocessing(viewer) {
    const canvas = viewer?.plugin?.canvas3d;
    if (!canvas) return;
    canvas.setProps({
      postprocessing: {
        outline: { name: 'off', params: {} },
        occlusion: { name: 'off', params: {} },
        shadow: { name: 'off', params: {} }
      }
    });
  }

  async function applyMolstarNonIllustrativePostprocessing(viewer) {
    const plugin = viewer?.plugin;
    if (!plugin) return;
    await plugin.managers.structure.component.setOptions({
      ...plugin.managers.structure.component.state.options,
      ignoreLight: false
    });
    resetMolstarPostprocessing(viewer);
  }

  async function applyMolstarIllustrativePostprocessing(viewer) {
    const plugin = viewer?.plugin;
    if (!plugin) return;
    await plugin.managers.structure.component.setOptions({
      ...plugin.managers.structure.component.state.options,
      ignoreLight: true
    });
    if (!plugin.canvas3d) return;
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
                includeTransparent: false
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

  async function applyMolstarStyle(viewer, style) {
    const plugin = viewer?.plugin;
    if (!plugin) return;
    const normalized = normalizeMolstarStyle(style);

    if (normalized !== 'illustrative') {
      await applyMolstarNonIllustrativePostprocessing(viewer);
    }

    if (normalized === 'line') {
      await applyMolstarUniformRepresentation(viewer, {
        type: 'line',
        typeParams: { sizeFactor: 0.08 },
        color: 'element-symbol'
      });
      return;
    }
    if (normalized === 'ball-and-stick') {
      await applyMolstarUniformRepresentation(viewer, {
        type: 'ball-and-stick',
        typeParams: { sizeFactor: 0.16 },
        color: 'element-symbol'
      });
      return;
    }
    if (normalized === 'spacefill') {
      await applyMolstarUniformRepresentation(viewer, {
        type: 'spacefill',
        typeParams: { sizeFactor: 0.45 },
        color: 'element-symbol'
      });
      return;
    }
    if (normalized === 'molecular-surface') {
      await applyMolstarUniformRepresentation(viewer, {
        type: 'molecular-surface',
        typeParams: { alpha: 0.72 },
        color: 'element-symbol'
      });
      return;
    }
    if (normalized === 'illustrative') {
      await applyMolstarIllustrativePostprocessing(viewer);
      return;
    }
    if (normalized === 'cartoon' || normalized === 'polymer-ligand') {
      await applyMolstarPolymerLigandRepresentation(
        viewer,
        { type: 'cartoon', color: 'chain-id' },
        {
          type: normalized === 'cartoon' ? 'line' : 'ball-and-stick',
          typeParams: normalized === 'cartoon' ? { sizeFactor: 0.08 } : { sizeFactor: 0.16 },
          color: 'element-symbol'
        }
      );
      return;
    }
  }

  function isMolstarWaterComponent(component) {
    if (!component) return false;
    const format = normalizeFormat(activeConfig?.molstarFormat || activeConfig?.format || '');
    const isGroDocument = format === 'gro';
    const key = String(component.key || '');
    const keyParts = key.split(',').map(part => part.trim().toLowerCase());
    if (keyParts.includes('water') || keyParts.includes('solvent')) return true;
    if (keyParts.some(part => part.includes('water') || part.includes('solvent'))) return true;
    const label = String(component.cell?.obj?.label || '');
    const normalizedLabel = label.trim().toLowerCase();
    if (isGroDocument && normalizedLabel.includes('non-standard')) return true;
    return ['water', 'solvent', 'hoh', 'wat', 'sol', 'tip3', 'tip3p', 'spc', 'tip4p'].some(name => (
      normalizedLabel === name || normalizedLabel.includes(name)
    ));
  }

  async function tryCreateMolstarWaterComponent(plugin, structure) {
    for (const target of [structure?.cell, structure]) {
      if (!target) continue;
      try {
        const component = await plugin.builders.structure.tryCreateComponentStatic(target, 'water');
        if (component) return component;
      } catch (error) {
        debug('Mol* static water component creation failed: ' + (error && error.message || String(error)));
      }
    }
    return null;
  }

  function shouldUseMolstarWaterLines(config) {
    const value = String(config?.waterRepresentation || 'line').trim().toLowerCase();
    return value === 'line' || value === 'lines' || value === 'solvent-lines';
  }

  function molstarWaterLineRepresentation() {
    return {
      type: 'line',
      typeParams: {
        alpha: 0.32,
        sizeFactor: 0.035,
        visuals: ['intra-bond']
      },
      color: 'uniform',
      colorParams: { value: 0x4db6ff },
      size: 'uniform',
      sizeParams: { value: 0.03 }
    };
  }

  async function applyMolstarWaterLineRepresentation(viewer) {
    if (!shouldUseMolstarWaterLines(activeConfig)) return;
    const plugin = viewer?.plugin;
    const structures = plugin?.managers?.structure?.hierarchy?.current?.structures || [];
    const waterComponents = [];
    const createdWaterComponents = [];
    for (const structure of structures) {
      let structureWaterCount = 0;
      for (const component of structure.components || []) {
        if (!isMolstarWaterComponent(component)) continue;
        waterComponents.push(component);
        structureWaterCount += 1;
      }
      if (structureWaterCount === 0) {
        const component = await tryCreateMolstarWaterComponent(plugin, structure);
        if (component) createdWaterComponents.push(component);
      }
    }
    if (!waterComponents.length && !createdWaterComponents.length) return;

    if (waterComponents.length) {
      await plugin.managers.structure.component.removeRepresentations(waterComponents);
    }
    for (const component of waterComponents) {
      await plugin.builders.structure.representation.addRepresentation(component.cell, molstarWaterLineRepresentation(), { tag: 'water' });
    }
    for (const component of createdWaterComponents) {
      await plugin.builders.structure.representation.addRepresentation(component.cell || component, molstarWaterLineRepresentation(), { tag: 'water' });
    }
    return waterComponents.length;
  }

  function activeMolstarViewer() {
    return activeViewer || window.BurreteViewer || window.BuretteViewer || null;
  }

  function molstarComponentsByKind(viewer, kind) {
    const normalizedKind = normalizeSceneComponentKind(kind);
    const structures = viewer?.plugin?.managers?.structure?.hierarchy?.current?.structures || [];
    const out = [];
    for (const structure of structures) {
      for (const component of structure.components || []) {
        if (normalizedKind === 'water' && isMolstarWaterComponent(component)) out.push(component);
        else if (normalizedKind !== 'water' && isMolstarComponentKind(component, normalizedKind)) out.push(component);
      }
    }
    return out;
  }

  function normalizeSceneComponentKind(kind) {
    const text = String(kind || '').trim().toLowerCase();
    if (text === 'protein') return 'polymer';
    if (text === 'ligands') return 'ligand';
    if (text === 'ions') return 'ion';
    if (text === 'polymers') return 'polymer';
    if (text === 'water' || text === 'polymer' || text === 'ligand' || text === 'ion') return text;
    return 'ligand';
  }

  function isMolstarComponentKind(component, kind) {
    const key = String(component?.key || '').toLowerCase();
    const label = String(component?.cell?.obj?.label || component?.label || '').toLowerCase();
    return key.includes(kind) || label.includes(kind);
  }

  async function hideMolstarWaters() {
    const viewer = activeMolstarViewer();
    const plugin = viewer?.plugin;
    if (!plugin?.managers?.structure?.component?.removeRepresentations) {
      return sceneActionFailure('hide_waters', 'NOT_IMPLEMENTED', 'Mol* component representation manager is unavailable.');
    }
    const waterComponents = molstarComponentsByKind(viewer, 'water');
    if (!waterComponents.length) {
      return { ok: true, command: 'hide_waters', result: { componentCount: 0, note: 'No water components were found.' } };
    }
    await plugin.managers.structure.component.removeRepresentations(waterComponents);
    return { ok: true, command: 'hide_waters', result: { componentCount: waterComponents.length } };
  }

  async function showMolstarWaters() {
    const count = await applyMolstarWaterLineRepresentation(activeMolstarViewer());
    return { ok: true, command: 'show_waters', result: { componentCount: count || 0, representation: 'line' } };
  }

  function clearMolstarSelection() {
    const viewer = activeMolstarViewer();
    const plugin = viewer?.plugin;
    let cleared = false;
    try {
      viewer?.structureInteractivity?.({ action: 'select' });
      viewer?.structureInteractivity?.({ action: 'highlight' });
      viewer?.structureInteractivity?.({ action: 'focus' });
      cleared = true;
    } catch (error) {
      debug('Mol* structureInteractivity clear failed: ' + (error && error.message || String(error)));
    }
    try {
      plugin?.managers?.interactivity?.lociSelects?.deselectAll?.();
      plugin?.managers?.structure?.selection?.clear?.();
      plugin?.managers?.structure?.focus?.clear?.();
      cleared = true;
    } catch (error) {
      debug('Mol* manager selection clear failed: ' + (error && error.message || String(error)));
    }
    if (!cleared) {
      return sceneActionFailure('clear_selection', 'NOT_IMPLEMENTED', 'Mol* selection managers are unavailable.');
    }
    molstarLassoSelectionAtoms.clear();
    molstarLassoSelectionAtomKeys.clear();
    molstarLassoSelectionResidueKeys.clear();
    window.__mqlPost?.('selectionChanged', '', {
      selection: { source: 'viewer', cleared: true, atoms: 0, residues: [], atomIdentities: [] }
    });
    return { ok: true, command: 'clear_selection', result: { cleared: true } };
  }

  async function hideMolstarComponents(action = {}) {
    const kind = normalizeSceneComponentKind(action.kind);
    if (kind === 'water') return hideMolstarWaters();
    const viewer = activeMolstarViewer();
    const plugin = viewer?.plugin;
    if (!plugin?.managers?.structure?.component?.removeRepresentations) {
      return sceneActionFailure('hide_components', 'NOT_IMPLEMENTED', 'Mol* component representation manager is unavailable.');
    }
    const components = await ensureMolstarComponentsByKind(viewer, kind);
    if (!components.length) {
      return { ok: true, command: 'hide_components', result: { kind, componentCount: 0, note: `No ${kind} components were found.` } };
    }
    await plugin.managers.structure.component.removeRepresentations(components);
    return { ok: true, command: 'hide_components', result: { kind, componentCount: components.length } };
  }

  async function showMolstarComponents(action = {}) {
    const kind = normalizeSceneComponentKind(action.kind);
    if (kind === 'water') return showMolstarWaters();
    const viewer = activeMolstarViewer();
    const plugin = viewer?.plugin;
    if (!plugin?.builders?.structure?.representation?.addRepresentation) {
      return sceneActionFailure('show_components', 'NOT_IMPLEMENTED', 'Mol* representation builder is unavailable.');
    }
    const components = await ensureMolstarComponentsByKind(viewer, kind);
    if (!components.length) {
      return sceneActionFailure('show_components', 'SELECTION_EMPTY', `No ${kind} components could be created.`);
    }
    const representation = representationForSceneComponentKind(kind);
    let created = 0;
    for (const component of components) {
      try {
        await plugin.builders.structure.representation.addRepresentation(component.cell || component, representation, { tag: `burette-${kind}` });
        created += 1;
      } catch (error) {
        debug(`Mol* ${kind} representation restore failed: ` + (error && error.message || String(error)));
      }
    }
    return { ok: true, command: 'show_components', result: { kind, componentCount: created, representation: representation.type } };
  }

  async function ensureMolstarComponentsByKind(viewer, kind) {
    const plugin = viewer?.plugin;
    const components = molstarComponentsByKind(viewer, kind);
    if (components.length || !plugin?.builders?.structure?.tryCreateComponentStatic) return components;
    for (const structure of molstarCurrentStructures(viewer)) {
      const component = await tryCreateMolstarComponent(plugin, structure, kind);
      if (component) components.push(component);
    }
    return components;
  }

  function representationForSceneComponentKind(kind) {
    if (kind === 'polymer') {
      return {
        type: 'cartoon',
        color: 'chain-id',
        size: 'uniform',
        sizeParams: { value: 0.65 }
      };
    }
    return {
      type: 'ball-and-stick',
      typeParams: { sizeFactor: kind === 'ion' ? 0.32 : 0.24 },
      color: 'element-symbol',
      size: 'uniform',
      sizeParams: { value: kind === 'ion' ? 0.3 : 0.22 }
    };
  }

  async function showMolstarSurface(action = {}) {
    const viewer = activeMolstarViewer();
    const plugin = viewer?.plugin;
    const builder = plugin?.builders?.structure;
    const structures = plugin?.managers?.structure?.hierarchy?.current?.structures || [];
    if (!builder?.tryCreateComponentStatic || !builder?.representation?.addRepresentation) {
      return sceneActionFailure('show_surface', 'NOT_IMPLEMENTED', 'Mol* structure component builder is unavailable.');
    }
    const targetKind = normalizeSurfaceTargetKind(action.target?.kind || action.kind || 'polymer');
    let created = 0;
    for (const structure of structures) {
      const component = await builder.tryCreateComponentStatic(structure, targetKind);
      if (!component) continue;
      await builder.representation.addRepresentation(component, {
        type: action.surfaceType || 'molecular-surface',
        typeParams: {
          alpha: Number.isFinite(Number(action.alpha)) ? Number(action.alpha) : 0.35
        },
        color: action.color || 'chain-id'
      }, { tag: `burette-agent-surface-${targetKind}` });
      created += 1;
    }
    if (!created) {
      return sceneActionFailure('show_surface', 'SELECTION_EMPTY', `No Mol* components could be created for target kind: ${targetKind}.`);
    }
    return { ok: true, command: 'show_surface', result: { targetKind, componentCount: created } };
  }

  async function colorMolstarByChain(action = {}) {
    const viewer = activeMolstarViewer();
    const plugin = viewer?.plugin;
    const components = [];
    for (const structure of plugin?.managers?.structure?.hierarchy?.current?.structures || []) {
      components.push(...(structure.components || []));
    }
    if (!components.length) {
      return sceneActionFailure('color_by_chain', 'NO_STRUCTURE', 'No Mol* components are available.');
    }
    const manager = plugin?.managers?.structure?.component;
    const theme = { color: action.color || 'chain-id' };
    if (typeof manager?.updateRepresentationsTheme === 'function') {
      await manager.updateRepresentationsTheme(components, theme);
      return { ok: true, command: 'color_by_chain', result: { componentCount: components.length, color: theme.color } };
    }
    if (typeof manager?.updateRepresentations === 'function') {
      await manager.updateRepresentations(components, theme);
      return { ok: true, command: 'color_by_chain', result: { componentCount: components.length, color: theme.color, method: 'updateRepresentations' } };
    }
    return sceneActionFailure('color_by_chain', 'NOT_IMPLEMENTED', 'Mol* representation theme update API is unavailable in this runtime.');
  }

  function molstarStructureBoundingBoxTransform() {
    return window.molstar?.lib?.plugin?.StateTransforms?.Representation?.StructureBoundingBox3D || null;
  }

  async function addMolstarStructureBoundingBoxGeometry(plugin, structure, options = {}) {
    const transform = molstarStructureBoundingBoxTransform();
    const target = structure?.cell || structure;
    if (!transform || !target || !plugin?.build) return false;
    await plugin.build().to(target).apply(transform, {
      radius: Number.isFinite(Number(options.radius)) ? Number(options.radius) : 0.035,
      color: Number.isFinite(Number(options.color)) ? Number(options.color) : 0x2f6f66
    }, { tags: ['burrete-box-geometry'] }).commit({ revertOnError: true });
    return true;
  }

  async function applyMolstarStructureBoundingBoxGeometry(viewer, options = {}) {
    const plugin = viewer?.plugin;
    const structures = plugin?.managers?.structure?.hierarchy?.current?.structures || [];
    if (!structures.length) return 0;
    let created = 0;
    for (const structure of structures) {
      try {
        if (await addMolstarStructureBoundingBoxGeometry(plugin, structure, options)) created += 1;
      } catch (error) {
        debug('Mol* structure bounding-box geometry failed: ' + (error && error.message || String(error)));
      }
    }
    return created;
  }

  async function showMolstarBoundingBox(action = {}) {
    const count = await applyMolstarStructureBoundingBoxGeometry(activeMolstarViewer(), action);
    if (!count) {
      return sceneActionFailure('show_bounding_box', 'NO_STRUCTURE', 'No Mol* structures are available for bounding-box geometry.');
    }
    return { ok: true, command: 'show_bounding_box', result: { componentCount: count, representation: 'molstar-geometry' } };
  }

  function normalizeSurfaceTargetKind(kind) {
    const text = String(kind || '').toLowerCase();
    if (text === 'protein') return 'polymer';
    if (text === 'all' || text === 'polymer' || text === 'ligand') return text;
    return 'polymer';
  }

  function sceneActionFailure(command, code, message) {
    return { ok: false, command, error: { code, message } };
  }

  window.BurreteSceneActions = {
    hideComponents: hideMolstarComponents,
    showComponents: showMolstarComponents,
    hideWaters: hideMolstarWaters,
    showWaters: showMolstarWaters,
    showSurface: showMolstarSurface,
    showBoundingBox: showMolstarBoundingBox,
    colorByChain: colorMolstarByChain
  };

  async function loadPreparedStructure(viewer, prepared) {
    activeMolstarPrepared = prepared;
    updateSdfPoseButton(prepared);
    notifyStructureOverlayModeChanged(prepared);
    if (prepared.kind === 'docking') {
      await loadDockingPreparedStructure(viewer, prepared);
      return;
    }
    if (prepared.kind === 'mvs') {
      activeDockingPrepared = null;
      if (typeof viewer.loadMvsData !== 'function') {
        throw new Error('Mol* viewer.loadMvsData is not available in this runtime.');
      }
      await viewer.loadMvsData(prepared.data, prepared.format, { replaceExisting: true });
      installDockingPoseControls(viewer, null);
      return;
    }
    activeDockingPrepared = null;
    if (prepared.format === 'mol' && typeof viewer.loadStructureFromData === 'function') {
      await viewer.loadStructureFromData(prepared.data, prepared.format, { dataLabel: prepared.label });
      await applyMolstarStyle(viewer, prepared.molstarStyleOverride || configuredMolstarStyle(activeConfig));
      installDockingPoseControls(viewer, null);
      return;
    }
    if (prepared.kind === 'sdf-collection') {
      await applySdfCollectionVisibility(viewer, prepared, readTrajectoryControlIndex(activeConfig, prepared, prepared.poseCount));
      installDockingPoseControls(viewer, trajectoryControlsForPrepared(prepared));
      return;
    }
    if (prepared.xyzFrameOverlayAvailable === true && (activeSdfPoseMode === 'all' || prepared.nativeTrajectoryControls !== true)) {
      await applyXyzFrameOverlayVisibility(viewer, prepared, readTrajectoryControlIndex(activeConfig, prepared, prepared.poseCount || prepared.xyzFrameCount));
      return;
    }
    if (prepared.loadPreset === 'all-models') {
      const plugin = viewer.plugin;
      const data = await plugin.builders.data.rawData({ data: prepared.data, label: prepared.label });
      const trajectory = await plugin.builders.structure.parseTrajectory(data, prepared.format);
      await plugin.builders.structure.hierarchy.applyPreset(trajectory, 'all-models', {
        useDefaultIfSingleModel: true
      });
      if (prepared.keepDefaultMolstarStyle !== true) await applyMolstarStyle(viewer, prepared.molstarStyleOverride || configuredMolstarStyle(activeConfig));
      await applyMolstarWaterLineRepresentation(viewer);
      installDockingPoseControls(viewer, trajectoryControlsForPrepared(prepared));
      return;
    }
    const plugin = viewer.plugin;
    if (prepared.keepDefaultMolstarStyle === true && typeof viewer.loadStructureFromData === 'function') {
      await viewer.loadStructureFromData(prepared.data, prepared.format, { dataLabel: prepared.label });
      installDockingPoseControls(viewer, trajectoryControlsForPrepared(prepared));
      return;
    }
    const data = await plugin.builders.data.rawData({ data: prepared.data, label: prepared.label });
    const trajectory = await plugin.builders.structure.parseTrajectory(data, prepared.format);
    await plugin.builders.structure.hierarchy.applyPreset(trajectory, 'default');
    if (prepared.keepDefaultMolstarStyle !== true) await applyMolstarStyle(viewer, prepared.molstarStyleOverride || configuredMolstarStyle(activeConfig));
    await applyMolstarWaterLineRepresentation(viewer);
    installDockingPoseControls(viewer, trajectoryControlsForPrepared(prepared));
  }

  async function loadMolstarEntry(viewer, entry, presetOptions = undefined) {
    const plugin = viewer.plugin;
    const normalized = normalizeFormat(entry.format);
    const payload = normalized === 'cifCore'
      ? { data: coreCifToPdb(entry.data), format: 'pdb' }
      : { data: entry.data, format: normalized };
    const data = await plugin.builders.data.rawData({ data: payload.data, label: entry.label });
    const trajectory = await plugin.builders.structure.parseTrajectory(data, payload.format);
    await plugin.builders.structure.hierarchy.applyPreset(trajectory, entry.loadPreset || 'default', presetOptions);
  }

  async function loadMolstarEntryWithStructureRefs(viewer, entry, presetOptions = undefined) {
    const before = new Set(molstarCurrentStructures(viewer));
    await loadMolstarEntry(viewer, entry, presetOptions);
    return Array.from(molstarCurrentStructures(viewer)).filter(structure => !before.has(structure));
  }

  async function loadMolstarEntryAsLines(viewer, entry) {
    const plugin = viewer.plugin;
    const normalized = normalizeFormat(entry.format);
    const payload = normalized === 'cifCore'
      ? { data: coreCifToPdb(entry.data), format: 'pdb' }
      : { data: entry.data, format: normalized };
    const data = await plugin.builders.data.rawData({ data: payload.data, label: entry.label });
    const trajectory = await plugin.builders.structure.parseTrajectory(data, payload.format);
    const model = await plugin.builders.structure.createModel(trajectory);
    const structure = await plugin.builders.structure.createStructure(model, { name: 'model', params: {} });
    let created = 0;
    for (const kind of ['water', 'ion', 'ligand']) {
      const component = await plugin.builders.structure.tryCreateComponentStatic(structure, kind);
      if (!component) continue;
      await plugin.builders.structure.representation.addRepresentation(component, molstarWaterLineRepresentation(), { tag: 'water' });
      created += 1;
    }
    if (created > 0) return;
    const component = await plugin.builders.structure.tryCreateComponentStatic(structure, 'all');
    if (!component) throw new Error('Mol* could not create staged solvent component.');
    await plugin.builders.structure.representation.addRepresentation(component, molstarWaterLineRepresentation(), { tag: 'water' });
  }

  function isDockingTrajectoryPairEntry(entry, pair) {
    return !!pair && (entry === pair.modelEntry || entry === pair.coordinateEntry);
  }

  async function loadDockingTrajectoryPair(viewer, pair) {
    if (typeof viewer.loadTrajectory !== 'function') {
      throw new Error('Mol* trajectory pairing is unavailable in this viewer runtime.');
    }
    await viewer.loadTrajectory({
      model: {
        kind: pair.modelKind,
        data: pair.modelEntry.data,
        format: normalizeFormat(pair.modelEntry.format)
      },
      modelLabel: pair.modelEntry.label,
      coordinates: {
        kind: 'coordinates-data',
        data: pair.coordinateEntry.data,
        format: normalizeFormat(pair.coordinateEntry.format)
      },
      coordinatesLabel: pair.coordinateEntry.label,
      preset: 'default'
    });
  }

  async function applyDockingTrajectoryPairFrameCount(prepared) {
    if (!prepared?.trajectoryPair) return;
    await afterNativeTrajectoryPaint();
    const position = readNativeTrajectoryPosition(0);
    const frameCount = Number(position?.total || nativeTrajectoryModelTransform(0)?.frameCount || 0);
    if (!Number.isFinite(frameCount) || frameCount <= 1) return;
    prepared.poseCount = frameCount;
    prepared.activePose = readDockingPoseIndex(activeConfig, frameCount);
    prepared.nativeTrajectoryControls = true;
    prepared.controlLabel = 'Frame';
    prepared.ligandLabel = prepared.trajectoryPair.coordinateEntry.label || prepared.ligandLabel || 'Mol* trajectory';
  }

  async function loadMolstarEntryAsUnitCell(viewer, entry) {
    const plugin = viewer.plugin;
    const params = {
      cellColor: 0x2f6f66,
      cellScale: 1,
      ref: 'model',
      attachment: 'corner'
    };
    let created = 0;
    for (const structure of molstarCurrentStructures(viewer)) {
      const modelCell = structure?.model?.cell || structure?.model;
      if (!modelCell) continue;
      try {
        const unitcell = await plugin.builders.structure.tryCreateUnitcell(modelCell, params, { isHidden: false });
        if (unitcell) created += 1;
      } catch (error) {
        debug('Mol* unit cell creation from active model failed: ' + (error && error.message || String(error)));
      }
    }
    if (created > 0) return;

    const boundingBoxes = await applyMolstarStructureBoundingBoxGeometry(viewer);
    if (boundingBoxes > 0) return;

    const normalized = normalizeFormat(entry.format);
    const payload = normalized === 'cifCore'
      ? { data: coreCifToPdb(entry.data), format: 'pdb' }
      : { data: entry.data, format: normalized };
    const data = await plugin.builders.data.rawData({ data: payload.data, label: entry.label });
    const trajectory = await plugin.builders.structure.parseTrajectory(data, payload.format);
    const model = await plugin.builders.structure.createModel(trajectory);
    const unitcell = await plugin.builders.structure.tryCreateUnitcell(model, params, { isHidden: false });
    if (unitcell) return;
    const fallbackBoxes = await applyMolstarStructureBoundingBoxGeometry(viewer);
    if (fallbackBoxes > 0) return;
    throw new Error('Mol* could not create unit-cell or bounding-box geometry for this box.');
  }

  async function loadStagedMolstarEntry(viewer, entry, cb) {
    const data = await loadStagedEntryData(entry, cb);
    const prepared = {
      ...entry,
      data,
      format: normalizeFormat(entry.format || 'pdb'),
      label: entry.label || 'staged structure'
    };
    if (entry.representation === 'solvent-lines') {
      try {
        await loadMolstarEntryAsLines(viewer, prepared);
        return;
      } catch (error) {
        debug('staged solvent line representation failed, falling back to default preset: ' + (error && error.message || String(error)));
      }
    }
    if (entry.representation === 'unitcell' || entry.representation === 'box-lines') {
      try {
        await loadMolstarEntryAsUnitCell(viewer, prepared);
        return;
      } catch (error) {
        debug('staged unit cell representation failed, falling back to default preset: ' + (error && error.message || String(error)));
      }
    }
    await loadMolstarEntry(viewer, prepared);
  }

  async function loadStagedMolstarEntries(viewer, config, cb) {
    const entries = Array.isArray(config?.stagedEntries) ? config.stagedEntries.filter(entry => !isStructureSceneEntry(entry)) : [];
    if (!entries.length) return;
    setStatus(`[web] Loading ${entries[0]?.label || 'staged structure'}…`);
    await waitForAnimationFrame();
    for (const entry of entries) {
      const label = entry?.label || 'staged structure';
      setStatus(`[web] Loading ${label}…`);
      await loadStagedMolstarEntry(viewer, entry, cb);
      applyLayoutState(viewer);
      scheduleLayoutStateReapply(viewer);
      try { viewer.handleResize(); } catch (_) {}
      setStatus(`[web] Loaded ${label}`);
    }
    setTimeout(hideStatus, isQuickLookHost() ? 0 : 700);
  }

  async function applyMolstarContextFocus(config) {
    const focus = config?.molstarContextFocus;
    if (!focus || typeof focus !== 'object') return;
    const selector = focus.selector && typeof focus.selector === 'object' ? focus.selector : { kind: 'ligand' };
    const radiusA = Number(focus.radiusA || focus.extraRadius || 5);
    try {
      const result = await window.BurreteAgent?.run?.({
        command: 'focusLigand',
        args: {
          selector,
          allowAmbiguous: focus.allowAmbiguous === true,
          showNeighborhood: focus.showNeighborhood !== false,
          radiusA: Number.isFinite(radiusA) && radiusA > 0 ? radiusA : 5,
          extraRadius: Number.isFinite(radiusA) && radiusA > 0 ? radiusA : 5,
          durationMs: Number(focus.durationMs) || 250
        }
      });
      if (result?.ok === false) {
        debug('Mol* context focus failed: ' + (result.error?.message || 'unknown error'));
      }
    } catch (error) {
      debug('Mol* context focus failed: ' + (error?.message || String(error)));
    }
  }

  async function loadDockingPreparedStructure(viewer, prepared) {
    const plugin = viewer.plugin;
    activeDockingPrepared = prepared;
    if (prepared.dockingSceneMode) {
      await applyDockingSceneVisibility(viewer, prepared, prepared.activePose);
      installDockingPoseControls(viewer, prepared);
      return;
    }
    if (prepared.sdfPoseOverlayAvailable === true) {
      await applyDockingPoseCollectionVisibility(viewer, prepared, prepared.activePose);
      installDockingPoseControls(viewer, prepared);
      return;
    }
    if (typeof plugin.clear === 'function') {
      resetXyzFrameOverlayState(viewer);
      resetSdfCollectionVisibilityState(viewer);
      resetDockingPoseCollectionState(viewer);
      await plugin.clear();
    }
    if (prepared.trajectoryPair) {
      await loadDockingTrajectoryPair(viewer, prepared.trajectoryPair);
      await applyDockingTrajectoryPairFrameCount(prepared);
    }
    for (const entry of prepared.entries) {
      if (isDockingTrajectoryPairEntry(entry, prepared.trajectoryPair)) continue;
      await loadMolstarEntry(viewer, entry);
    }
    await applyMolstarStyle(viewer, configuredMolstarStyle(activeConfig));
    await applyMolstarWaterLineRepresentation(viewer);
    installDockingPoseControls(viewer, prepared);
  }

  let dockingPoseKeydownDisposer = null;
  let dockingPoseControlsDisposer = null;
  let activeSdfCollectionPoseSetter = null;
  let activeStructurePoseSetter = null;

  function isDockingPoseKeyboardTarget(target) {
    const element = target instanceof Element ? target : null;
    if (!element) return false;
    const tag = element.tagName.toLowerCase();
    return tag === 'input' || tag === 'select' || tag === 'textarea' || element.isContentEditable;
  }

  function isDockingPoseInteractiveTarget(target) {
    return target instanceof Element && !!target.closest('button, input, select, textarea, [contenteditable="true"]');
  }

  function installDockingPoseInteractionIsolation(root) {
    const quickLookNavigationKeys = new Set(['ArrowLeft', 'ArrowRight']);
    const isolatePointer = (event) => {
      if (!isDockingPoseInteractiveTarget(event.target)) return;
      event.stopPropagation();
    };
    const isolateWheel = (event) => {
      if (!root.contains(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const isolateKeys = (event) => {
      if (!isDockingPoseInteractiveTarget(event.target)) return;
      if (event.target instanceof HTMLInputElement && event.target.classList.contains('buret-docking-pose-speed') && quickLookNavigationKeys.has(event.key)) {
        event.preventDefault();
      }
      event.stopPropagation();
    };
    const pointerEvents = ['pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchmove', 'touchend'];
    pointerEvents.forEach(eventName => root.addEventListener(eventName, isolatePointer));
    root.addEventListener('wheel', isolateWheel, { passive: false });
    root.addEventListener('keydown', isolateKeys);
    root.addEventListener('keyup', isolateKeys);
    return () => {
      pointerEvents.forEach(eventName => root.removeEventListener(eventName, isolatePointer));
      root.removeEventListener('wheel', isolateWheel);
      root.removeEventListener('keydown', isolateKeys);
      root.removeEventListener('keyup', isolateKeys);
    };
  }

  function installDockingPoseHoverSuppression() {
    const suppressHover = (event) => {
      if (Number(event.buttons || 0) !== 0) return;
      if (!isMolstarContextMenuTarget(event.target)) return;
      event.stopPropagation();
      try { activeViewer?.plugin?.managers?.interactivity?.lociHighlights?.clearHighlights?.(); } catch (_) {}
    };
    document.addEventListener('pointermove', suppressHover, true);
    document.addEventListener('mousemove', suppressHover, true);
    return () => {
      document.removeEventListener('pointermove', suppressHover, true);
      document.removeEventListener('mousemove', suppressHover, true);
    };
  }

  function dockingPoseControlsBounds(mainRect = visibleRect('.msp-plugin .msp-layout-main')) {
    const margin = TOOLBAR_MARGIN;
    const left = mainRect ? Math.max(margin, Math.ceil(mainRect.left + margin)) : margin;
    const right = mainRect ? Math.min(window.innerWidth - margin, Math.floor(mainRect.right - margin)) : window.innerWidth - margin;
    return {
      left,
      right: Math.max(left, right),
      top: margin,
      bottom: window.innerHeight - margin
    };
  }

  function moveDockingPoseControls(root, left, top, mainRect = visibleRect('.msp-plugin .msp-layout-main')) {
    const bounds = dockingPoseControlsBounds(mainRect);
    root.style.maxWidth = Math.max(180, Math.floor(bounds.right - bounds.left)) + 'px';
    const width = root.offsetWidth || root.getBoundingClientRect().width || 180;
    const height = root.offsetHeight || root.getBoundingClientRect().height || 40;
    const maxLeft = Math.max(bounds.left, bounds.right - width);
    const maxTop = Math.max(bounds.top, bounds.bottom - height);
    const clampedLeft = Math.round(Math.min(Math.max(bounds.left, left), maxLeft));
    const clampedTop = Math.round(Math.min(Math.max(bounds.top, top), maxTop));
    root.style.left = clampedLeft + 'px';
    root.style.top = clampedTop + 'px';
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
          window.requestAnimationFrame(() => repositionDockingPoseControls(root));
          restored = true;
        }
      } else if (raw) {
        window.localStorage && window.localStorage.removeItem('buret.dockingPoseControls.position');
      }
    } catch (_) {}
    if (restored) return;
    root.dataset.defaultPosition = '1';
    applyDefaultDockingPoseControlsPosition(root);
  }

  function applyDefaultDockingPoseControlsPosition(root, mainRect = visibleRect('.msp-plugin .msp-layout-main')) {
    root.dataset.defaultPosition = '1';
    const bounds = dockingPoseControlsBounds(mainRect);
    moveDockingPoseControls(root, bounds.left, 14, mainRect);
  }

  function repositionDockingPoseControls(root, mainRect = visibleRect('.msp-plugin .msp-layout-main')) {
    if (root.dataset.defaultPosition === '1') {
      applyDefaultDockingPoseControlsPosition(root, mainRect);
      return;
    }
    const rect = root.getBoundingClientRect();
    moveDockingPoseControls(root, rect.left, rect.top, mainRect);
    saveDockingPoseControlsPosition(root);
  }

  function repositionDockingPoseControlsForLayout(mainRect = visibleRect('.msp-plugin .msp-layout-main')) {
    const root = document.querySelector('.buret-docking-poses');
    if (root) repositionDockingPoseControls(root, mainRect);
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

  function nativeAnimationSelectButton() {
    const roots = Array.from(document.querySelectorAll('.msp-viewport-top-left-controls, .msp-animation-viewport-controls'));
    for (const root of roots) {
      const button = Array.from(root.querySelectorAll('button')).find(candidate => (
        /\bselect animation\b/i.test(`${candidate.getAttribute('title') || ''} ${candidate.getAttribute('aria-label') || ''}`)
      ));
      if (button) return button;
    }
    return null;
  }

  function readNativeTrajectoryPositionFromDom(expectedCount) {
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

  function nativeTrajectoryFrameCount(plugin, cell) {
    const parentRef = cell?.transform?.parent;
    const parent = parentRef ? plugin?.state?.data?.cells?.get?.(parentRef) : null;
    const frameCount = Number(parent?.obj?.data?.frameCount || 0);
    return Number.isFinite(frameCount) && frameCount > 0 ? frameCount : 0;
  }

  function nativeTrajectoryModelTransform(expectedCount = 0) {
    const plugin = activeViewer?.plugin;
    const data = plugin?.state?.data;
    if (!plugin || !data) return null;
    const selection = plugin?.managers?.structure?.hierarchy?.selection;
    const selectedRefs = new Set((selection?.structures || [])
      .map(structure => structure?.model?.cell?.transform?.ref)
      .filter(Boolean));
    const matches = [];
    data.cells?.forEach?.(cell => {
      const transform = cell?.transform;
      const params = transform?.params;
      if (!transform?.ref || !params || !Object.prototype.hasOwnProperty.call(params, 'modelIndex')) return;
      const transformerId = String(transform.transformer?.id || transform.transformer?.definition?.name || '');
      if (transformerId && transformerId !== 'model-from-trajectory' && !transformerId.endsWith('.model-from-trajectory')) return;
      const frameCount = nativeTrajectoryFrameCount(plugin, cell);
      if (expectedCount > 0 && frameCount > 0 && frameCount !== expectedCount) return;
      matches.push({
        plugin,
        ref: transform.ref,
        params,
        frameCount,
        selected: selectedRefs.has(transform.ref)
      });
    });
    if (matches.length) {
      return matches.find(match => match.selected) ||
        matches.find(match => match.frameCount > 1) ||
        matches[0];
    }
    if (!selection || selection.structures?.length !== 1) return null;
    const model = selection.structures[0]?.model;
    const ref = model?.cell?.transform?.ref;
    const params = model?.cell?.transform?.params;
    if (!ref || !params || !Object.prototype.hasOwnProperty.call(params, 'modelIndex')) return null;
    return { plugin, ref, params, frameCount: expectedCount || 0, selected: true };
  }

  function readNativeTrajectoryPosition(expectedCount) {
    const transform = nativeTrajectoryModelTransform(expectedCount);
    if (transform) {
      const index = Number(transform.params.modelIndex);
      const total = transform.frameCount || expectedCount;
      if (Number.isFinite(index) && index >= 0 && Number.isFinite(total) && total > 0) {
        return {
          index: Math.max(0, Math.min(total - 1, Math.round(index))),
          total
        };
      }
    }
    return readNativeTrajectoryPositionFromDom(expectedCount);
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

  async function setNativeTrajectoryPoseDirect(index, poseCount) {
    const target = Math.max(0, Math.min(poseCount - 1, index));
    const transform = nativeTrajectoryModelTransform(poseCount);
    if (!transform) return false;
    await transform.plugin.state.updateTransform(
      transform.plugin.state.data,
      transform.ref,
      { ...transform.params, modelIndex: target },
      'Model Index'
    );
    await afterNativeTrajectoryPaint();
    return true;
  }

  async function setNativeTrajectoryPose(index, poseCount) {
    const target = Math.max(0, Math.min(poseCount - 1, index));
    if (await setNativeTrajectoryPoseDirect(target, poseCount)) return true;
    const current = readNativeTrajectoryPosition(poseCount);
    if (!current) return false;
    if (current.index === target) return true;
    const forwardSteps = (target - current.index + poseCount) % poseCount;
    const backwardSteps = (current.index - target + poseCount) % poseCount;
    const direction = forwardSteps <= backwardSteps ? 1 : -1;
    const stepCount = direction > 0 ? forwardSteps : backwardSteps;
    for (let step = 0; step < stepCount; step += 1) {
      const button = nativeTrajectoryStepButton(direction);
      if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
      button.click();
      await afterNativeTrajectoryPaint();
    }
    return true;
  }

  function installNativeTrajectoryPoseSync(poseCount, onPoseChange) {
    const state = activeViewer?.plugin?.state?.data;
    if (!state?.events?.changed?.subscribe) return null;
    const sync = () => {
      const position = readNativeTrajectoryPosition(poseCount);
      if (position) onPoseChange(position.index);
    };
    const subscription = state.events.changed.subscribe(sync);
    sync();
    return () => subscription?.unsubscribe?.();
  }

  function notifyDockingPoseChanged(activePose, prepared) {
    if (prepared?.kind !== 'docking') return;
    const poses = Array.isArray(prepared?.poses) ? prepared.poses : [];
    const index = Math.max(0, Math.min(poses.length - 1, Math.trunc(Number(activePose) || 0)));
    const pose = poses[index] || null;
    postHostMessage({
      type: 'dockingPoseChanged',
      activePose: index,
      poseCount: poses.length,
      poseMode: activeSdfPoseMode === 'all' ? 'all' : 'single',
      sourcePath: pose?.sourcePath || ''
    });
  }

  async function setSdfCollectionMoleculeFromAction(action = {}) {
    const prepared = activeMolstarPrepared;
    if (!activeViewer || prepared?.kind !== 'sdf-collection') {
      return agentActionFailure('set_sdf_molecule', 'NO_SDF_COLLECTION', 'The active Mol* viewer does not contain an SDF molecule collection.');
    }
    const poseCount = Number(prepared.poseCount || prepared.sdfPoseRecordCount || 0);
    if (!Number.isFinite(poseCount) || poseCount <= 0) {
      return agentActionFailure('set_sdf_molecule', 'NO_MOLECULES', 'The SDF molecule collection has no selectable molecules.');
    }
    const index = Math.max(0, Math.min(poseCount - 1, Math.trunc(Number(action.index) || 0)));
    try {
      if (activeSdfCollectionPoseSetter) {
        await activeSdfCollectionPoseSetter(index);
      } else {
        try { sessionStorage.setItem(trajectoryControlStorageKey(activeConfig, prepared), String(index)); } catch (_) {}
        await applySdfCollectionVisibility(activeViewer, prepared, index);
      }
      return {
        ok: true,
        command: 'set_sdf_molecule',
        result: { index, poseCount }
      };
    } catch (error) {
      return agentActionFailure('set_sdf_molecule', 'ACTION_ERROR', error?.message || String(error));
    }
  }

  async function setStructurePoseFromAction(action = {}) {
    if (!activeStructurePoseSetter) {
      return agentActionFailure('set_structure_pose', 'NO_POSE_CONTROLS', 'The active Mol* viewer does not expose pose controls.');
    }
    const index = Math.max(0, Math.trunc(Number(action.index) || 0));
    try {
      await activeStructurePoseSetter(index);
      return {
        ok: true,
        command: 'set_structure_pose',
        result: { index }
      };
    } catch (error) {
      return agentActionFailure('set_structure_pose', 'ACTION_ERROR', error?.message || String(error));
    }
  }

  function currentTrajectoryPlaybackSnapshot() {
    const root = document.querySelector('.buret-docking-poses');
    if (!root) return null;
    const slider = root.querySelector('.buret-docking-pose-slider');
    const speed = root.querySelector('.buret-docking-pose-speed');
    const stop = root.querySelector('button[aria-label^="Stop "]');
    return {
      frameIndex: Math.max(0, Math.trunc(Number(slider?.value) || 1) - 1),
      fps: String(speed?.value || ''),
      playing: Boolean(stop)
    };
  }

  async function restoreTrajectoryPlaybackSnapshot(snapshot) {
    if (!snapshot) return;
    if (activeStructurePoseSetter) await activeStructurePoseSetter(snapshot.frameIndex);
    const root = document.querySelector('.buret-docking-poses');
    const speed = root?.querySelector('.buret-docking-pose-speed');
    if (speed && snapshot.fps) {
      speed.value = snapshot.fps;
      speed.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (snapshot.playing && !root?.querySelector('button[aria-label^="Stop "]')) {
      root?.querySelector('button[aria-label^="Play "]')?.click();
    }
  }

  async function replaceTrajectorySmoothingPrepared(prepared, playbackOverride = null) {
    if (!activeViewer?.plugin || !prepared) throw new Error('The Mol* trajectory viewer is not ready.');
    if (typeof activeViewer.plugin.clear !== 'function') throw new Error('Mol* cannot replace this trajectory in place.');
    const currentPlayback = currentTrajectoryPlaybackSnapshot();
    const playbackSnapshot = playbackOverride ? {
      frameIndex: Math.max(0, Math.trunc(Number(playbackOverride.frameIndex) || 0)),
      fps: currentPlayback?.fps || '',
      playing: playbackOverride.playing === true
    } : currentPlayback;
    pendingTrajectoryPlaybackRestore = playbackSnapshot;
    try {
      await activeViewer.plugin.clear();
      await loadPreparedStructure(activeViewer, prepared);
      await restoreTrajectoryPlaybackSnapshot(playbackSnapshot);
      applyLayoutState(activeViewer);
      scheduleLayoutStateReapply(activeViewer);
      try { activeViewer.handleResize(); } catch (_) {}
    } finally {
      pendingTrajectoryPlaybackRestore = null;
    }
  }

  async function applyTrajectorySmoothingFromAction(action = {}) {
    const engine = window.BurreteTrajectorySmoothing;
    const originalPrepared = trajectorySmoothingState?.originalPrepared || activeMolstarPrepared;
    if (!engine?.smooth || !originalPrepared) {
      return agentActionFailure('apply_trajectory_smoothing', 'NOT_AVAILABLE', 'Trajectory smoothing is unavailable in this viewer runtime.');
    }
    try {
      const result = engine.smooth({
        data: originalPrepared.data,
        format: originalPrepared.format,
        preset: action.preset,
        targetFrames: action.targetFrames,
        referenceFrame: action.referenceFrame,
        align: action.align !== false
      });
      const smoothedPrepared = {
        ...originalPrepared,
        data: result.data,
        format: result.format,
        label: `${originalPrepared.label || 'Trajectory'} - smoothed motion`,
        poseCount: result.frameCount,
        pdbModelCount: result.format === 'pdb' ? result.frameCount : originalPrepared.pdbModelCount,
        xyzFrameCount: result.format === 'xyz' ? result.frameCount : originalPrepared.xyzFrameCount,
        nativeTrajectoryControls: true,
        controlLabel: 'Frame'
      };
      trajectorySmoothingState = { originalPrepared, smoothedPrepared, result, view: 'smoothed' };
      await replaceTrajectorySmoothingPrepared(smoothedPrepared);
      updateTrajectorySmoothingButtons();
      postHostMessage({
        type: 'trajectorySmoothingChanged',
        documentId: activeConfig?.documentId || '',
        view: 'smoothed',
        keyframeCount: result.keyframes.length,
        frameCount: result.frameCount,
        interpolation: result.interpolation,
        keyframes: result.keyframes,
        rawSignal: result.rawSignal,
        filteredSignal: result.filteredSignal
      });
      return {
        ok: true,
        command: 'apply_trajectory_smoothing',
        result: { keyframeCount: result.keyframes.length, frameCount: result.frameCount, interpolation: result.interpolation }
      };
    } catch (error) {
      return agentActionFailure('apply_trajectory_smoothing', 'UNSUPPORTED_TRAJECTORY', error?.message || String(error));
    }
  }

  async function applyExternalTrajectorySmoothingFromAction(action = {}) {
    const originalPrepared = trajectorySmoothingState?.originalPrepared || activeMolstarPrepared;
    if (!originalPrepared || !action.sourceUrl) {
      return agentActionFailure('apply_external_trajectory_smoothing', 'NOT_AVAILABLE', 'The smoothed trajectory is unavailable.');
    }
    try {
      const response = await fetch(String(action.sourceUrl), { cache: 'no-store' });
      if (!response.ok) throw new Error(`Could not read smoothed trajectory: ${response.status}`);
      const data = await response.text();
      const frameCount = Math.max(2, Math.trunc(Number(action.frameCount) || 2));
      const smoothedPrepared = {
        ...originalPrepared,
        data,
        format: 'xyz',
        label: `${originalPrepared.label || 'Trajectory'} - smoothed view`,
        poseCount: frameCount,
        pdbModelCount: 0,
        xyzFrameCount: frameCount,
        nativeTrajectoryControls: true,
        controlLabel: 'Frame'
      };
      trajectorySmoothingState = {
        originalPrepared,
        smoothedPrepared,
        result: { frameCount, interpolation: action.interpolation || 'linear' },
        view: 'smoothed'
      };
      await replaceTrajectorySmoothingPrepared(smoothedPrepared, {
        frameIndex: action.frameIndex,
        playing: action.playing
      });
      updateTrajectorySmoothingButtons();
      postHostMessage({ type: 'trajectorySmoothingChanged', documentId: activeConfig?.documentId || '', view: 'smoothed' });
      return { ok: true, command: 'apply_external_trajectory_smoothing', result: { frameCount } };
    } catch (error) {
      return agentActionFailure('apply_external_trajectory_smoothing', 'ACTION_ERROR', error?.message || String(error));
    }
  }

  async function setTrajectorySmoothingViewFromAction(action = {}) {
    if (!trajectorySmoothingState) {
      return agentActionFailure('set_trajectory_smoothing_view', 'NO_SMOOTHED_TRAJECTORY', 'Build a smoothed trajectory first.');
    }
    const view = action.view === 'original' ? 'original' : 'smoothed';
    try {
      const prepared = view === 'original' ? trajectorySmoothingState.originalPrepared : trajectorySmoothingState.smoothedPrepared;
      await replaceTrajectorySmoothingPrepared(prepared);
      trajectorySmoothingState.view = view;
      updateTrajectorySmoothingButtons();
      postHostMessage({ type: 'trajectorySmoothingChanged', documentId: activeConfig?.documentId || '', view });
      return { ok: true, command: 'set_trajectory_smoothing_view', result: { view } };
    } catch (error) {
      return agentActionFailure('set_trajectory_smoothing_view', 'ACTION_ERROR', error?.message || String(error));
    }
  }

  function updateTrajectorySmoothingButtons() {
    const active = trajectorySmoothingState?.view === 'smoothed';
    document.querySelectorAll('.buret-trajectory-smooth-button').forEach(button => {
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.setAttribute('aria-label', active ? 'Turn Smooth motion off' : 'Turn Smooth motion on');
      button.setAttribute('title', active ? 'Show the original trajectory' : 'Build or restore the smoothed view');
    });
  }

  async function setMolstarStyleFromAction(action = {}) {
    const style = normalizeMolstarStyle(action.style);
    try {
      requestMolstarStyle(style);
      return {
        ok: true,
        command: 'set_molstar_style',
        result: { style }
      };
    } catch (error) {
      return agentActionFailure('set_molstar_style', 'ACTION_ERROR', error?.message || String(error));
    }
  }

  async function setSdfCollectionContextStyleFromAction(action = {}) {
    const prepared = activeMolstarPrepared;
    if (!activeViewer || (prepared?.kind !== 'sdf-collection' && !prepared?.dockingSceneMode && prepared?.sdfPoseOverlayAvailable !== true && prepared?.xyzFrameOverlayAvailable !== true)) {
      return agentActionFailure('set_sdf_context_style', 'NO_SCENE_CONTEXT', 'The active Mol* viewer does not expose scene background controls.');
    }
    const style = setSdfCollectionContextStyle(action.style);
    try {
      if (prepared.dockingSceneMode) {
        const poseCount = Number(prepared.poseCount || 0);
        const activePose = readTrajectoryControlIndex(activeConfig, prepared, poseCount || 1);
        await applyDockingSceneVisibility(activeViewer, prepared, activePose, { focus: false });
      } else if (prepared.kind === 'docking' && prepared.sdfPoseOverlayAvailable === true) {
        const poseCount = Number(prepared.poseCount || 0);
        const activePose = readTrajectoryControlIndex(activeConfig, prepared, poseCount || 1);
        await applyDockingPoseCollectionVisibility(activeViewer, prepared, activePose, { contextStyle: style, focus: false });
      } else if (prepared.xyzFrameOverlayAvailable === true && activeSdfPoseMode === 'all') {
        const poseCount = Number(prepared.poseCount || prepared.xyzFrameCount || 0);
        const activePose = readTrajectoryControlIndex(activeConfig, prepared, poseCount || 1);
        await applyXyzFrameOverlayVisibility(activeViewer, prepared, activePose, { contextStyle: style, focus: false });
      } else if (activeSdfPoseMode === 'all') {
        const poseCount = Number(prepared.poseCount || prepared.sdfPoseRecordCount || 0);
        const activePose = readTrajectoryControlIndex(activeConfig, prepared, poseCount || 1);
        await applySdfCollectionVisibility(activeViewer, prepared, activePose, { contextStyle: style, focus: false });
      }
      return {
        ok: true,
        command: 'set_sdf_context_style',
        result: { style }
      };
    } catch (error) {
      return agentActionFailure('set_sdf_context_style', 'ACTION_ERROR', error?.message || String(error));
    }
  }

  async function setSdfCollectionContextOpacityFromAction(action = {}) {
    const prepared = activeMolstarPrepared;
    if (!activeViewer || (prepared?.kind !== 'sdf-collection' && !prepared?.dockingSceneMode && prepared?.sdfPoseOverlayAvailable !== true && prepared?.xyzFrameOverlayAvailable !== true)) {
      return agentActionFailure('set_sdf_context_opacity', 'NO_SCENE_CONTEXT', 'The active Mol* viewer does not expose scene background controls.');
    }
    const opacity = setSdfCollectionContextOpacity(action.opacity);
    try {
      if (prepared.dockingSceneMode) {
        const poseCount = Number(prepared.poseCount || 0);
        const activePose = readTrajectoryControlIndex(activeConfig, prepared, poseCount || 1);
        await applyDockingSceneVisibility(activeViewer, prepared, activePose, { focus: false });
      } else if (prepared.kind === 'docking' && prepared.sdfPoseOverlayAvailable === true) {
        const poseCount = Number(prepared.poseCount || 0);
        const activePose = readTrajectoryControlIndex(activeConfig, prepared, poseCount || 1);
        await applyDockingPoseCollectionVisibility(activeViewer, prepared, activePose, { contextOpacity: opacity, focus: false });
      } else if (prepared.xyzFrameOverlayAvailable === true && activeSdfPoseMode === 'all') {
        const poseCount = Number(prepared.poseCount || prepared.xyzFrameCount || 0);
        const activePose = readTrajectoryControlIndex(activeConfig, prepared, poseCount || 1);
        await applyXyzFrameOverlayVisibility(activeViewer, prepared, activePose, { contextOpacity: opacity, focus: false });
      } else if (activeSdfPoseMode === 'all') {
        const poseCount = Number(prepared.poseCount || prepared.sdfPoseRecordCount || 0);
        const activePose = readTrajectoryControlIndex(activeConfig, prepared, poseCount || 1);
        await applySdfCollectionVisibility(activeViewer, prepared, activePose, { contextOpacity: opacity, focus: false });
      }
      return {
        ok: true,
        command: 'set_sdf_context_opacity',
        result: { opacity }
      };
    } catch (error) {
      return agentActionFailure('set_sdf_context_opacity', 'ACTION_ERROR', error?.message || String(error));
    }
  }

  async function setSdfCollectionContextColorFromAction(action = {}) {
    const prepared = activeMolstarPrepared;
    if (!activeViewer || (prepared?.kind !== 'sdf-collection' && !prepared?.dockingSceneMode && prepared?.sdfPoseOverlayAvailable !== true && prepared?.xyzFrameOverlayAvailable !== true)) {
      return agentActionFailure('set_sdf_context_color', 'NO_SCENE_CONTEXT', 'The active Mol* viewer does not expose scene background controls.');
    }
    const color = setSdfCollectionContextColor(action.color);
    try {
      if (prepared.dockingSceneMode) {
        const poseCount = Number(prepared.poseCount || 0);
        const activePose = readTrajectoryControlIndex(activeConfig, prepared, poseCount || 1);
        await applyDockingSceneVisibility(activeViewer, prepared, activePose, { focus: false });
      } else if (prepared.kind === 'docking' && prepared.sdfPoseOverlayAvailable === true) {
        const poseCount = Number(prepared.poseCount || 0);
        const activePose = readTrajectoryControlIndex(activeConfig, prepared, poseCount || 1);
        await applyDockingPoseCollectionVisibility(activeViewer, prepared, activePose, { contextColor: color, focus: false });
      } else if (prepared.xyzFrameOverlayAvailable === true && activeSdfPoseMode === 'all') {
        const poseCount = Number(prepared.poseCount || prepared.xyzFrameCount || 0);
        const activePose = readTrajectoryControlIndex(activeConfig, prepared, poseCount || 1);
        await applyXyzFrameOverlayVisibility(activeViewer, prepared, activePose, { contextColor: color, focus: false });
      } else if (activeSdfPoseMode === 'all') {
        const poseCount = Number(prepared.poseCount || prepared.sdfPoseRecordCount || 0);
        const activePose = readTrajectoryControlIndex(activeConfig, prepared, poseCount || 1);
        await applySdfCollectionVisibility(activeViewer, prepared, activePose, { contextColor: color, focus: false });
      }
      return {
        ok: true,
        command: 'set_sdf_context_color',
        result: { color }
      };
    } catch (error) {
      return agentActionFailure('set_sdf_context_color', 'ACTION_ERROR', error?.message || String(error));
    }
  }

  async function setSdfPoseModeFromAction(action = {}) {
    const prepared = activeMolstarPrepared;
    if (!activeViewer || !structureOverlayAvailable(prepared)) {
      return agentActionFailure('set_sdf_pose_mode', 'NO_POSE_OVERLAY', 'The active Mol* viewer does not expose pose overlay controls.');
    }
    const mode = action.mode === 'all' ? 'all' : 'single';
    try {
      setSdfPoseMode(mode);
      notifyStructureOverlayModeChanged(prepared);
      updateSdfPoseButton(prepared);
      await reloadSdfPoseMode();
      return {
        ok: true,
        command: 'set_sdf_pose_mode',
        result: { mode }
      };
    } catch (error) {
      return agentActionFailure('set_sdf_pose_mode', 'ACTION_ERROR', error?.message || String(error));
    }
  }

  async function setSdfPoseIndexFromAction(action = {}) {
    const prepared = activeMolstarPrepared;
    const poseCount = Number(prepared?.poseCount || prepared?.sdfPoseRecordCount || 0);
    if (!activeViewer || !Number.isFinite(poseCount) || poseCount <= 0) {
      return agentActionFailure('set_sdf_pose_index', 'NO_POSES', 'The active Mol* viewer has no selectable poses.');
    }
    const index = Math.max(0, Math.min(poseCount - 1, Math.trunc(Number(action.index) || 0)));
    try {
      if (activeSdfPoseMode === 'all' && structureOverlayAvailable(prepared)) {
        setSdfPoseMode('single');
        notifyStructureOverlayModeChanged(prepared);
        updateSdfPoseButton(prepared);
      }
      try { sessionStorage.setItem(trajectoryControlStorageKey(activeConfig, prepared), String(index)); } catch (_) {}
      if (prepared.nativeTrajectoryControls && activeSdfPoseMode !== 'all') {
        const switched = await setNativeTrajectoryPose(index, poseCount);
        if (!switched) throw new Error('Mol* trajectory controls are not available.');
      } else if (prepared.xyzFrameOverlayAvailable === true) {
        await applyXyzFrameOverlayVisibility(activeViewer, prepared, index, { focus: false });
      } else if (prepared.kind === 'sdf-collection') {
        await applySdfCollectionVisibility(activeViewer, prepared, index, { focus: false });
      } else if (prepared.kind === 'docking' && prepared.sdfPoseOverlayAvailable === true) {
        await applyDockingPoseCollectionVisibility(activeViewer, prepared, index, { focus: false });
      } else {
        await reloadActiveMolstarStructure();
      }
      notifyDockingPoseChanged(index, prepared);
      return {
        ok: true,
        command: 'set_sdf_pose_index',
        result: { index, poseCount }
      };
    } catch (error) {
      return agentActionFailure('set_sdf_pose_index', 'ACTION_ERROR', error?.message || String(error));
    }
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
    activeSdfCollectionPoseSetter = null;
    activeStructurePoseSetter = null;
    document.body.classList.remove('buret-docking-pose-controls-active');
    if (!prepared) return;
    const overlayAvailable = structureOverlayAvailable(prepared);
    const overlayToggleAvailable = structureOverlayToggleAvailable(prepared);
    if (prepared.poseCount <= 1 && !overlayAvailable) return;
    document.body.classList.add('buret-docking-pose-controls-active');
    const root = document.createElement('div');
    root.className = 'buret-docking-poses';
    const controlLabel = String(prepared.controlLabel || 'Pose');
    const controlLabelLower = controlLabel.toLowerCase();
    root.setAttribute('aria-label', `${controlLabel} controls`);
    const all = overlayToggleAvailable ? createStructureOverlayToggleButton(prepared) : null;
    if (prepared.overlayOnly === true && all) {
      root.classList.add('buret-docking-poses-overlay-only');
      root.setAttribute('aria-label', `${controlLabel} overlay controls`);
      root.append(all);
      document.body.appendChild(root);
      restoreDockingPoseControlsPosition(root);
      const isolationDisposer = installDockingPoseInteractionIsolation(root);
      const hoverDisposer = installDockingPoseHoverSuppression();
      const dragDisposer = initDockingPoseControlsDrag(root);
      dockingPoseControlsDisposer = () => {
        isolationDisposer?.();
        hoverDisposer?.();
        dragDisposer?.();
        document.body.classList.remove('buret-docking-pose-controls-active');
      };
      return;
    }
    if (prepared.poseCount <= 1) return;
    const playbackRestore = pendingTrajectoryPlaybackRestore;
    pendingTrajectoryPlaybackRestore = null;
    let activePose = playbackRestore
      ? Math.max(0, Math.min(prepared.poseCount - 1, playbackRestore.frameIndex))
      : readTrajectoryControlIndex(activeConfig, prepared, prepared.poseCount);
    const initialPose = activePose;
    let loopTimer = null;
    let loopActive = Boolean(playbackRestore?.playing);
    let loopBusy = false;
    let loopStartedAt = 0;
    let loopStartPose = activePose;
    let poseRepeatDelayTimer = null;
    let poseRepeatTimer = null;
    let poseRepeatBusy = false;
    let poseRepeatTriggered = false;
    let suppressPoseClick = false;
    let sliderInputTimer = null;
    let sliderInputBusy = false;
    let pendingSliderIndex = null;
    const mainRow = document.createElement('div');
    mainRow.className = 'buret-docking-pose-main';
    const animationRow = document.createElement('div');
    animationRow.className = 'buret-docking-pose-animation';
    const label = document.createElement('span');
    label.title = prepared.ligandLabel || '';
    const animation = document.createElement('button');
    animation.type = 'button';
    animation.className = 'buret-docking-pose-animation-button';
    animation.textContent = '⏯';
    animation.setAttribute('aria-label', 'Select Molstar animation');
    animation.setAttribute('aria-expanded', 'false');
    animation.title = 'Select animation';
    const previous = document.createElement('button');
    previous.type = 'button';
    previous.textContent = 'Prev';
    previous.setAttribute('aria-label', `Previous ${controlLabelLower}`);
    const next = document.createElement('button');
    next.type = 'button';
    next.textContent = 'Next';
    next.setAttribute('aria-label', `Next ${controlLabelLower}`);
    const loop = document.createElement('button');
    loop.type = 'button';
    loop.textContent = 'Loop';
    loop.setAttribute('aria-label', `Play ${controlLabelLower} loop`);
    const smooth = document.createElement('button');
    smooth.type = 'button';
    smooth.className = 'buret-trajectory-smooth-button';
    smooth.textContent = 'Smooth';
    const smoothingActive = trajectorySmoothingState?.view === 'smoothed';
    smooth.classList.toggle('active', smoothingActive);
    smooth.setAttribute('aria-pressed', smoothingActive ? 'true' : 'false');
    smooth.setAttribute('aria-label', smoothingActive ? 'Turn Smooth motion off' : 'Turn Smooth motion on');
    smooth.title = smoothingActive ? 'Show the original trajectory' : 'Build or restore the smoothed view';
    const speed = document.createElement('input');
    speed.className = 'buret-docking-pose-speed';
    speed.setAttribute('aria-label', `${controlLabel} loop frames per second`);
    speed.type = 'number';
    speed.min = '0.1';
    speed.step = '0.1';
    speed.inputMode = 'decimal';
    speed.value = playbackRestore?.fps || formatTrajectoryFps(readTrajectoryLoopFps(activeConfig, prepared));
    speed.title = 'Frames per second (FPS)';
    const updateSpeedMode = () => {
      const fps = Number(speed.value);
      speed.classList.toggle('buret-docking-pose-speed-skip', Number.isFinite(fps) && fps > NATIVE_TRAJECTORY_LOOP_SKIP_FPS_THRESHOLD);
    };
    const slider = document.createElement('input');
    slider.className = 'buret-docking-pose-slider';
    slider.type = 'range';
    slider.min = '1';
    slider.max = String(prepared.poseCount);
    slider.step = '1';
    slider.setAttribute('aria-label', `${controlLabel} slider`);
    const refreshNativeTrajectoryStandalonePreview = () => {
      if (!prepared.nativeTrajectoryControls || !activeConfig) return;
      try { sessionStorage.setItem(trajectoryControlStorageKey(activeConfig, prepared), String(activePose)); } catch (_) {}
    };
    const supportsLivePoseInput = () => (
      prepared.nativeTrajectoryControls ||
      prepared.kind === 'sdf-collection' ||
      prepared.kind === 'xyz-frame-overlay' ||
      (prepared.kind === 'docking' && prepared.sdfPoseOverlayAvailable === true)
    );
    const updateControls = () => {
      label.textContent = trajectoryPoseLabel(prepared, controlLabel, activePose);
      previous.disabled = activePose <= 0;
      next.disabled = activePose >= prepared.poseCount - 1;
      slider.value = String(activePose + 1);
      refreshNativeTrajectoryStandalonePreview();
      postHostMessage({
        type: 'trajectoryFrameChanged',
        documentId: activeConfig?.documentId || '',
        frameIndex: activePose,
        frameCount: prepared.poseCount,
        playing: loopActive
      });
    };
    const setAnimationOptionsOpen = (open) => {
      root.classList.toggle('buret-docking-poses-animation-open', Boolean(open));
      animation.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    const isAnimationOptionsOpen = () => root.classList.contains('buret-docking-poses-animation-open');
    const setLoopActive = (active) => {
      loopActive = Boolean(active);
      if (!active && loopTimer) {
        clearTimeout(loopTimer);
        loopTimer = null;
        loopBusy = false;
      }
      if (active) {
        loopStartedAt = loopNow();
        loopStartPose = activePose;
      }
      loop.classList.toggle('active', Boolean(active));
      loop.textContent = active ? 'Stop' : 'Loop';
      loop.setAttribute('aria-label', active ? `Stop ${controlLabelLower} loop` : `Play ${controlLabelLower} loop`);
      if (active) setAnimationOptionsOpen(true);
      postHostMessage({
        type: 'trajectoryFrameChanged',
        documentId: activeConfig?.documentId || '',
        frameIndex: activePose,
        frameCount: prepared.poseCount,
        playing: loopActive
      });
    };
    updateControls();
    updateSpeedMode();
    const loopDelayMs = () => {
      const delay = trajectoryFpsToDelay(speed.value, prepared);
      return Number.isFinite(delay) && delay > 0 ? delay : 1200;
    };
    const loopNow = () => (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
    const loopTargetIndex = () => {
      const delay = loopDelayMs();
      const elapsed = Math.max(0, loopNow() - loopStartedAt);
      const frameOffset = Math.floor(elapsed / delay);
      return (loopStartPose + frameOffset) % prepared.poseCount;
    };
    const loopNextDelay = () => {
      const delay = loopDelayMs();
      const elapsed = Math.max(0, loopNow() - loopStartedAt);
      const untilNextFrame = delay - (elapsed % delay);
      return Math.max(minimumTrajectoryLoopTimerDelay(prepared), Math.min(delay, untilNextFrame));
    };
    const scheduleLoopStep = (delayMs = loopNextDelay()) => {
      loopTimer = window.setTimeout(() => {
        loopTimer = null;
        if (!loopActive) return;
        if (loopBusy) {
          scheduleLoopStep();
          return;
        }
        const nextIndex = loopTargetIndex();
        if (nextIndex === activePose) {
          scheduleLoopStep();
          return;
        }
        loopBusy = true;
        void setPose(nextIndex, { loopStep: true }).finally(() => {
          loopBusy = false;
          if (!loopActive) return;
          scheduleLoopStep();
        });
      }, Math.max(minimumTrajectoryLoopTimerDelay(prepared), delayMs));
    };
    const setPose = async (index, options = {}) => {
      const nextIndex = Math.max(0, Math.min(prepared.poseCount - 1, index));
      const previousIndex = activePose;
      try { sessionStorage.setItem(trajectoryControlStorageKey(activeConfig, prepared), String(nextIndex)); } catch (_) {}
      previous.disabled = true;
      next.disabled = true;
      label.textContent = trajectoryPoseLabel(prepared, controlLabel, nextIndex);
      try {
        if (prepared.nativeTrajectoryControls) {
          const switched = await setNativeTrajectoryPose(nextIndex, prepared.poseCount);
          if (!switched) throw new Error('Mol* trajectory controls are not available.');
          activePose = readNativeTrajectoryPosition(prepared.poseCount)?.index ?? nextIndex;
          updateControls();
          if (options.loopStep !== true && loopActive) {
            loopStartedAt = loopNow();
            loopStartPose = activePose;
            if (loopTimer) {
              clearTimeout(loopTimer);
              loopTimer = null;
            }
            scheduleLoopStep(loopDelayMs());
          }
          if (options.focus === true) {
            scheduleMolstarStructureFocus(viewer, { reason: 'native-trajectory-pose', durationMs: 180 });
          }
        } else if (prepared.kind === 'sdf-collection') {
          await applySdfCollectionVisibility(viewer, activeMolstarPrepared || prepared, nextIndex, { focus: options.focus === true });
          activePose = nextIndex;
          updateControls();
        } else if (prepared.kind === 'xyz-frame-overlay') {
          await applyXyzFrameOverlayVisibility(viewer, activeMolstarPrepared || prepared, nextIndex, { installControls: false, focus: options.focus === true });
          activePose = nextIndex;
          updateControls();
        } else if (prepared.kind === 'docking' && prepared.dockingSceneMode) {
          await applyDockingSceneVisibility(viewer, activeMolstarPrepared || prepared, nextIndex, { focus: options.focus === true });
          activePose = nextIndex;
          updateControls();
        } else if (prepared.kind === 'docking' && prepared.sdfPoseOverlayAvailable === true) {
          await applyDockingPoseCollectionVisibility(viewer, activeMolstarPrepared || prepared, nextIndex, { focus: options.focus === true });
          activePose = nextIndex;
          updateControls();
        } else {
          if (prepared.overlayOnly === true && activeSdfPoseMode === 'all') {
            setSdfPoseMode('single');
            notifyStructureOverlayModeChanged(activeMolstarPrepared || prepared);
          }
          await reloadActiveMolstarStructure();
          activePose = nextIndex;
          return;
        }
        notifyDockingPoseChanged(activePose, prepared);
      } catch (error) {
        try { sessionStorage.setItem(trajectoryControlStorageKey(activeConfig, prepared), String(previousIndex)); } catch (_) {}
        activePose = previousIndex;
        updateControls();
        setStatus(`[web] Could not switch ${controlLabelLower}.\n\n${error?.message || String(error)}`, 'error');
        // eslint-disable-next-line no-console
        console.error(error);
      }
    };
    activeStructurePoseSetter = setPose;
    if (prepared.kind === 'sdf-collection') activeSdfCollectionPoseSetter = setPose;
    const stopPoseRepeat = () => {
      if (poseRepeatDelayTimer) {
        clearTimeout(poseRepeatDelayTimer);
        poseRepeatDelayTimer = null;
      }
      if (poseRepeatTimer) {
        clearInterval(poseRepeatTimer);
        poseRepeatTimer = null;
      }
      if (poseRepeatTriggered) {
        suppressPoseClick = true;
        window.setTimeout(() => { suppressPoseClick = false; }, 250);
      }
      poseRepeatTriggered = false;
    };
    const repeatPoseStep = (direction) => {
      if (poseRepeatBusy) return;
      const nextIndex = activePose + direction;
      const wrappedIndex = nextIndex < 0
        ? prepared.poseCount - 1
        : nextIndex >= prepared.poseCount
          ? 0
          : nextIndex;
      poseRepeatBusy = true;
      void setPose(wrappedIndex, { userStep: true }).finally(() => {
        poseRepeatBusy = false;
      });
    };
    const bindPoseStepButton = (button, direction) => {
      button.addEventListener('pointerdown', event => {
        if (event.button !== 0 || button.disabled) return;
        poseRepeatTriggered = false;
        poseRepeatDelayTimer = window.setTimeout(() => {
          poseRepeatTriggered = true;
          repeatPoseStep(direction);
          poseRepeatTimer = window.setInterval(() => repeatPoseStep(direction), 320);
        }, 360);
        try { button.setPointerCapture(event.pointerId); } catch (_) {}
      });
      button.addEventListener('pointerup', event => {
        try { button.releasePointerCapture(event.pointerId); } catch (_) {}
        stopPoseRepeat();
      });
      button.addEventListener('pointercancel', stopPoseRepeat);
      button.addEventListener('lostpointercapture', stopPoseRepeat);
      button.addEventListener('click', event => {
        if (suppressPoseClick) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        void setPose(activePose + direction, { userStep: true });
      });
    };
    const flushPendingSliderInput = () => {
      if (sliderInputBusy || pendingSliderIndex === null) return;
      const nextIndex = pendingSliderIndex;
      pendingSliderIndex = null;
      sliderInputBusy = true;
      void setPose(nextIndex, { userStep: true }).finally(() => {
        sliderInputBusy = false;
        flushPendingSliderInput();
      });
    };
    const scheduleSliderInputPose = (index) => {
      pendingSliderIndex = Math.max(0, Math.min(prepared.poseCount - 1, index));
      if (sliderInputTimer) clearTimeout(sliderInputTimer);
      sliderInputTimer = window.setTimeout(() => {
        sliderInputTimer = null;
        flushPendingSliderInput();
      }, 24);
    };
    animation.addEventListener('click', () => {
      const open = !isAnimationOptionsOpen();
      setAnimationOptionsOpen(open);
      if (!open) return;
      const button = nativeAnimationSelectButton();
      if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') {
        button.click();
      } else {
        setStatus('[web] Mol* animation selector is not available for this document.', 'error');
      }
    });
    bindPoseStepButton(previous, -1);
    bindPoseStepButton(next, 1);
    loop.addEventListener('click', () => {
      if (loopActive) {
        setLoopActive(false);
        return;
      }
      setLoopActive(true);
      scheduleLoopStep();
    });
    smooth.addEventListener('click', () => {
      const posted = postHostMessage({
        type: 'openTrajectorySmoothing',
        documentId: activeConfig?.documentId || ''
      });
      setStatus(posted ? '[web] Smooth motion toggled.' : '[web] Smooth motion is available in the Info panel.');
      setTimeout(hideStatus, 1200);
    });
    speed.addEventListener('change', () => {
      const delay = loopDelayMs();
      const fps = trajectoryDelayToFps(delay, prepared);
      speed.value = formatTrajectoryFps(fps);
      updateSpeedMode();
      try { localStorage.setItem(trajectoryLoopFpsStorageKey(activeConfig, prepared), String(fps)); } catch (_) {}
      if (!loopActive) return;
      setLoopActive(false);
      loop.click();
    });
    speed.addEventListener('input', updateSpeedMode);
    slider.addEventListener('input', () => {
      const previewIndex = Math.max(0, Math.min(prepared.poseCount - 1, Number(slider.value) - 1));
      label.textContent = `${controlLabel} ${previewIndex + 1} / ${prepared.poseCount}`;
      if (supportsLivePoseInput()) scheduleSliderInputPose(previewIndex);
    });
    slider.addEventListener('change', () => {
      const nextIndex = Math.max(0, Math.min(prepared.poseCount - 1, Number(slider.value) - 1));
      if (supportsLivePoseInput()) {
        if (sliderInputTimer) {
          clearTimeout(sliderInputTimer);
          sliderInputTimer = null;
        }
        pendingSliderIndex = nextIndex;
        flushPendingSliderInput();
        return;
      }
      void setPose(nextIndex, { userStep: true });
    });
    const onKeyDown = (event) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (isDockingPoseKeyboardTarget(event.target)) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (activePose > 0) void setPose(activePose - 1, { userStep: true });
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (activePose < prepared.poseCount - 1) void setPose(activePose + 1, { userStep: true });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    dockingPoseKeydownDisposer = () => window.removeEventListener('keydown', onKeyDown);
    mainRow.append(animation, previous, label, next);
    if (prepared.kind === 'trajectory' || prepared.kind === 'xyz-frame-overlay' || prepared.nativeTrajectoryControls) mainRow.append(smooth);
    if (all) mainRow.append(all);
    animationRow.append(speed, loop, slider);
    root.append(mainRow, animationRow);
    document.body.appendChild(root);
    restoreDockingPoseControlsPosition(root);
    const isolationDisposer = installDockingPoseInteractionIsolation(root);
    const hoverDisposer = installDockingPoseHoverSuppression();
    const dragDisposer = initDockingPoseControlsDrag(root);
    const syncDisposer = prepared.nativeTrajectoryControls
      ? installNativeTrajectoryPoseSync(prepared.poseCount, index => {
          activePose = Math.max(0, Math.min(prepared.poseCount - 1, index));
          updateControls();
          notifyDockingPoseChanged(activePose, prepared);
        })
      : null;
    if (prepared.nativeTrajectoryControls && initialPose > 0) {
      void setPose(initialPose).finally(() => {
        if (!playbackRestore?.playing || activeStructurePoseSetter !== setPose) return;
        setLoopActive(true);
        scheduleLoopStep();
      });
    } else {
      notifyDockingPoseChanged(activePose, prepared);
      if (playbackRestore?.playing) {
        setLoopActive(true);
        scheduleLoopStep();
      }
    }
    dockingPoseControlsDisposer = () => {
      stopPoseRepeat();
      if (sliderInputTimer) {
        clearTimeout(sliderInputTimer);
        sliderInputTimer = null;
      }
      pendingSliderIndex = null;
      if (pendingTrajectoryPlaybackRestore?.playing) {
        if (loopTimer) clearTimeout(loopTimer);
        loopTimer = null;
        loopActive = false;
      } else {
        setLoopActive(false);
      }
      syncDisposer?.();
      isolationDisposer?.();
      hoverDisposer?.();
      dragDisposer?.();
      document.body.classList.remove('buret-docking-pose-controls-active');
      if (activeStructurePoseSetter === setPose) activeStructurePoseSetter = null;
      if (activeSdfCollectionPoseSetter === setPose) activeSdfCollectionPoseSetter = null;
    };
  }

  function isMolstarContextMenuTarget(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest('#buret-toolbar, .buret-docking-poses, .buret-molecule-context-menu')) return false;
    if (target.closest('button, input, select, textarea, [contenteditable="true"]')) return false;
    if (target.closest('.msp-viewport-controls, .msp-viewport-top-left-controls, .msp-selection-viewport-controls')) return false;
    return !!target.closest('.msp-plugin .msp-viewport, .msp-plugin .msp-viewport-host, .msp-plugin canvas');
  }

  function positionMolstarContextMenu(menu, clientX, clientY) {
    const margin = 8;
    menu.style.left = margin + 'px';
    menu.style.top = margin + 'px';
    const rect = menu.getBoundingClientRect();
    const left = Math.min(Math.max(margin, clientX), Math.max(margin, window.innerWidth - rect.width - margin));
    const top = Math.min(Math.max(margin, clientY), Math.max(margin, window.innerHeight - rect.height - margin));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }

  function molstarLociIsEmpty(loci) {
    if (!loci || loci.kind === 'empty-loci') return true;
    if (Array.isArray(loci.elements) && loci.elements.length === 0) return true;
    if (Array.isArray(loci.bonds) && loci.bonds.length === 0) return true;
    return false;
  }

  function molstarContextCanvasFromEvent(event) {
    const target = event?.target;
    if (!(target instanceof Element)) return null;
    if (target instanceof HTMLCanvasElement) return target;
    return target.closest('canvas') || target.closest('.msp-plugin')?.querySelector('canvas') || null;
  }

  function molstarPickFromCanvasPoint(canvas, clientX, clientY) {
    const canvas3d = activeViewer?.plugin?.canvas3d;
    if (!canvas || !canvas3d || typeof canvas3d.identify !== 'function' || typeof canvas3d.getLoci !== 'function') return null;
    const rect = canvas.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    try {
      const picking = canvas3d.identify([clientX - rect.left, clientY - rect.top]);
      const pick = picking?.id ? canvas3d.getLoci(picking.id) : null;
      if (!pick?.loci || molstarLociIsEmpty(pick.loci)) return null;
      return { ...pick, position: picking.position };
    } catch (error) {
      debug('Mol* canvas pick failed: ' + (error?.message || String(error)));
      return null;
    }
  }

  function molstarContextPickFromEvent(event, options = {}) {
    const canvas3d = activeViewer?.plugin?.canvas3d;
    if (!canvas3d || typeof canvas3d.identify !== 'function' || typeof canvas3d.getLoci !== 'function') return null;
    const canvas = molstarContextCanvasFromEvent(event);
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return null;
    const radius = Math.max(0, Number(options.radiusPx) || 0);
    const step = Math.max(2, Number(options.stepPx) || MOLSTAR_TOUCH_PICK_STEP_PX);
    const offsets = [[0, 0]];
    if (radius > 0) {
      for (let distance = step; distance <= radius; distance += step) {
        offsets.push(
          [distance, 0],
          [-distance, 0],
          [0, distance],
          [0, -distance],
          [distance, distance],
          [distance, -distance],
          [-distance, distance],
          [-distance, -distance]
        );
      }
    }
    try {
      for (const [dx, dy] of offsets) {
        const x = event.clientX + dx;
        const y = event.clientY + dy;
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
        const pick = molstarPickFromCanvasPoint(canvas, x, y);
        if (!pick?.loci || molstarLociIsEmpty(pick.loci)) continue;
        return { ...pick, touchAdjusted: dx !== 0 || dy !== 0 };
      }
      return null;
    } catch (error) {
      debug('Mol* context pick failed: ' + (error?.message || String(error)));
      return null;
    }
  }

  function molstarContextEventIsTouch(event) {
    return event?.pointerType === 'touch' || event?.sourceCapabilities?.firesTouchEvents === true;
  }

  function molstarContextTouchPickOptions(event) {
    return molstarContextEventIsTouch(event)
      ? { radiusPx: MOLSTAR_TOUCH_PICK_RADIUS_PX, stepPx: MOLSTAR_TOUCH_PICK_STEP_PX }
      : {};
  }

  function installMolstarLassoSelection() {
    if (window.__buretteMolstarLassoSelectionInstalled) return;
    window.__buretteMolstarLassoSelectionInstalled = true;
    document.addEventListener('pointerdown', onMolstarLassoPointerDown, true);
    document.addEventListener('pointermove', onMolstarLassoPointerMove, true);
    document.addEventListener('pointerup', onMolstarLassoPointerUp, true);
    document.addEventListener('pointercancel', onMolstarLassoPointerCancel, true);
    document.addEventListener('pointerdown', onXyzrenderLassoPointerDown, true);
    document.addEventListener('pointermove', onXyzrenderLassoPointerMove, true);
    document.addEventListener('pointerup', onXyzrenderLassoPointerUp, true);
    document.addEventListener('pointercancel', onXyzrenderLassoPointerCancel, true);
    document.addEventListener('keydown', onMolstarLassoKeyDown, true);
    window.addEventListener('resize', cancelMolstarLassoStroke);
    window.addEventListener('resize', cancelXyzrenderLassoStroke);
  }

  function onMolstarLassoKeyDown(event) {
    if (event.key !== 'Escape') return;
    if (xyzrenderLassoStroke) {
      event.preventDefault();
      event.stopPropagation();
      cancelXyzrenderLassoStroke();
      setStatus('[web] xyzrender lasso canceled.');
      return;
    }
    if (xyzrenderLassoEnabled) {
      event.preventDefault();
      event.stopPropagation();
      setXyzrenderLassoEnabled(false);
      return;
    }
    if (molstarLassoStroke) {
      event.preventDefault();
      event.stopPropagation();
      cancelMolstarLassoStroke();
      setStatus('[web] Lasso selection canceled.');
      return;
    }
    if (molstarLassoEnabled) {
      event.preventDefault();
      event.stopPropagation();
      setMolstarLassoEnabled(false);
    }
  }

  function onMolstarLassoPointerDown(event) {
    if (!molstarLassoEnabled || event.button !== 0 || !isMolstarContextMenuTarget(event.target)) return;
    const canvas = molstarContextCanvasFromEvent(event);
    if (!canvas) return;
    hideMolstarContextMenu();
    hideMolstarMoleculePreview();
    molstarLassoStroke = {
      pointerId: event.pointerId,
      canvas,
      additive: event.shiftKey || event.metaKey || event.ctrlKey,
      dragging: false,
      points: [{ x: event.clientX, y: event.clientY }]
    };
    try { canvas.setPointerCapture?.(event.pointerId); } catch (_) {}
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  function onMolstarLassoPointerMove(event) {
    const stroke = molstarLassoStroke;
    if (!stroke || event.pointerId !== stroke.pointerId) return;
    const last = stroke.points[stroke.points.length - 1];
    if (Math.hypot(event.clientX - last.x, event.clientY - last.y) >= MOLSTAR_LASSO_MIN_DISTANCE_PX) {
      if (!stroke.dragging) {
        stroke.dragging = true;
        hideMolstarContextMenu();
        hideMolstarMoleculePreview();
        ensureMolstarLassoOverlay();
        try { stroke.canvas.setPointerCapture?.(event.pointerId); } catch (_) {}
      }
      stroke.points.push({ x: event.clientX, y: event.clientY });
      updateMolstarLassoOverlay(stroke.points);
    }
    if (!stroke.dragging) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  function onMolstarLassoPointerUp(event) {
    const stroke = molstarLassoStroke;
    if (!stroke || event.pointerId !== stroke.pointerId) return;
    if (!stroke.dragging) {
      molstarLassoStroke = null;
      return;
    }
    if (Math.hypot(event.clientX - stroke.points[0].x, event.clientY - stroke.points[0].y) >= MOLSTAR_LASSO_MIN_DISTANCE_PX) {
      stroke.points.push({ x: event.clientX, y: event.clientY });
    }
    finishMolstarLassoStroke(stroke);
    try { stroke.canvas.releasePointerCapture?.(event.pointerId); } catch (_) {}
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  function onMolstarLassoPointerCancel(event) {
    const stroke = molstarLassoStroke;
    if (!stroke || event.pointerId !== stroke.pointerId) return;
    cancelMolstarLassoStroke();
    if (!stroke.dragging) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  function ensureMolstarLassoOverlay() {
    if (molstarLassoOverlay) return molstarLassoOverlay;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('buret-molstar-lasso-overlay');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<polygon data-buret-lasso-fill></polygon><polyline data-buret-lasso-line></polyline>';
    document.body.appendChild(svg);
    molstarLassoOverlay = svg;
    return svg;
  }

  function updateMolstarLassoOverlay(points) {
    const overlay = ensureMolstarLassoOverlay();
    const value = points.map(point => `${Math.round(point.x)},${Math.round(point.y)}`).join(' ');
    overlay.querySelector('[data-buret-lasso-fill]')?.setAttribute('points', value);
    overlay.querySelector('[data-buret-lasso-line]')?.setAttribute('points', value);
  }

  function removeMolstarLassoOverlay() {
    molstarLassoOverlay?.remove();
    molstarLassoOverlay = null;
  }

  function cancelMolstarLassoStroke() {
    molstarLassoStroke = null;
    removeMolstarLassoOverlay();
  }

  function finishMolstarLassoStroke(stroke) {
    molstarLassoStroke = null;
    removeMolstarLassoOverlay();
    const bounds = molstarLassoBounds(stroke.points);
    if (stroke.points.length < MOLSTAR_LASSO_MIN_POINTS || bounds.width < MOLSTAR_LASSO_SAMPLE_STEP_PX || bounds.height < MOLSTAR_LASSO_SAMPLE_STEP_PX) {
      setStatus('[web] Lasso selection was too small.');
      return;
    }
    const picks = molstarLassoPicks(stroke);
    if (!picks.length) {
      setStatus('[web] No visible atoms inside lasso.');
      return;
    }
    const selected = applyMolstarLassoPicks(picks, stroke.additive);
    setStatus(selected > 0
      ? `[web] Selected ${selected} visible target${selected === 1 ? '' : 's'} with lasso.`
      : '[web] Lasso selection did not match selectable atoms.');
  }

  function molstarLassoBounds(points) {
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    return { left, right, top, bottom, width: right - left, height: bottom - top };
  }

  function molstarPointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const pi = polygon[i];
      const pj = polygon[j];
      const intersects = ((pi.y > point.y) !== (pj.y > point.y)) &&
        point.x < ((pj.x - pi.x) * (point.y - pi.y)) / ((pj.y - pi.y) || 1e-6) + pi.x;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function molstarLassoPickKey(pick, fallback) {
    const atom = molstarContextAtomFromLoci(pick?.loci);
    if (atom) {
      return [
        atom.model?.id || atom.model?.entryId || 'model',
        atom.label_entity_id || '',
        atom.label_asym_id || atom.auth_asym_id || '',
        atom.label_seq_id ?? atom.auth_seq_id ?? '',
        atom.label_comp_id || atom.auth_comp_id || '',
        atom.atomIndex ?? ''
      ].join(':');
    }
    return `${pick?.loci?.kind || 'loci'}:${fallback}`;
  }

  function molstarLassoPicks(stroke) {
    const bounds = molstarLassoBounds(stroke.points);
    const picks = [];
    const seen = new Set();
    let sampled = 0;
    const addPick = (x, y) => {
      if (sampled >= MOLSTAR_LASSO_SAMPLE_LIMIT) return;
      sampled += 1;
      const pick = molstarPickFromCanvasPoint(stroke.canvas, x, y);
      if (!pick?.loci) return;
      const key = molstarLassoPickKey(pick, `${Math.round(x)}:${Math.round(y)}`);
      if (seen.has(key)) return;
      seen.add(key);
      picks.push(pick);
    };
    for (const point of stroke.points) {
      addPick(point.x, point.y);
    }
    for (let y = bounds.top; y <= bounds.bottom; y += MOLSTAR_LASSO_SAMPLE_STEP_PX) {
      for (let x = bounds.left; x <= bounds.right; x += MOLSTAR_LASSO_SAMPLE_STEP_PX) {
        if (molstarPointInPolygon({ x, y }, stroke.points)) addPick(x, y);
      }
    }
    return picks;
  }

  function applyMolstarLassoPicks(picks, additive) {
    const selects = activeViewer?.plugin?.managers?.interactivity?.lociSelects;
    const selection = activeViewer?.plugin?.managers?.structure?.selection;
    const canSelect = typeof selects?.select === 'function';
    const canSelectStructure = typeof selection?.fromLoci === 'function';
    if (!canSelect && !canSelectStructure) return 0;
    const lassoApplyGranularity = false;
    if (!additive) {
      selects?.deselectAll?.();
      selection?.clear?.();
      molstarLassoSelectionAtoms.clear();
      molstarLassoSelectionAtomKeys.clear();
      molstarLassoSelectionResidueKeys.clear();
    }
    let selected = 0;
    for (const pick of picks) {
      const loci = molstarContextNormalizeLoci(pick?.loci, 'element');
      if (!loci || molstarLociIsEmpty(loci)) continue;
      if (canSelect) selects.select({ loci }, lassoApplyGranularity);
      if (canSelectStructure) selection.fromLoci('add', loci, lassoApplyGranularity);
      selected += 1;
    }
    if (selected > 0) {
      scheduleMolstarSelectedMoleculePreview();
      notifyMolstarLassoSelection(picks, selected);
    }
    return selected;
  }

  function notifyMolstarLassoSelection(picks, selected) {
    for (const pick of picks) {
      const atom = molstarContextAtomFromLoci(pick?.loci);
      if (!atom) continue;
      const chain = String(atom.auth_asym_id || atom.label_asym_id || '').trim();
      const sequence = atom.auth_seq_id ?? atom.label_seq_id ?? null;
      const compId = String(atom.auth_comp_id || atom.label_comp_id || '').trim();
      const atomName = String(atom.auth_atom_id || atom.label_atom_id || '').trim();
      const atomKey = `${chain}:${sequence ?? ''}:${compId}:${atomName}:${atom.atomIndex ?? ''}`;
      molstarLassoSelectionAtomKeys.add(atomKey);
      molstarLassoSelectionResidueKeys.add(`${chain}:${sequence ?? ''}:${compId}`);
      if (!molstarLassoSelectionAtoms.has(atomKey) && molstarLassoSelectionAtoms.size < 96) {
        molstarLassoSelectionAtoms.set(atomKey, { chain, sequence, compId, atomName });
      }
    }
    const atoms = Array.from(molstarLassoSelectionAtoms.values());
    const residues = new Map();
    for (const atom of atoms) {
      const { chain, sequence, compId } = atom;
      const residueKey = `${chain}:${sequence ?? ''}:${compId}`;
      if (!residues.has(residueKey) && residues.size < 96) {
        residues.set(residueKey, { chain, sequence, compId });
      }
    }
    window.__mqlPost?.('selectionChanged', '', {
      selection: {
        source: 'lasso',
        label: `Lasso selection: ${molstarLassoSelectionAtomKeys.size} visible atom${molstarLassoSelectionAtomKeys.size === 1 ? '' : 's'} across ${molstarLassoSelectionResidueKeys.size} residue${molstarLassoSelectionResidueKeys.size === 1 ? '' : 's'}`,
        atoms: molstarLassoSelectionAtomKeys.size,
        residueCount: molstarLassoSelectionResidueKeys.size,
        visibleTargets: selected,
        residues: Array.from(residues.values()),
        atomIdentities: atoms
      }
    });
  }

  function onXyzrenderLassoPointerDown(event) {
    if (!xyzrenderLassoEnabled || event.button !== 0) return;
    const item = xyzrenderSheetItemFromEvent(event);
    if (!item) return;
    hideXyzrenderSheetContextMenu();
    xyzrenderLassoStroke = {
      pointerId: event.pointerId,
      item,
      additive: event.shiftKey || event.metaKey || event.ctrlKey,
      dragging: false,
      points: [{ x: event.clientX, y: event.clientY }]
    };
    try { item.setPointerCapture?.(event.pointerId); } catch (_) {}
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  function onXyzrenderLassoPointerMove(event) {
    const stroke = xyzrenderLassoStroke;
    if (!stroke || event.pointerId !== stroke.pointerId) return;
    const last = stroke.points[stroke.points.length - 1];
    if (Math.hypot(event.clientX - last.x, event.clientY - last.y) >= MOLSTAR_LASSO_MIN_DISTANCE_PX) {
      if (!stroke.dragging) {
        stroke.dragging = true;
        hideXyzrenderSheetContextMenu();
        ensureXyzrenderLassoOverlay();
        try { stroke.item.setPointerCapture?.(event.pointerId); } catch (_) {}
      }
      stroke.points.push({ x: event.clientX, y: event.clientY });
      updateXyzrenderLassoOverlay(stroke.points);
    }
    if (!stroke.dragging) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  function onXyzrenderLassoPointerUp(event) {
    const stroke = xyzrenderLassoStroke;
    if (!stroke || event.pointerId !== stroke.pointerId) return;
    if (!stroke.dragging) {
      xyzrenderLassoStroke = null;
      clearXyzrenderSelection();
      return;
    }
    if (Math.hypot(event.clientX - stroke.points[0].x, event.clientY - stroke.points[0].y) >= MOLSTAR_LASSO_MIN_DISTANCE_PX) {
      stroke.points.push({ x: event.clientX, y: event.clientY });
    }
    finishXyzrenderLassoStroke(stroke);
    try { stroke.item.releasePointerCapture?.(event.pointerId); } catch (_) {}
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  function onXyzrenderLassoPointerCancel(event) {
    const stroke = xyzrenderLassoStroke;
    if (!stroke || event.pointerId !== stroke.pointerId) return;
    cancelXyzrenderLassoStroke();
    if (!stroke.dragging) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  function xyzrenderSheetItemFromEvent(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('.buret-xyzrender-sheet-rotate-handle, [data-buret-resize-handle], #buret-toolbar, .buret-xyzrender-popover')) return null;
    const item = target.closest('.buret-xyzrender-sheet-item')
      || xyzrenderSheetItemFromContextEvent(event, document);
    if (!item || !item.querySelector('.buret-xyzrender-sheet-item-body svg')) return null;
    return item;
  }

  function ensureXyzrenderLassoOverlay() {
    if (xyzrenderLassoOverlay) return xyzrenderLassoOverlay;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('buret-molstar-lasso-overlay', 'buret-xyzrender-lasso-overlay');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<polygon data-buret-lasso-fill></polygon><polyline data-buret-lasso-line></polyline>';
    document.body.appendChild(svg);
    xyzrenderLassoOverlay = svg;
    return svg;
  }

  function updateXyzrenderLassoOverlay(points) {
    const overlay = ensureXyzrenderLassoOverlay();
    const value = points.map(point => `${Math.round(point.x)},${Math.round(point.y)}`).join(' ');
    overlay.querySelector('[data-buret-lasso-fill]')?.setAttribute('points', value);
    overlay.querySelector('[data-buret-lasso-line]')?.setAttribute('points', value);
  }

  function removeXyzrenderLassoOverlay() {
    xyzrenderLassoOverlay?.remove();
    xyzrenderLassoOverlay = null;
  }

  function cancelXyzrenderLassoStroke() {
    xyzrenderLassoStroke = null;
    removeXyzrenderLassoOverlay();
  }

  function finishXyzrenderLassoStroke(stroke) {
    xyzrenderLassoStroke = null;
    removeXyzrenderLassoOverlay();
    const bounds = molstarLassoBounds(stroke.points);
    if (stroke.points.length < MOLSTAR_LASSO_MIN_POINTS || bounds.width < MOLSTAR_LASSO_SAMPLE_STEP_PX || bounds.height < MOLSTAR_LASSO_SAMPLE_STEP_PX) {
      setStatus('[web] xyzrender lasso was too small.');
      return;
    }
    const result = selectXyzrenderElementsInLasso(stroke.item, stroke.points, stroke.additive);
    const selected = result.count;
    const label = result.kind === 'atom' ? 'atom' : 'graphic';
    setStatus(selected > 0
      ? `[web] Selected ${selected} xyzrender ${label}${selected === 1 ? '' : 's'} with lasso.`
      : '[web] xyzrender lasso did not match visible graphics.');
  }

  function selectXyzrenderElementsInLasso(item, points, additive) {
    if (!additive) clearXyzrenderSelection();
    const atomNodes = xyzrenderAtomNodes(item);
    let selectedAtoms = 0;
    if (atomNodes.length > 0) {
      for (const atom of atomNodes) {
        if (!xyzrenderAtomIntersectsLasso(atom, points)) continue;
        markXyzrenderElementSelected(atom.element);
        selectedAtoms += 1;
      }
    }
    if (selectedAtoms > 0) {
      updateXyzrenderSelectionRoots();
      return { count: selectedAtoms, kind: 'atom' };
    }
    let selected = 0;
    for (const element of xyzrenderSelectableElements(item)) {
      if (!svgElementIntersectsLasso(element, points, item)) continue;
      markXyzrenderElementSelected(element);
      selected += 1;
    }
    updateXyzrenderSelectionRoots();
    return { count: selected, kind: 'graphic' };
  }

  function xyzrenderAtomIntersectsLasso(atom, points) {
    const radius = Math.max(5, Number(atom?.radius) || 0);
    const candidates = [
      { x: atom.x, y: atom.y },
      { x: atom.x - radius, y: atom.y },
      { x: atom.x + radius, y: atom.y },
      { x: atom.x, y: atom.y - radius },
      { x: atom.x, y: atom.y + radius }
    ];
    return candidates.some(point => molstarPointInPolygon(point, points) || pointNearLassoStroke(point, points, radius + 4));
  }

  function xyzrenderSelectableElements(item) {
    return xyzrenderGraphicElements(item).filter(element => {
      if (!element.getBoundingClientRect) return false;
      const rect = element.getBoundingClientRect();
      const tagName = element.tagName.toLowerCase();
      const hasArea = rect.width > 0 && rect.height > 0;
      const hasStrokeExtent = svgElementHasStroke(element) && (rect.width > 0 || rect.height > 0);
      if (!hasArea && !hasStrokeExtent) return false;
      if (tagName === 'rect') {
        const itemRect = item.getBoundingClientRect();
        if (rect.width > itemRect.width * 0.82 && rect.height > itemRect.height * 0.82) return false;
      }
      const style = window.getComputedStyle(element);
      return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) > 0.01;
    });
  }

  function svgElementIntersectsLasso(element, points, item) {
    const rect = element.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    if (rect.right < itemRect.left || rect.left > itemRect.right || rect.bottom < itemRect.top || rect.top > itemRect.bottom) return false;
    const candidates = [
      { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      { x: rect.left, y: rect.top },
      { x: rect.right, y: rect.top },
      { x: rect.right, y: rect.bottom },
      { x: rect.left, y: rect.bottom }
    ];
    if (candidates.some(point => molstarPointInPolygon(point, points) || pointNearLassoStroke(point, points, 6))) return true;
    return rectIntersectsLassoStroke(rect, points, 6);
  }

  function pointNearLassoStroke(point, points, threshold) {
    const limit = Math.max(1, Number(threshold) || 1);
    for (let index = 1; index < points.length; index += 1) {
      if (pointDistanceToSegment(point, points[index - 1], points[index]) <= limit) return true;
    }
    return false;
  }

  function rectIntersectsLassoStroke(rect, points, threshold) {
    const inset = Math.max(1, Number(threshold) || 1);
    for (const point of points) {
      if (
        point.x >= rect.left - inset &&
        point.x <= rect.right + inset &&
        point.y >= rect.top - inset &&
        point.y <= rect.bottom + inset
      ) return true;
    }
    return false;
  }

  function pointDistanceToSegment(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
  }

  function markXyzrenderElementSelected(element) {
    ensureXyzrenderOriginalStyle(element);
    element.classList.add('buret-xyzrender-svg-selection');
    element.setAttribute('data-buret-xyzrender-selected', 'true');
    applyXyzrenderSelectionEffect(element);
    xyzrenderSelectedElements.add(element);
  }

  function ensureXyzrenderOriginalStyle(element) {
    xyzrenderStyledElements.add(element);
    if (xyzrenderSelectionOriginals.has(element)) return;
    xyzrenderSelectionOriginals.set(element, {
      style: element.getAttribute('style'),
      fill: element.getAttribute('fill'),
      stroke: element.getAttribute('stroke'),
      strokeWidth: element.getAttribute('stroke-width'),
      opacity: element.getAttribute('opacity'),
      display: element.getAttribute('display'),
      visibility: element.getAttribute('visibility'),
      filter: element.getAttribute('filter')
    });
  }

  function restoreXyzrenderOriginalStyle(element) {
    const original = xyzrenderSelectionOriginals.get(element);
    if (!original) return;
    removeXyzrenderSelectionHalo(element);
    restoreNullableAttribute(element, 'style', original.style);
    restoreNullableAttribute(element, 'fill', original.fill);
    restoreNullableAttribute(element, 'stroke', original.stroke);
    restoreNullableAttribute(element, 'stroke-width', original.strokeWidth);
    restoreNullableAttribute(element, 'opacity', original.opacity);
    restoreNullableAttribute(element, 'display', original.display);
    restoreNullableAttribute(element, 'visibility', original.visibility);
    restoreNullableAttribute(element, 'filter', original.filter);
  }

  function restoreNullableAttribute(element, name, value) {
    if (value == null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  }

  function syncXyzrenderSelectionEffects() {
    for (const element of Array.from(xyzrenderSelectedElements)) {
      if (!element.isConnected || element.getAttribute('data-buret-xyzrender-selected') !== 'true') continue;
      applyXyzrenderSelectionEffect(element);
    }
  }

  function applyXyzrenderSelectionEffect(element) {
    const svg = element?.ownerSVGElement;
    if (!svg) return;
    const filterId = ensureXyzrenderSelectionFilter(svg);
    if (filterId) element.setAttribute('filter', `url(#${filterId})`);
    applyXyzrenderSelectionHalo(element);
  }

  function applyXyzrenderSelectionHalo(element) {
    if (!element?.ownerSVGElement || typeof element.cloneNode !== 'function') return;
    if (element.getAttribute('data-buret-xyzrender-selection-halo') === 'true') return;
    const parent = element.parentNode;
    if (!parent) return;
    const existing = xyzrenderSelectionHaloClones.get(element);
    if (existing?.isConnected) return;
    if (existing) xyzrenderSelectionHaloClones.delete(element);
    const halo = element.cloneNode(true);
    halo.removeAttribute('id');
    halo.classList?.remove('buret-xyzrender-svg-selection');
    halo.removeAttribute('data-buret-xyzrender-selected');
    halo.setAttribute('data-buret-xyzrender-selection-halo', 'true');
    halo.setAttribute('aria-hidden', 'true');
    halo.setAttribute('fill', 'none');
    halo.setAttribute('stroke', '#b45cff');
    halo.setAttribute('stroke-opacity', '0.72');
    halo.setAttribute('stroke-width', xyzrenderSelectionHaloStrokeWidth(element));
    halo.setAttribute('stroke-linecap', 'round');
    halo.setAttribute('stroke-linejoin', 'round');
    halo.style.pointerEvents = 'none';
    halo.style.filter = 'none';
    halo.style.opacity = '1';
    parent.insertBefore(halo, element);
    xyzrenderSelectionHaloClones.set(element, halo);
  }

  function removeXyzrenderSelectionHalo(element) {
    const halo = xyzrenderSelectionHaloClones.get(element);
    if (halo?.isConnected) halo.remove();
    xyzrenderSelectionHaloClones.delete(element);
  }

  function xyzrenderSelectionHaloStrokeWidth(element) {
    const raw = Number.parseFloat(element.getAttribute('stroke-width') || '');
    if (Number.isFinite(raw) && raw > 0) return String(Math.max(raw + 2, raw * 1.65));
    const tag = element.tagName?.toLowerCase?.();
    if (tag === 'circle' || tag === 'ellipse') return '3';
    return '4';
  }

  function ensureXyzrenderSelectionFilter(svg) {
    let filterId = xyzrenderSelectionFilterIds.get(svg);
    if (filterId && svg.querySelector(`#${filterId}`)) return filterId;
    filterId = `buret-xyzrender-selection-glow-${++xyzrenderSelectionFilterSerial}`;
    xyzrenderSelectionFilterIds.set(svg, filterId);
    let defs = svg.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      svg.insertBefore(defs, svg.firstChild);
    }
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.setAttribute('id', filterId);
    filter.setAttribute('x', '-80%');
    filter.setAttribute('y', '-80%');
    filter.setAttribute('width', '260%');
    filter.setAttribute('height', '260%');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    const halo = createSvgFilterElement('feDropShadow', {
      in: 'SourceGraphic',
      dx: '0',
      dy: '0',
      stdDeviation: '2.8',
      'flood-color': '#b45cff',
      'flood-opacity': '0.22',
      result: 'selectionHalo'
    });
    const glow = createSvgFilterElement('feDropShadow', {
      in: 'SourceGraphic',
      dx: '0',
      dy: '0',
      stdDeviation: '1.1',
      'flood-color': '#b45cff',
      'flood-opacity': '0.55',
      result: 'selectionGlow'
    });
    const merge = createSvgFilterElement('feMerge');
    merge.append(
      createSvgFilterElement('feMergeNode', { in: 'selectionHalo' }),
      createSvgFilterElement('feMergeNode', { in: 'selectionGlow' }),
      createSvgFilterElement('feMergeNode', { in: 'SourceGraphic' })
    );
    filter.append(halo, glow, merge);
    defs.appendChild(filter);
    return filterId;
  }

  function createSvgFilterElement(name, attributes = {}) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
  }

  function xyzrenderGraphicElements(item) {
    const svg = item?.querySelector?.('.buret-xyzrender-sheet-item-body svg');
    if (!svg) return [];
    return xyzrenderGraphicElementsFromSvg(svg);
  }

  function xyzrenderGraphicElementsFromSvg(svg) {
    if (!svg?.querySelectorAll) return [];
    return Array.from(svg.querySelectorAll('path,circle,ellipse,rect,line,polyline,polygon,text'))
      .filter(isXyzrenderSelectableGraphicElement);
  }

  function isXyzrenderSelectableGraphicElement(element) {
    if (!element) return false;
    if (element.getAttribute('data-buret-xyzrender-selection-halo') === 'true') return false;
    const tag = element.tagName?.toLowerCase?.();
    if (tag !== 'rect') return true;
    const stroke = element.getAttribute('stroke');
    const width = element.getAttribute('width');
    const height = element.getAttribute('height');
    return !(width === '100%' && height === '100%' && (!stroke || stroke === 'none'));
  }

  function xyzrenderElementSnapshot(element) {
    return {
      element,
      style: element.getAttribute('style'),
      fill: element.getAttribute('fill'),
      stroke: element.getAttribute('stroke'),
      strokeWidth: element.getAttribute('stroke-width'),
      opacity: element.getAttribute('opacity'),
      display: element.getAttribute('display'),
      visibility: element.getAttribute('visibility'),
      filter: element.getAttribute('filter'),
      selected: element.getAttribute('data-buret-xyzrender-selected') === 'true',
      selectionClass: element.classList.contains('buret-xyzrender-svg-selection')
    };
  }

  function captureXyzrenderActionSnapshot(item, label = 'xyzrender action') {
    const body = item?.querySelector?.('.buret-xyzrender-sheet-item-body');
    return {
      item,
      label,
      bodyHtml: body ? body.innerHTML : null,
      regions: item?.dataset?.buretXyzrenderRegions || null,
      preset: item?.dataset?.buretXyzrenderPreset || null,
      elements: xyzrenderGraphicElements(item).map(xyzrenderElementSnapshot)
    };
  }

  function restoreXyzrenderActionSnapshot(snapshot) {
    if (!snapshot) return;
    const body = snapshot.item?.querySelector?.('.buret-xyzrender-sheet-item-body');
    if (body && typeof snapshot.bodyHtml === 'string') {
      body.innerHTML = snapshot.bodyHtml;
      restoreNullableAttribute(snapshot.item, 'data-buret-xyzrender-regions', snapshot.regions);
      restoreNullableAttribute(snapshot.item, 'data-buret-xyzrender-preset', snapshot.preset);
      body.querySelectorAll('[data-buret-xyzrender-selected="true"]').forEach(element => {
        xyzrenderSelectedElements.add(element);
        ensureXyzrenderOriginalStyle(element);
        applyXyzrenderSelectionEffect(element);
      });
      cleanupXyzrenderSelectionSet();
      return;
    }
    for (const entry of snapshot.elements || []) {
      const element = entry.element;
      if (!element?.isConnected) continue;
      restoreNullableAttribute(element, 'style', entry.style);
      restoreNullableAttribute(element, 'fill', entry.fill);
      restoreNullableAttribute(element, 'stroke', entry.stroke);
      restoreNullableAttribute(element, 'stroke-width', entry.strokeWidth);
      restoreNullableAttribute(element, 'opacity', entry.opacity);
      restoreNullableAttribute(element, 'display', entry.display);
      restoreNullableAttribute(element, 'visibility', entry.visibility);
      restoreNullableAttribute(element, 'filter', entry.filter);
      element.classList.toggle('buret-xyzrender-svg-selection', entry.selectionClass);
      if (entry.selected) {
        element.setAttribute('data-buret-xyzrender-selected', 'true');
        applyXyzrenderSelectionEffect(element);
        xyzrenderSelectedElements.add(element);
      } else {
        element.removeAttribute('data-buret-xyzrender-selected');
        xyzrenderSelectedElements.delete(element);
      }
      ensureXyzrenderOriginalStyle(element);
    }
    cleanupXyzrenderSelectionSet();
  }

  function installXyzrenderSystemHistory() {
    if (xyzrenderSystemHistoryInstalled) return;
    xyzrenderSystemHistoryInstalled = true;
    window.addEventListener('popstate', event => {
      const nextIndex = xyzrenderSystemHistoryIndexFromState(event.state);
      if (nextIndex < xyzrenderSystemHistoryIndex) {
        undoXyzrenderLastAction({ fromSystemHistory: true });
      } else if (nextIndex > xyzrenderSystemHistoryIndex) {
        redoXyzrenderLastAction({ fromSystemHistory: true });
      }
      xyzrenderSystemHistoryIndex = nextIndex;
    });
  }

  function xyzrenderSystemHistoryIndexFromState(state) {
    const value = state && typeof state === 'object' ? Number(state[XYZRENDER_HISTORY_STATE_KEY]) : 0;
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  }

  function pushXyzrenderSystemHistoryEntry() {
    installXyzrenderSystemHistory();
    try {
      const current = history.state && typeof history.state === 'object' ? history.state : {};
      const nextIndex = xyzrenderSystemHistoryIndex + 1;
      history.pushState({ ...current, [XYZRENDER_HISTORY_STATE_KEY]: nextIndex }, '', window.location.href);
      xyzrenderSystemHistoryIndex = nextIndex;
    } catch (_) {}
  }

  function goBackXyzrenderSystemHistory() {
    installXyzrenderSystemHistory();
    if (xyzrenderSystemHistoryIndex > 0) {
      history.back();
      return;
    }
    undoXyzrenderLastAction({ fromSystemHistory: true });
  }

  function goForwardXyzrenderSystemHistory() {
    installXyzrenderSystemHistory();
    history.forward();
  }

  function pushXyzrenderActionHistory(item, label) {
    const snapshot = captureXyzrenderActionSnapshot(item, label);
    if (!snapshot.elements.length) return;
    pushXyzrenderSystemHistoryEntry();
    xyzrenderActionUndoStack.push(snapshot);
    if (xyzrenderActionUndoStack.length > 50) xyzrenderActionUndoStack.shift();
    xyzrenderActionRedoStack.length = 0;
  }

  function undoXyzrenderLastAction(options = {}) {
    const snapshot = xyzrenderActionUndoStack.pop();
    if (!snapshot) {
      setStatus('[web] Nothing to undo.');
      setTimeout(hideStatus, 900);
      return false;
    }
    xyzrenderActionRedoStack.push(captureXyzrenderActionSnapshot(snapshot.item, snapshot.label));
    restoreXyzrenderActionSnapshot(snapshot);
    setStatus(`[web] Undid xyzrender ${snapshot.label}.`);
    setTimeout(hideStatus, 900);
    if (!options.fromSystemHistory) goBackXyzrenderSystemHistory();
    return true;
  }

  function redoXyzrenderLastAction(options = {}) {
    const snapshot = xyzrenderActionRedoStack.pop();
    if (!snapshot) {
      setStatus('[web] Nothing to redo.');
      setTimeout(hideStatus, 900);
      return false;
    }
    xyzrenderActionUndoStack.push(captureXyzrenderActionSnapshot(snapshot.item, snapshot.label));
    restoreXyzrenderActionSnapshot(snapshot);
    setStatus(`[web] Redid xyzrender ${snapshot.label}.`);
    setTimeout(hideStatus, 900);
    if (!options.fromSystemHistory) goForwardXyzrenderSystemHistory();
    return true;
  }

  function hasHiddenXyzrenderElements(item) {
    return xyzrenderGraphicElements(item).some(element => {
      const style = window.getComputedStyle(element);
      return element.getAttribute('display') === 'none'
        || element.getAttribute('visibility') === 'hidden'
        || style.display === 'none'
        || style.visibility === 'hidden';
    });
  }

  function showHiddenXyzrenderElements(item) {
    let shown = 0;
    for (const element of xyzrenderGraphicElements(item)) {
      const style = window.getComputedStyle(element);
      const hidden = element.getAttribute('display') === 'none'
        || element.getAttribute('visibility') === 'hidden'
        || style.display === 'none'
        || style.visibility === 'hidden';
      if (!hidden) continue;
      if (xyzrenderSelectionOriginals.has(element)) restoreXyzrenderOriginalStyle(element);
      else {
        element.removeAttribute('display');
        element.removeAttribute('visibility');
      }
      shown += 1;
    }
    setStatus(`[web] Restored ${shown} hidden xyzrender graphic${shown === 1 ? '' : 's'}.`);
    setTimeout(hideStatus, 900);
  }

  function hasXyzrenderSelection() {
    cleanupXyzrenderSelectionSet();
    return xyzrenderSelectedElements.size > 0;
  }

  function xyzrenderFirstSelectionItem() {
    const groups = xyzrenderSelectionGroups();
    return groups.length ? groups[0].item : null;
  }

  function xyzrenderSelectionGroups() {
    cleanupXyzrenderSelectionSet();
    const groups = [];
    const indexes = new Map();
    for (const element of Array.from(xyzrenderSelectedElements)) {
      if (!element.isConnected) continue;
      const item = element.closest('.buret-xyzrender-sheet-item');
      if (!item) continue;
      let index = indexes.get(item);
      if (index == null) {
        index = groups.length;
        indexes.set(item, index);
        groups.push({ item, elements: [] });
      }
      groups[index].elements.push(element);
    }
    return groups;
  }

  function cleanupXyzrenderSelectionSet() {
    for (const element of Array.from(xyzrenderSelectedElements)) {
      if (!element.isConnected) xyzrenderSelectedElements.delete(element);
    }
    updateXyzrenderSelectionRoots();
  }

  function updateXyzrenderSelectionRoots() {
    document.querySelectorAll('.buret-xyzrender-sheet-item').forEach(item => {
      item.classList.toggle('has-xyzrender-selection', !!item.querySelector('[data-buret-xyzrender-selected="true"]'));
    });
    syncXyzrenderSelectionEffects();
  }

  function clearXyzrenderSelection() {
    for (const element of Array.from(xyzrenderSelectedElements)) {
      const original = xyzrenderSelectionOriginals.get(element);
      removeXyzrenderSelectionHalo(element);
      restoreNullableAttribute(element, 'filter', original?.filter ?? null);
      element.classList.remove('buret-xyzrender-svg-selection');
      element.removeAttribute('data-buret-xyzrender-selected');
    }
    xyzrenderSelectedElements.clear();
    updateXyzrenderSelectionRoots();
  }

  function resetXyzrenderSelectionStyles() {
    for (const element of Array.from(xyzrenderStyledElements)) {
      if (element.isConnected) restoreXyzrenderOriginalStyle(element);
      else xyzrenderStyledElements.delete(element);
    }
    updateXyzrenderSelectionRoots();
  }

  function dimUnselectedXyzrenderElements(item) {
    const selected = new Set(Array.from(xyzrenderSelectedElements).filter(element => element.isConnected));
    let dimmed = 0;
    for (const element of xyzrenderSelectableElements(item)) {
      ensureXyzrenderOriginalStyle(element);
      if (selected.has(element)) {
        const original = xyzrenderSelectionOriginals.get(element);
        restoreNullableAttribute(element, 'opacity', original?.opacity ?? null);
        continue;
      }
      element.setAttribute('opacity', '0.18');
      dimmed += 1;
    }
    setStatus(`[web] Dimmed ${dimmed} unselected xyzrender graphic${dimmed === 1 ? '' : 's'}.`);
    setTimeout(hideStatus, 900);
  }

  function hideSelectedXyzrenderElements() {
    const elements = selectedXyzrenderElementsForHide();
    if (!elements.length) {
      clearXyzrenderSelection();
      return;
    }
    for (const element of elements) {
      ensureXyzrenderOriginalStyle(element);
      element.setAttribute('display', 'none');
    }
    clearXyzrenderSelection();
    setStatus(`[web] Hid ${elements.length} selected xyzrender graphic${elements.length === 1 ? '' : 's'}.`);
    setTimeout(hideStatus, 900);
  }

  function selectedXyzrenderElementsForHide() {
    const elements = new Set();
    const groups = xyzrenderSelectionGroups();
    for (const group of groups) {
      const atomSelector = xyzrenderAtomSelectorForElements(group.item, group.elements);
      const selectedAtoms = xyzrenderAtomSetFromSelector(atomSelector);
      if (selectedAtoms.size === 0) {
        group.elements.filter(element => element.isConnected).forEach(element => elements.add(element));
        continue;
      }
      for (const element of xyzrenderSelectableElements(group.item)) {
        const elementAtoms = xyzrenderAtomSetFromSelector(xyzrenderAtomSelectorForElements(group.item, [element]));
        if (xyzrenderAtomSetsIntersect(selectedAtoms, elementAtoms)) elements.add(element);
      }
    }
    return Array.from(elements).filter(element => element.isConnected);
  }

  function applyXyzrenderSelectionControls(controls) {
    const elements = Array.from(xyzrenderSelectedElements).filter(element => element.isConnected);
    if (!elements.length) {
      clearXyzrenderSelection();
      return;
    }
    const color = nonEmptyText(controls?.molColor);
    const opacity = Number.isFinite(Number(controls?.vdwOpacity))
      ? Number(controls.vdwOpacity)
      : (Number.isFinite(Number(controls?.fieldOpacity)) ? Number(controls.fieldOpacity) : null);
    const strokeWidth = positiveNumberOrNull(controls?.bondWidth);
    const hidden = controls?.hideBonds === true;
    for (const element of elements) {
      ensureXyzrenderOriginalStyle(element);
      if (hidden) {
        element.setAttribute('display', 'none');
        continue;
      }
      element.removeAttribute('display');
      element.removeAttribute('visibility');
      if (color) applySvgElementColor(element, color);
      if (opacity != null) element.setAttribute('opacity', String(Math.max(0, Math.min(1, opacity))));
      if (strokeWidth != null && svgElementHasStroke(element)) element.setAttribute('stroke-width', String(strokeWidth));
    }
    setStatus(`[web] Applied xyzrender settings to ${elements.length} selected graphic${elements.length === 1 ? '' : 's'}.`);
    setTimeout(hideStatus, 900);
  }

  function applySvgElementColor(element, color) {
    const tag = element.tagName.toLowerCase();
    const fill = element.getAttribute('fill');
    const stroke = element.getAttribute('stroke');
    const style = window.getComputedStyle(element);
    if (tag === 'line' || tag === 'polyline') {
      element.setAttribute('stroke', color);
      return;
    }
    if (fill == null || fill.toLowerCase() !== 'none') {
      const computedFill = String(style.fill || '').toLowerCase();
      if (computedFill !== 'none') element.setAttribute('fill', color);
    }
    if (stroke == null || stroke.toLowerCase() !== 'none') {
      const computedStroke = String(style.stroke || '').toLowerCase();
      if (computedStroke !== 'none') element.setAttribute('stroke', color);
    }
  }

  function svgElementHasStroke(element) {
    const tag = element.tagName.toLowerCase();
    if (tag === 'line' || tag === 'polyline' || tag === 'path' || tag === 'polygon') return true;
    const stroke = element.getAttribute('stroke') || window.getComputedStyle(element).stroke;
    return !!stroke && String(stroke).toLowerCase() !== 'none';
  }

  function showXyzrenderSelectionContextMenu(item, bounds) {
    const x = Math.min(bounds.right, Math.max(bounds.left, bounds.left + bounds.width / 2));
    const y = Math.min(bounds.bottom, Math.max(bounds.top, bounds.top + bounds.height / 2));
    showXyzrenderSheetContextMenu({
      preventDefault() {},
      stopPropagation() {},
      clientX: x,
      clientY: y
    }, item);
  }

  function molstarCurrentSelectionLociList() {
    return molstarContextStructures()
      .map(structure => molstarContextSelectionLociForStructure(structure))
      .filter(loci => loci && !molstarLociIsEmpty(loci));
  }

  function restoreMolstarSelectionLociList(lociList) {
    if (!Array.isArray(lociList) || !lociList.length) return false;
    const selects = activeViewer?.plugin?.managers?.interactivity?.lociSelects;
    const selection = activeViewer?.plugin?.managers?.structure?.selection;
    const canSelect = typeof selects?.select === 'function';
    const canSelectStructure = typeof selection?.fromLoci === 'function';
    if (!canSelect && !canSelectStructure) return false;
    selects?.deselectAll?.();
    selection?.clear?.();
    for (const loci of lociList) {
      if (!loci || molstarLociIsEmpty(loci)) continue;
      if (canSelect) selects.select({ loci }, false);
      if (canSelectStructure) selection.fromLoci('add', loci, false);
    }
    scheduleMolstarSelectedMoleculePreview();
    return true;
  }

  function beginMolstarEmptyClickSelectionPreserve(event) {
    if (molstarLassoEnabled || molstarLassoStroke || event.button !== 0 || !isMolstarContextMenuTarget(event.target)) return;
    const lociList = molstarCurrentSelectionLociList();
    if (!lociList.length) return;
    if (molstarContextPickFromEvent(event, molstarContextTouchPickOptions(event))) return;
    molstarSelectionPreserveClick = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lociList
    };
  }

  function finishMolstarEmptyClickSelectionPreserve(event) {
    const preserve = molstarSelectionPreserveClick;
    if (!preserve || event.pointerId !== preserve.pointerId) return;
    molstarSelectionPreserveClick = null;
    const moved = Math.hypot(event.clientX - preserve.startX, event.clientY - preserve.startY) > MOLSTAR_CONTEXT_MENU_DRAG_THRESHOLD_PX;
    if (moved) return;
    setTimeout(() => {
      if (molstarCurrentSelectionLociList().length) return;
      restoreMolstarSelectionLociList(preserve.lociList);
    }, 0);
  }

  function molstarContextStructures() {
    const hierarchy = activeViewer?.plugin?.managers?.structure?.hierarchy;
    return Array.isArray(hierarchy?.current?.structures) ? hierarchy.current.structures : [];
  }

  function molstarContextPickedStructureInfo(structures) {
    const pickedStructure = molstarContextMenuPick?.loci?.structure || null;
    if (pickedStructure) {
      const index = structures.findIndex(structure => {
        const data = molstarStructureFromRef(structure);
        return data === pickedStructure || data?.root === pickedStructure?.root;
      });
      if (index >= 0) return { index, structure: structures[index] };
    }
    for (let index = 0; index < structures.length; index += 1) {
      if (molstarContextSelectionLociForStructure(structures[index])) {
        return { index, structure: structures[index] };
      }
    }
    return null;
  }

  function currentDockingPoseSource(prepared) {
    const poses = Array.isArray(prepared?.poses) ? prepared.poses : [];
    if (!poses.length) return null;
    const position = prepared?.nativeTrajectoryControls ? readNativeTrajectoryPosition(poses.length) : null;
    const index = position
      ? position.index
      : Math.max(0, Math.min(poses.length - 1, Number(prepared?.activePose || 0)));
    return poses[index] || poses[0] || null;
  }

  const MOLSTAR_CONTEXT_STANDARD_RESIDUES = new Set([
    'ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'GLN', 'GLU', 'GLY', 'HIS', 'ILE',
    'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER', 'THR', 'TRP', 'TYR', 'VAL',
    'SEC', 'PYL', 'ASX', 'GLX', 'UNK',
    'A', 'C', 'G', 'T', 'U', 'DA', 'DC', 'DG', 'DT', 'DU', 'I', 'DI',
    'PSU', '5MC', 'OMC', 'OMG', '1MA', '2MG', 'M2G', '7MG'
  ]);
  const MOLSTAR_CONTEXT_WATER = new Set(['HOH', 'WAT', 'H2O', 'DOD']);
  const MOLSTAR_CONTEXT_COMMON_IONS = new Set([
    'NA', 'K', 'CL', 'CA', 'MG', 'ZN', 'FE', 'MN', 'CU', 'CO', 'NI', 'CD',
    'HG', 'BR', 'IOD', 'I', 'F', 'LI', 'CS', 'RB', 'SR', 'BA', 'AL', 'AG',
    'AU', 'PT', 'PB', 'SE', 'SO4', 'PO4', 'NO3'
  ]);

  function molstarContextValueAt(column, index) {
    if (index == null || index < 0 || !column) return undefined;
    try {
      if (typeof column.value === 'function') return molstarContextNormalizeMissing(column.value(index));
      if (Array.isArray(column) || ArrayBuffer.isView(column)) return molstarContextNormalizeMissing(column[index]);
      if (column.array) return molstarContextNormalizeMissing(column.array[index]);
      if (column.data) return molstarContextNormalizeMissing(column.data[index]);
      return molstarContextNormalizeMissing(column[index]);
    } catch (_) {
      return undefined;
    }
  }

  function molstarContextNormalizeMissing(value) {
    if (value == null || value === '?' || value === '.') return undefined;
    return value;
  }

  function molstarContextNumberOrUndefined(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }

  function molstarContextSegmentIndex(segment, atomIndex) {
    const value = molstarContextValueAt(segment?.index, atomIndex);
    return Number.isInteger(value) ? value : molstarContextNumberOrUndefined(value);
  }

  function molstarContextEntityType(model, labelEntityId) {
    if (!model || labelEntityId == null) return undefined;
    try {
      const entities = model.entities;
      let index = typeof entities?.getEntityIndex === 'function' ? entities.getEntityIndex(labelEntityId) : undefined;
      if (index == null && entities?.data?.id) {
        const rowCount = entities.data._rowCount || entities.data.rowCount || 0;
        for (let i = 0; i < rowCount; i++) {
          if (String(molstarContextValueAt(entities.data.id, i)) === String(labelEntityId)) {
            index = i;
            break;
          }
        }
      }
      return molstarContextValueAt(entities?.data?.type, index);
    } catch (_) {
      return undefined;
    }
  }

  function firstMolstarOrderedSetIndex(indices) {
    if (indices == null) return undefined;
    const orderedSet = molstarExportLib()?.OrderedSet || molstarRuntime()?.OrderedSet;
    if (orderedSet) {
      try {
        const value = typeof orderedSet.start === 'function'
          ? orderedSet.start(indices)
          : typeof orderedSet.getAt === 'function'
            ? orderedSet.getAt(indices, 0)
            : undefined;
        const index = molstarContextNumberOrUndefined(value);
        if (index != null) return index;
      } catch (_) {}
    }
    if (Number.isInteger(indices)) return indices;
    if (typeof indices === 'number' && Number.isFinite(indices)) {
      try {
        const buffer = new ArrayBuffer(8);
        const view = new DataView(buffer);
        view.setFloat64(0, indices, true);
        const first = view.getInt32(0, true);
        const second = view.getInt32(4, true);
        const candidates = [first, second].filter(value => Number.isInteger(value) && value >= 0);
        if (candidates.length) return Math.min(...candidates);
      } catch (_) {}
    }
    if (Array.isArray(indices) || ArrayBuffer.isView(indices)) return molstarContextNumberOrUndefined(indices[0]);
    if (typeof indices?.[Symbol.iterator] === 'function') {
      for (const value of indices) return molstarContextNumberOrUndefined(value);
    }
    if (indices.array) {
      const offset = Number.isInteger(indices.start) ? indices.start : 0;
      return molstarContextNumberOrUndefined(indices.array[offset] ?? indices.array[0]);
    }
    for (const key of ['min', 'start', 'from', 'begin']) {
      const value = molstarContextNumberOrUndefined(indices[key]);
      if (value != null) return value;
    }
    return undefined;
  }

  function molstarContextAtomFromBondLoci(loci) {
    const bonds = Array.isArray(loci?.bonds) ? loci.bonds : [];
    let firstAtom = null;
    for (const bond of bonds) {
      const candidates = [
        [bond?.aUnit, bond?.aIndex],
        [bond?.bUnit, bond?.bIndex]
      ];
      for (const [unit, unitIndex] of candidates) {
        if (!unit?.model) continue;
        const atomIndex = molstarContextNumberOrUndefined(unit.elements?.[unitIndex] ?? unitIndex);
        const atom = molstarContextAtomFromModelIndex(unit.model, atomIndex);
        if (!firstAtom) firstAtom = atom;
        const scope = molstarContextScopeForAtom(atom);
        if (scope === 'ligand' || scope === 'water' || scope === 'ion') return atom;
      }
    }
    return firstAtom;
  }

  function molstarContextAtomFromModelIndex(model, atomIndex) {
    const ah = model?.atomicHierarchy;
    if (!ah || atomIndex == null) return null;
    const residueIndex = molstarContextSegmentIndex(ah.residueAtomSegments, atomIndex);
    const chainIndex = molstarContextSegmentIndex(ah.chainAtomSegments, atomIndex);
    const atoms = ah.atoms || {};
    const residues = ah.residues || {};
    const chains = ah.chains || {};
    const labelEntityId = molstarContextValueAt(chains.label_entity_id, chainIndex);
    const labelCompId = molstarContextValueAt(residues.label_comp_id, residueIndex);
    const authCompId = molstarContextValueAt(residues.auth_comp_id, residueIndex) || labelCompId;
    const entityType = molstarContextEntityType(model, labelEntityId);
    return {
      model,
      atomIndex,
      residueIndex,
      chainIndex,
      label_entity_id: labelEntityId,
      label_asym_id: molstarContextValueAt(chains.label_asym_id, chainIndex),
      auth_asym_id: molstarContextValueAt(chains.auth_asym_id, chainIndex),
      label_seq_id: molstarContextNumberOrUndefined(molstarContextValueAt(residues.label_seq_id, residueIndex)),
      auth_seq_id: molstarContextNumberOrUndefined(molstarContextValueAt(residues.auth_seq_id, residueIndex)),
      label_comp_id: labelCompId,
      auth_comp_id: authCompId,
      label_atom_id: molstarContextValueAt(atoms.label_atom_id, atomIndex),
      auth_atom_id: molstarContextValueAt(atoms.auth_atom_id, atomIndex),
      entityType
    };
  }

  function molstarContextAtomFromLoci(loci) {
    if (loci?.kind === 'bond-loci') return molstarContextAtomFromBondLoci(loci);
    if (loci?.kind === 'structure-loci') {
      const structure = loci.structure;
      let firstAtom = null;
      for (const unit of Array.isArray(structure?.units) ? structure.units : []) {
        if (!unit?.model || !unit.elements?.length) continue;
        const atomIndex = molstarContextNumberOrUndefined(unit.elements[0]);
        const atom = molstarContextAtomFromModelIndex(unit.model, atomIndex);
        if (!firstAtom) firstAtom = atom;
        const scope = molstarContextScopeForAtom(atom);
        if (scope === 'ligand' || scope === 'water' || scope === 'ion') return atom;
      }
      return firstAtom;
    }
    const element = Array.isArray(loci?.elements) ? loci.elements[0] : null;
    const unit = element?.unit;
    const model = unit?.model;
    if (!unit || !model) return null;
    const elementIndex = firstMolstarOrderedSetIndex(element.indices);
    if (elementIndex == null) return null;
    const atomIndex = molstarContextNumberOrUndefined(unit.elements?.[elementIndex] ?? elementIndex);
    if (atomIndex == null) return null;
    return molstarContextAtomFromModelIndex(model, atomIndex);
  }

  function molstarContextSelectionLociForStructure(structureRef) {
    const structure = molstarStructureFromRef(structureRef) || structureRef;
    if (!structure) return null;
    const selection = activeViewer?.plugin?.managers?.structure?.selection;
    if (typeof selection?.getLoci !== 'function') return null;
    try {
      const loci = selection.getLoci(structure);
      return loci && !molstarLociIsEmpty(loci) ? loci : null;
    } catch (_) {
      return null;
    }
  }

  function molstarContextNormalizeLoci(loci, granularity = 'residue') {
    if (!loci || molstarLociIsEmpty(loci)) return loci;
    const lociApi = molstarExportLib()?.Loci || molstarRuntime()?.Loci;
    if (typeof lociApi?.normalize !== 'function') return loci;
    try {
      return lociApi.normalize(loci, granularity, true);
    } catch (_) {
      return loci;
    }
  }

  function molstarContextAtomLociForStructure(structure, atom) {
    if (!structure || !atom?.model || atom.atomIndex == null) return null;
    for (const unit of Array.isArray(structure.units) ? structure.units : []) {
      if (unit?.model !== atom.model || !unit.elements?.length) continue;
      for (let i = 0; i < unit.elements.length; i++) {
        if (molstarContextNumberOrUndefined(unit.elements[i]) === atom.atomIndex) {
          return { kind: 'element-loci', structure, elements: [{ unit, indices: [i] }] };
        }
      }
    }
    return null;
  }

  function molstarContextResidueAtomLociForStructure(structure, atom) {
    if (!structure || !atom?.model || atom.residueIndex == null) return null;
    const elements = [];
    for (const unit of Array.isArray(structure.units) ? structure.units : []) {
      if (unit?.model !== atom.model || !unit.elements?.length) continue;
      const indices = [];
      for (let i = 0; i < unit.elements.length; i++) {
        const atomIndex = molstarContextNumberOrUndefined(unit.elements[i]);
        const current = molstarContextAtomFromModelIndex(unit.model, atomIndex);
        if (current?.residueIndex === atom.residueIndex) indices.push(i);
      }
      if (indices.length) elements.push({ unit, indices });
    }
    return elements.length ? { kind: 'element-loci', structure, elements } : null;
  }

  function molstarContextSelectionLoci(target) {
    const scope = target?.scope;
    if ((scope === 'ligand' || scope === 'water' || scope === 'ion') && target?.atom) {
      const structure = molstarStructureFromRef(target.structure) || target?.loci?.structure;
      return molstarContextResidueAtomLociForStructure(structure, target.atom) || target?.loci || molstarContextMenuPick?.loci;
    }
    return target?.loci || molstarContextMenuPick?.loci;
  }

  function molstarContextLociIndexMatchesAtom(unit, index, atom) {
    if (!unit?.model || !atom?.model || unit.model !== atom.model || atom.atomIndex == null) return false;
    const atomIndex = molstarContextNumberOrUndefined(unit.elements?.[index] ?? index);
    return atomIndex === atom.atomIndex;
  }

  function molstarContextOrderedSetSome(indices, predicate) {
    if (indices == null || typeof predicate !== 'function') return false;
    const single = molstarContextNumberOrUndefined(indices);
    if (single != null) return predicate(single);
    if (Array.isArray(indices)) return indices.some(index => predicate(index));
    const orderedSet = molstarExportLib()?.OrderedSet || molstarRuntime()?.OrderedSet;
    if (typeof orderedSet?.forEach === 'function') {
      let found = false;
      try {
        orderedSet.forEach(indices, index => {
          if (!found && predicate(index)) found = true;
        });
        if (found) return true;
      } catch (_) {}
    }
    if (typeof orderedSet?.size === 'function' && typeof orderedSet?.getAt === 'function') {
      try {
        const size = orderedSet.size(indices);
        for (let i = 0; i < size; i++) {
          if (predicate(orderedSet.getAt(indices, i))) return true;
        }
      } catch (_) {}
    }
    if (ArrayBuffer.isView(indices)) {
      for (const index of indices) {
        if (predicate(index)) return true;
      }
      return false;
    }
    if (typeof indices?.[Symbol.iterator] === 'function') {
      for (const index of indices) {
        if (predicate(index)) return true;
      }
      return false;
    }
    if (indices.array) {
      const start = Number.isInteger(indices.start) ? indices.start : 0;
      const end = Number.isInteger(indices.end) ? indices.end : indices.array.length;
      for (let i = start; i < end; i++) {
        if (predicate(indices.array[i])) return true;
      }
      return false;
    }
    return false;
  }

  function molstarContextLociContainsAtom(loci, atom) {
    if (!loci || !atom) return false;
    if (loci.kind === 'structure-loci') {
      return Array.isArray(loci.structure?.units) && loci.structure.units.some(unit => (
        unit?.model === atom.model
        && Array.isArray(unit.elements)
        && unit.elements.some(atomIndex => molstarContextNumberOrUndefined(atomIndex) === atom.atomIndex)
      ));
    }
    if (loci.kind === 'bond-loci') {
      return Array.isArray(loci.bonds) && loci.bonds.some(bond => (
        molstarContextLociIndexMatchesAtom(bond?.aUnit, bond?.aIndex, atom)
        || molstarContextLociIndexMatchesAtom(bond?.bUnit, bond?.bIndex, atom)
      ));
    }
    if (loci.kind !== 'element-loci' || !Array.isArray(loci.elements)) return false;
    return loci.elements.some(element => (
      element?.unit?.model === atom.model
      && molstarContextOrderedSetSome(element.indices, index => molstarContextLociIndexMatchesAtom(element.unit, index, atom))
    ));
  }

  function molstarContextResolvedLoci(targetStructure) {
    const structure = molstarStructureFromRef(targetStructure) || targetStructure;
    const pickedLoci = molstarContextMenuPick?.loci || null;
    const pickedAtom = molstarContextAtomFromLoci(pickedLoci);
    const selectionLoci = molstarContextSelectionLociForStructure(targetStructure);
    const selectedAtom = molstarContextAtomFromLoci(selectionLoci);
    if ((molstarContextMenuMode !== 'atom' || !pickedAtom) && selectedAtom && (!pickedAtom || molstarContextLociContainsAtom(selectionLoci, pickedAtom))) return {
      loci: selectionLoci,
      atomLoci: pickedAtom
        ? molstarContextAtomLociForStructure(structure || selectionLoci?.structure, pickedAtom)
        : molstarContextAtomLociForStructure(structure || selectionLoci?.structure, selectedAtom),
      atom: pickedAtom || selectedAtom,
      selectionBased: true
    };
    if (pickedAtom) return {
      loci: molstarContextNormalizeLoci(pickedLoci),
      atomLoci: molstarContextAtomLociForStructure(structure || pickedLoci?.structure, pickedAtom),
      atom: pickedAtom
    };
    return { loci: pickedLoci, atomLoci: null, atom: null };
  }

  function molstarContextAtomKind(atom) {
    const comp = String(atom?.label_comp_id || atom?.auth_comp_id || '').toUpperCase();
    const entityType = String(atom?.entityType || '').toLowerCase();
    if (MOLSTAR_CONTEXT_WATER.has(comp) || entityType === 'water') return 'water';
    if (MOLSTAR_CONTEXT_STANDARD_RESIDUES.has(comp)) return entityType === 'polymer' ? 'polymer' : 'biopolymer';
    if (entityType === 'polymer') return 'polymer';
    if (MOLSTAR_CONTEXT_COMMON_IONS.has(comp)) return 'ion';
    if (entityType === 'non-polymer') return 'ligand';
    if (!comp) return 'unknown';
    return 'ligand';
  }

  function molstarContextResidueLabel(atom) {
    const comp = String(atom?.auth_comp_id || atom?.label_comp_id || 'Ligand').trim();
    const chain = String(atom?.auth_asym_id || atom?.label_asym_id || '').trim();
    const seq = atom?.auth_seq_id ?? atom?.label_seq_id ?? '';
    return [comp, chain, seq].filter(value => String(value).trim()).join(' ') || 'Ligand';
  }

  function molstarContextChainLabel(atom) {
    const chain = String(atom?.auth_asym_id || atom?.label_asym_id || atom?.label_entity_id || '').trim();
    return chain ? `chain ${chain}` : 'chain';
  }

  function molstarContextAtomBelongsToChain(model, atomIndex, sourceAtom) {
    if (!model || !sourceAtom || atomIndex == null) return false;
    if (sourceAtom.model && model !== sourceAtom.model) return false;
    const ah = model.atomicHierarchy;
    const chainIndex = molstarContextSegmentIndex(ah?.chainAtomSegments, atomIndex);
    if (chainIndex == null) return false;
    if (sourceAtom.model && sourceAtom.chainIndex != null) return chainIndex === sourceAtom.chainIndex;
    const chains = ah?.chains || {};
    for (const key of ['label_entity_id', 'label_asym_id', 'auth_asym_id']) {
      const sourceValue = sourceAtom[key];
      if (sourceValue == null) continue;
      if (String(molstarContextValueAt(chains[key], chainIndex)) !== String(sourceValue)) return false;
    }
    return true;
  }

  function molstarContextScopeForAtom(atom) {
    const kind = molstarContextAtomKind(atom);
    if (kind === 'water') return 'water';
    if (kind === 'ligand') return 'ligand';
    if (kind === 'ion') return 'ion';
    if (kind === 'polymer' || kind === 'biopolymer') return 'residue';
    return 'selection';
  }

  function molstarContextSourceEntryForActiveConfig() {
    if (!activeConfig || activeConfig.docking) return null;
    const format = normalizeFormat(activeConfig.molstarFormat || activeConfig.format);
    if (format !== 'pdb' && format !== 'pdbqt' && format !== 'sdf') return null;
    try {
      const data = rawStructureData({ ...activeConfig, format, binary: false });
      if (format === 'sdf') {
        const records = splitSdfRecords(data);
        const activePose = Math.max(0, Math.min(records.length - 1, Number(activeMolstarPrepared?.activePose) || 0));
        return {
          data: records[activePose] || data,
          format: 'sdf',
          label: activeConfig.label || 'structure'
        };
      }
      return {
        data: activePdbModelText(data, activeConfig),
        format: 'pdb',
        label: activeConfig.label || 'structure'
      };
    } catch (_) {
      return null;
    }
  }

  function molstarStandaloneMoleculePreviewTarget(config) {
    if (!config || config.docking) return null;
    const format = normalizeFormat(config.sourceExtension || config.molstarFormat || config.format);
    try {
      const text = rawStructureData({ ...config, format, binary: false });
      const modelTexts = (format === 'pdb' || format === 'pdbqt') ? splitPdbModelTexts(text) : [];
      const activeModel = modelTexts.length > 1
        ? readTrajectoryControlIndex(config, { controlLabel: format === 'pdbqt' ? 'Pose' : 'Model' }, modelTexts.length)
        : 0;
      let data = null;
      if (format === 'sdf') {
        const record = splitSdfRecords(text)[0] || String(text || '');
        if (!record.trim()) return null;
        data = `${record.trimEnd()}\n$$$$\n`;
      } else if (format === 'pdb' || format === 'pdbqt' || format === 'mmcif' || format === 'cifCore' || format === 'xyz') {
        const frame = orientationFrameFromConfig({ ...config, format, binary: false });
        data = standalonePreviewSdfFromAtoms(frame?.atoms, config.label || 'Molecule');
        if (!data) return null;
      } else {
        return null;
      }
      const label = modelTexts.length > 1
        ? `${config.label || 'Molecule'} ${format === 'pdbqt' ? 'Pose' : 'Model'} ${activeModel + 1}/${modelTexts.length}`
        : config.label || 'Molecule';
      return {
        label,
        scope: 'ligand',
        ligand: {
          data,
          format: 'sdf',
          label
        }
      };
    } catch (_) {
      return null;
    }
  }

  function standalonePreviewSdfFromAtoms(atoms, label) {
    const normalizedAtoms = Array.isArray(atoms)
      ? atoms.map(atom => ({
          x: Number(atom?.x),
          y: Number(atom?.y),
          z: Number(atom?.z),
          element: cleanElement(atom?.symbol || atom?.element || 'C')
        })).filter(atom => [atom.x, atom.y, atom.z].every(Number.isFinite))
      : [];
    if (!normalizedAtoms.length || normalizedAtoms.length > MOLSTAR_STANDALONE_PREVIEW_MAX_ATOMS) return null;
    const sdfAtoms = normalizedAtoms.map(atom => ({
      x: atom.x,
      y: atom.y,
      z: atom.z,
      element: atom.element,
      tail: ` ${String(atom.element || 'C').padEnd(3, ' ')} 0  0  0  0  0  0  0  0  0  0  0  0`
    }));
    const bonds = inferStandalonePreviewBonds(normalizedAtoms);
    if (bonds.length > 999) return null;
    return [
      String(label || 'Molecule').slice(0, 80),
      '  Burrete',
      'Small structure preview',
      formatSdfCountsLine(sdfAtoms.length, bonds.length),
      ...sdfAtoms.map(atom => formatSdfAtomLine(atom, atom.x, atom.y, atom.z)),
      ...bonds.map(bond => `${padSdfInt(bond.a)}${padSdfInt(bond.b)}  1  0  0  0  0`),
      'M  END',
      '$$$$',
      ''
    ].join('\n');
  }

  function inferStandalonePreviewBonds(atoms) {
    const bonds = [];
    for (let i = 0; i < atoms.length; i += 1) {
      for (let j = i + 1; j < atoms.length; j += 1) {
        const dx = atoms[i].x - atoms[j].x;
        const dy = atoms[i].y - atoms[j].y;
        const dz = atoms[i].z - atoms[j].z;
        const distanceSq = dx * dx + dy * dy + dz * dz;
        if (distanceSq < 0.16) continue;
        const limit = standalonePreviewBondLimit(atoms[i].element, atoms[j].element);
        if (distanceSq <= limit * limit) bonds.push({ a: i + 1, b: j + 1 });
      }
    }
    return bonds;
  }

  function standalonePreviewBondLimit(a, b) {
    const radius = {
      H: 0.31,
      B: 0.85,
      C: 0.76,
      N: 0.71,
      O: 0.66,
      F: 0.57,
      P: 1.07,
      S: 1.05,
      Cl: 1.02,
      Br: 1.20,
      I: 1.39
    };
    return Math.min(2.2, (radius[cleanElement(a)] || 0.76) + (radius[cleanElement(b)] || 0.76) + 0.45);
  }

  function molstarContextLigandSelector(atom) {
    const selector = { kind: 'ligand' };
    for (const key of ['label_entity_id', 'label_asym_id', 'auth_asym_id', 'label_seq_id', 'auth_seq_id', 'label_comp_id', 'auth_comp_id']) {
      if (atom?.[key] != null) selector[key] = atom[key];
    }
    return selector;
  }

  function molstarContextFocusPayload(atom, radiusA = 5) {
    return {
      selector: atom ? molstarContextLigandSelector(atom) : { kind: 'ligand' },
      showNeighborhood: true,
      radiusA,
      extraRadius: radiusA
    };
  }

  function molstarContextTarget() {
    const structures = molstarContextStructures();
    if (!structures.length) {
      return { structures: [], label: activeConfig?.label || 'Mol* structure', scope: 'none' };
    }
    const picked = molstarContextPickedStructureInfo(structures);
    if (!picked?.structure) {
      return { structures: [], label: activeConfig?.label || 'Mol* structure', scope: 'none' };
    }
    const targetStructure = picked.structure;
    const targetStructures = targetStructure ? [targetStructure] : [];
    const resolved = molstarContextResolvedLoci(targetStructure);
    const pickedAtom = resolved.atom;
    const pickedScope = resolved.selectionBased ? 'selection' : (pickedAtom ? molstarContextScopeForAtom(pickedAtom) : 'selection');
    const pickedLabel = resolved.selectionBased ? 'selection' : (pickedAtom ? molstarContextResidueLabel(pickedAtom) : molstarContextTargetLabel(targetStructures));
    if (activeConfig?.docking && activeDockingPrepared) {
      if (pickedAtom && pickedScope === 'ligand') {
        const ligand = pdbEntryForResidue(activeDockingPrepared.receptorEntry, pickedAtom);
        return {
          structures: targetStructures,
          structure: targetStructure,
          loci: resolved.loci,
          atomLoci: resolved.atomLoci,
          atom: pickedAtom,
          selectionBased: resolved.selectionBased,
          label: ligand?.label || pickedLabel,
          scope: 'ligand',
          receptor: activeDockingPrepared.receptorEntry || null,
          ligand: ligand || currentDockingPoseSource(activeDockingPrepared),
          focus: molstarContextFocusPayload(pickedAtom)
        };
      }
      if (pickedAtom && pickedScope !== 'selection') {
        return {
          structures: targetStructures,
          structure: targetStructure,
          loci: resolved.loci,
          atomLoci: resolved.atomLoci,
          atom: pickedAtom,
          selectionBased: resolved.selectionBased,
          label: pickedLabel,
          scope: pickedScope,
          receptor: activeDockingPrepared.receptorEntry || null,
          selectedEntry: pdbEntryForResidue(activeDockingPrepared.receptorEntry, pickedAtom)
        };
      }
      if (picked?.index === 0) {
        const receptorEntry = activeDockingPrepared.receptorEntry || null;
        return {
          structures: targetStructures,
          structure: targetStructure,
          loci: resolved.loci,
          atomLoci: resolved.atomLoci,
          atom: pickedAtom,
          selectionBased: resolved.selectionBased,
          label: pickedLabel,
          scope: 'selection',
          receptor: receptorEntry,
          sourceEntry: receptorEntry,
          selectedEntry: pickedAtom ? pdbEntryForResidue(receptorEntry, pickedAtom) : null
        };
      }
      if (picked && picked.index > 0) {
        const pose = currentDockingPoseSource(activeDockingPrepared);
        return {
          structures: targetStructures,
          structure: targetStructure,
          loci: resolved.loci,
          atomLoci: resolved.atomLoci,
          atom: pickedAtom,
          selectionBased: resolved.selectionBased,
          label: pose?.label || 'Ligand',
          scope: 'ligand',
          receptor: activeDockingPrepared.receptorEntry || null,
          ligand: pose,
          focus: molstarContextFocusPayload(null)
        };
      }
    }
    const sourceEntry = molstarContextSourceEntryForActiveConfig();
    return {
      structures: targetStructures,
      structure: targetStructure,
      loci: resolved.loci,
      atomLoci: resolved.atomLoci,
      atom: pickedAtom,
      selectionBased: resolved.selectionBased,
      label: pickedLabel,
      scope: pickedScope,
      sourceEntry,
      selectedEntry: pickedAtom ? pdbEntryForResidue(sourceEntry, pickedAtom) : null
    };
  }

  function molstarContextTargetForPick(pick) {
    const previousPick = molstarContextMenuPick;
    const previousMode = molstarContextMenuMode;
    molstarContextMenuPick = pick || null;
    molstarContextMenuMode = 'atom';
    try {
      return molstarContextTarget();
    } finally {
      molstarContextMenuPick = previousPick;
      molstarContextMenuMode = previousMode;
    }
  }

  function molstarContextTargetIgnoringMenuPick() {
    const previousPick = molstarContextMenuPick;
    const previousMode = molstarContextMenuMode;
    molstarContextMenuPick = null;
    molstarContextMenuMode = 'molecule';
    try {
      return molstarContextTarget();
    } finally {
      molstarContextMenuPick = previousPick;
      molstarContextMenuMode = previousMode;
    }
  }

  function molstarContextTargetLabel(structures) {
    const labels = structures
      .map(structure => structure?.cell?.obj?.label || structure?.obj?.label || '')
      .filter(Boolean);
    if (labels.length === 1) return labels[0];
    if (labels.length > 1) return `${labels.length} structures`;
    return activeConfig?.label || 'Mol* structure';
  }

  function parsePdbAtomLine(line) {
    if (!/^(ATOM  |HETATM)/.test(line)) return null;
    const x = Number(line.slice(30, 38));
    const y = Number(line.slice(38, 46));
    const z = Number(line.slice(46, 54));
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return {
      line,
      serial: Number(line.slice(6, 11).trim()),
      atomName: line.slice(12, 16).trim(),
      element: pdbAtomElement(line),
      x,
      y,
      z,
      compId: line.slice(17, 20).trim(),
      chainId: line.slice(21, 22).trim(),
      seqId: line.slice(22, 27).trim(),
      residueKey: `${line.slice(17, 20)}:${line.slice(21, 22)}:${line.slice(22, 27)}`
    };
  }

  function pdbAtomElement(line) {
    const explicit = String(line || '').slice(76, 78).trim();
    const explicitElement = pdbqtAtomTypeElement(explicit);
    if (explicitElement) return explicitElement;
    if (explicit) return explicit.charAt(0).toUpperCase() + explicit.slice(1).toLowerCase();
    const atomTypeElement = pdbqtAtomTypeElement(String(line || '').trim().split(/\s+/u).at(-1));
    if (atomTypeElement) return atomTypeElement;
    const atomName = String(line || '').slice(12, 16).trim().replace(/^[0-9]+/u, '');
    const match = /^[A-Za-z]{1,2}/u.exec(atomName);
    if (!match) return 'C';
    const candidate = match[0].charAt(0).toUpperCase() + match[0].slice(1).toLowerCase();
    if (['Cl', 'Br', 'Na', 'Mg', 'Al', 'Si', 'Ca', 'Fe', 'Zn', 'Cu', 'Mn', 'Co', 'Ni'].includes(candidate)) return candidate;
    return candidate.charAt(0) || 'C';
  }

  function pdbqtAtomTypeElement(value) {
    const atomType = String(value || '').replace(/[^A-Za-z]/gu, '').toUpperCase();
    if (!atomType) return '';
    if (atomType === 'A') return 'C';
    if (atomType === 'HD' || atomType === 'HS') return 'H';
    if (atomType === 'NA' || atomType === 'NS') return 'N';
    if (atomType === 'OA' || atomType === 'OS') return 'O';
    if (atomType === 'SA') return 'S';
    if (atomType.length === 1) return atomType;
    const twoLetter = atomType.charAt(0) + atomType.charAt(1).toLowerCase();
    if (['Cl', 'Br', 'Na', 'Mg', 'Al', 'Si', 'Ca', 'Fe', 'Zn', 'Cu', 'Mn', 'Co', 'Ni'].includes(twoLetter)) return twoLetter;
    return atomType.charAt(0);
  }

  function ligandAtomCoordinates(source) {
    if (!source) return [];
    const format = normalizeFormat(source.format);
    if (format === 'pdb') {
      return String(source.data || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
        .map(parsePdbAtomLine)
        .filter(Boolean)
        .map(atom => ({ x: atom.x, y: atom.y, z: atom.z }));
    }
    if (format !== 'sdf') return [];
    const records = splitSdfRecords(source.data);
    const molecule = parseV2000SdfRecord(records[0] || source.data);
    return molecule?.atoms?.map(atom => ({ x: atom.x, y: atom.y, z: atom.z })) || [];
  }

  function pdbLinesForResidue(receptor, atom) {
    if (!receptor || normalizeFormat(receptor.format) !== 'pdb') return null;
    const compId = String(atom?.auth_comp_id || atom?.label_comp_id || '').trim();
    const chainId = String(atom?.auth_asym_id || atom?.label_asym_id || '').trim();
    const seqId = String(atom?.auth_seq_id ?? atom?.label_seq_id ?? '').trim();
    if (!seqId) return null;
    const lines = String(receptor.data || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(line => {
      const parsed = parsePdbAtomLine(line);
      if (!parsed) return false;
      return (!compId || parsed.compId === compId) && parsed.seqId === seqId && (!chainId || parsed.chainId === chainId);
    });
    return lines.length ? { lines, compId, chainId, seqId } : null;
  }

  function pdbEntryForResidue(receptor, atom) {
    const residue = pdbLinesForResidue(receptor, atom);
    if (!residue) return null;
    const { lines, compId, chainId, seqId } = residue;
    const firstAtom = parsePdbAtomLine(lines[0]);
    const resolvedCompId = compId || firstAtom?.compId || 'Ligand';
    return {
      data: ['HEADER    BURRETE PICKED SELECTION', ...lines, 'END', ''].join('\n'),
      format: 'pdb',
      label: [resolvedCompId, chainId, seqId].filter(Boolean).join(' ')
    };
  }

  function pdbConectPairsForSerials(pdbData, includedSerials) {
    const pairs = new Set();
    for (const line of String(pdbData || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
      if (!line.startsWith('CONECT')) continue;
      const source = Number(line.slice(6, 11).trim());
      if (!Number.isFinite(source) || !includedSerials.has(source)) continue;
      for (let offset = 11; offset + 5 <= line.length; offset += 5) {
        const target = Number(line.slice(offset, offset + 5).trim());
        if (!Number.isFinite(target) || !includedSerials.has(target) || target === source) continue;
        const a = Math.min(source, target);
        const b = Math.max(source, target);
        pairs.add(`${a}:${b}`);
      }
    }
    return Array.from(pairs).map(pair => {
      const [a, b] = pair.split(':').map(Number);
      return { a, b };
    });
  }

  function pdbLigandSdfEntryForResidue(receptor, atom) {
    const residue = pdbLinesForResidue(receptor, atom);
    if (!residue) return null;
    const parsedAtoms = residue.lines.map(parsePdbAtomLine).filter(current => current && Number.isFinite(current.serial));
    if (!parsedAtoms.length || parsedAtoms.length > 999) return null;
    const includedSerials = new Set(parsedAtoms.map(current => current.serial));
    const serialToSdfIndex = new Map(parsedAtoms.map((current, index) => [current.serial, index + 1]));
    const bonds = pdbConectPairsForSerials(receptor.data, includedSerials)
      .filter(bond => serialToSdfIndex.has(bond.a) && serialToSdfIndex.has(bond.b));
    if (bonds.length > 999) return null;
    const firstAtom = parsedAtoms[0];
    const label = [residue.compId || firstAtom.compId || 'Ligand', residue.chainId, residue.seqId].filter(Boolean).join(' ');
    const sdfBonds = bonds.length
      ? bonds.map(bond => ({ a: serialToSdfIndex.get(bond.a), b: serialToSdfIndex.get(bond.b) }))
      : inferStandalonePreviewBonds(parsedAtoms);
    if (sdfBonds.length > 999) return null;
    return {
      data: [
        label,
        '  Burrete',
        'PDB ligand selection',
        formatSdfCountsLine(parsedAtoms.length, sdfBonds.length),
        ...parsedAtoms.map(current => formatSdfAtomLine({
          x: current.x,
          y: current.y,
          z: current.z,
          tail: ` ${String(current.element || 'C').padEnd(3, ' ')} 0  0  0  0  0  0  0  0  0  0  0  0`
        }, current.x, current.y, current.z)),
        ...sdfBonds.map(bond => `${padSdfInt(bond.a)}${padSdfInt(bond.b)}  1  0  0  0  0`),
        'M  END',
        '$$$$',
        ''
      ].join('\n'),
      format: 'sdf',
      label
    };
  }

  function pdbEnvironmentForLigand(receptor, ligand, radiusAngstrom = 6) {
    const receptorFormat = normalizeFormat(receptor?.format);
    const receptorData = typeof receptor?.data === 'string' ? receptor.data : '';
    const ligandAtoms = ligandAtomCoordinates(ligand);
    if (receptorFormat !== 'pdb' || !receptorData || ligandAtoms.length === 0) {
      return { data: receptorData, label: receptor?.label || 'Receptor', fallback: true };
    }
    const atoms = receptorData.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map(parsePdbAtomLine).filter(Boolean);
    if (!atoms.length) return { data: receptorData, label: receptor?.label || 'Receptor', fallback: true };
    const radiusSq = radiusAngstrom * radiusAngstrom;
    const selectedResidues = new Set();
    for (const atom of atoms) {
      for (const ligandAtom of ligandAtoms) {
        const dx = atom.x - ligandAtom.x;
        const dy = atom.y - ligandAtom.y;
        const dz = atom.z - ligandAtom.z;
        if ((dx * dx + dy * dy + dz * dz) <= radiusSq) {
          selectedResidues.add(atom.residueKey);
          break;
        }
      }
    }
    if (selectedResidues.size === 0) {
      return { data: receptorData, label: receptor?.label || 'Receptor', fallback: true };
    }
    const selectedLines = [];
    for (const line of receptorData.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
      const atom = parsePdbAtomLine(line);
      if (atom && selectedResidues.has(atom.residueKey)) selectedLines.push(line);
    }
    return {
      data: ['HEADER    BURRETE DOCKING CONTEXT', ...selectedLines, 'END', ''].join('\n'),
      label: `${receptor?.label || 'Receptor'} environment`,
      fallback: false,
      residueCount: selectedResidues.size
    };
  }

  function molstarContextDocumentPayload(target) {
    if (target?.scope === 'ligand' && target.receptor && target.ligand) {
      return {
        label: target.ligand.label || target.label || 'Ligand',
        entries: [
          {
            role: 'ligand',
            label: target.ligand.label || 'Ligand',
            format: normalizeFormat(target.ligand.format),
            data: target.ligand.data
          }
        ],
        context: {
          scope: 'ligand'
        }
      };
    }
    if (target?.scope === 'ligand' && target.selectedEntry && target.sourceEntry) {
      const ligandEntry = pdbLigandSdfEntryForResidue(target.sourceEntry, target.atom) || target.selectedEntry;
      return {
        label: ligandEntry.label || target.label || 'Ligand',
        entries: [
          {
            role: 'ligand',
            label: ligandEntry.label || target.label || 'Ligand',
            format: normalizeFormat(ligandEntry.format),
            data: ligandEntry.data
          }
        ],
        context: { scope: 'ligand' }
      };
    }
    if (target?.selectedEntry) {
      return {
        label: target.selectedEntry.label || target.label || 'Mol* selection',
        entries: [
          {
            role: target.scope === 'ligand' ? 'ligand' : 'structure',
            label: target.selectedEntry.label || target.label || 'Mol* selection',
            format: normalizeFormat(target.selectedEntry.format),
            data: target.selectedEntry.data
          }
        ],
        context: { scope: target.scope || 'selection' }
      };
    }
    return null;
  }

  function molstarRuntime() {
    if (window.molstar) return window.molstar;
    try {
      if (typeof molstar !== 'undefined') return molstar;
    } catch (_) {
      return null;
    }
    return null;
  }

  function molstarExportLib() {
    const runtime = molstarRuntime();
    return runtime?.lib || runtime || {};
  }

  function molstarExportToMmCif() {
    const runtime = molstarRuntime();
    const lib = molstarExportLib();
    if (typeof lib.to_mmCIF === 'function') return lib.to_mmCIF;
    if (typeof runtime?.to_mmCIF === 'function') return runtime.to_mmCIF;
    if (typeof lib.Structure?.to_mmCIF === 'function') return lib.Structure.to_mmCIF;
    if (typeof runtime?.Structure?.to_mmCIF === 'function') return runtime.Structure.to_mmCIF;
    return null;
  }

  function molstarExportStructureName(structureRef, index = 0) {
    const label = structureRef?.cell?.obj?.label ||
      structureRef?.transform?.cell?.obj?.label ||
      activeConfig?.label ||
      'structure';
    const base = safeExportBaseName(label, `structure-${index + 1}`)
      .replace(/[^A-Za-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const name = base || `structure_${index + 1}`;
    return /^[A-Za-z_]/u.test(name) ? name : `structure_${name}`;
  }

  function molstarExportFileName(extension = 'cif') {
    const safeExtension = String(extension || 'cif').replace(/[^A-Za-z0-9]/g, '') || 'cif';
    return `${safeExportBaseName(activeConfig?.label || 'modified-structure', 'modified-structure')}.modified.${safeExtension}`;
  }

  function molstarSelectionExportFileName(label, extension) {
    const safeExtension = String(extension || 'txt').replace(/[^A-Za-z0-9]/g, '') || 'txt';
    return `${safeExportBaseName(label || activeConfig?.label || 'selection', 'selection')}.modified.${safeExtension}`;
  }

  function molstarStructureFromRef(structureRef) {
    return structureRef?.transform?.cell?.obj?.data ||
      structureRef?.cell?.obj?.data ||
      structureRef?.obj?.data ||
      null;
  }

  function molstarComponentStructuresForExport(structureRef) {
    const components = Array.isArray(structureRef?.components) ? structureRef.components : [];
    return components
      .filter(component => {
        const label = String(component?.cell?.obj?.label || '').trim();
        return label && !label.startsWith('[Focus]') && label !== 'Unit Cell';
      })
      .map(component => component?.cell?.obj?.data)
      .filter(structure => structure && Array.isArray(structure.units) && structure.elementCount > 0);
  }

  function molstarUnionComponentStructures(source, componentStructures) {
    if (!source || !Array.isArray(componentStructures) || componentStructures.length === 0) return source;
    const unitElements = new Map();
    for (const structure of componentStructures) {
      for (const unit of structure.units || []) {
        if (!source.unitMap?.has?.(unit.id)) continue;
        let elements = unitElements.get(unit.id);
        if (!elements) {
          elements = [];
          unitElements.set(unit.id, elements);
        }
        for (let i = 0; i < unit.elements.length; i++) elements.push(unit.elements[i]);
      }
    }
    if (unitElements.size === 0) return source;
    const builder = source.subsetBuilder(true);
    unitElements.forEach((elements, unitId) => {
      elements.sort((a, b) => a - b);
      const deduplicated = [];
      for (const element of elements) {
        if (deduplicated[deduplicated.length - 1] !== element) deduplicated.push(element);
      }
      if (deduplicated.length) builder.setUnit(unitId, deduplicated);
    });
    const merged = builder.getStructure();
    return merged && merged.elementCount > 0 ? merged : source;
  }

  function molstarCurrentStructuresForExport() {
    const structures = activeViewer?.plugin?.managers?.structure?.hierarchy?.current?.structures;
    if (!Array.isArray(structures)) return [];
    const lib = molstarExportLib();
    const unit = lib.Unit || {};
    return structures.map((structureRef, index) => {
      const source = molstarStructureFromRef(structureRef);
      if (!source || !Array.isArray(source.units) || source.elementCount <= 0) return null;
      const componentStructures = molstarComponentStructuresForExport(structureRef);
      const structure = molstarUnionComponentStructures(source, componentStructures);
      if (!structure || structure.elementCount <= 0) return null;
      if (typeof unit.isAtomic === 'function' && structure.units.some(currentUnit => !unit.isAtomic(currentUnit))) {
        return null;
      }
      return {
        name: molstarExportStructureName(structureRef, index),
        structure
      };
    }).filter(Boolean);
  }

  function molstarStructureAtomIndices(structure) {
    const indices = new Set();
    for (const unit of structure?.units || []) {
      const elements = unit?.elements;
      if (!elements) continue;
      for (let i = 0; i < elements.length; i++) {
        const atomIndex = molstarContextNumberOrUndefined(elements[i]);
        if (atomIndex != null) indices.add(atomIndex);
      }
    }
    return indices;
  }

  function molstarCurrentAtomIndicesForExport() {
    const indices = new Set();
    for (const entry of molstarCurrentStructuresForExport()) {
      for (const atomIndex of molstarStructureAtomIndices(entry.structure)) indices.add(atomIndex);
    }
    return indices;
  }

  function pdbSerialFromLine(line) {
    const serial = Number(String(line || '').slice(6, 11).trim());
    return Number.isFinite(serial) ? serial : null;
  }

  function filteredPdbConectLine(line, includedSerials) {
    const source = pdbSerialFromLine(line);
    if (source == null || !includedSerials.has(source)) return null;
    const targets = [];
    for (let offset = 11; offset + 5 <= line.length; offset += 5) {
      const target = Number(line.slice(offset, offset + 5).trim());
      if (Number.isFinite(target) && includedSerials.has(target)) targets.push(target);
    }
    if (!targets.length) return null;
    return `CONECT${String(source).padStart(5, ' ')}${targets.map(target => String(target).padStart(5, ' ')).join('')}`;
  }

  function molstarModifiedPdbExportPayload() {
    const sourceEntry = molstarContextSourceEntryForActiveConfig();
    if (!sourceEntry) throw new Error('PDB fallback export is unavailable for this structure.');
    const includedAtomIndices = molstarCurrentAtomIndicesForExport();
    if (!includedAtomIndices.size) throw new Error('No modified Mol* atoms are available to save.');
    const lines = sourceEntry.data.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const output = [];
    const conectLines = [];
    const includedSerials = new Set();
    let atomIndex = 0;
    let wroteAtomSinceTer = false;
    for (const line of lines) {
      if (/^(ATOM  |HETATM)/.test(line)) {
        const include = includedAtomIndices.has(atomIndex);
        atomIndex++;
        if (!include) continue;
        output.push(line);
        const serial = pdbSerialFromLine(line);
        if (serial != null) includedSerials.add(serial);
        wroteAtomSinceTer = true;
      } else if (/^ANISOU/.test(line)) {
        const serial = pdbSerialFromLine(line);
        if (serial != null && includedSerials.has(serial)) output.push(line);
      } else if (/^TER/.test(line)) {
        if (wroteAtomSinceTer) output.push(line);
        wroteAtomSinceTer = false;
      } else if (/^CONECT/.test(line)) {
        conectLines.push(line);
      } else if (/^END(MDL)?\s*$/.test(line)) {
        continue;
      } else if (line.trim()) {
        output.push(line);
      }
    }
    for (const line of conectLines) {
      const filtered = filteredPdbConectLine(line, includedSerials);
      if (filtered) output.push(filtered);
    }
    output.push('END');
    return {
      name: molstarExportFileName('pdb'),
      mimeType: 'chemical/x-pdb',
      text: `${output.join('\n')}\n`,
      count: 1
    };
  }

  function molstarModifiedPdbExportAvailable() {
    return !!molstarContextSourceEntryForActiveConfig();
  }

  function molstarModifiedMmCifExportPayload() {
    const toMmCif = molstarExportToMmCif();
    if (!toMmCif) throw new Error('mmCIF export is unavailable in this Mol* runtime.');
    const exports = molstarCurrentStructuresForExport();
    if (!exports.length) throw new Error('No modified Mol* structure is available to save.');
    const label = exports.length === 1 ? exports[0].name : 'burrete_modified_structures';
    const structures = exports.length === 1 ? exports[0].structure : exports.map(entry => entry.structure);
    const text = toMmCif(label, structures, false, { copyAllCategories: true });
    if (typeof text !== 'string' || !text.trim()) throw new Error('Mol* returned an empty mmCIF export.');
    return {
      name: molstarExportFileName(),
      mimeType: 'chemical/x-cif',
      text,
      count: exports.length
    };
  }

  function molstarContextSdfEntryForExport(target) {
    if (target?.scope === 'ligand' && normalizeFormat(target.sourceEntry?.format) === 'sdf') {
      return target.sourceEntry;
    }
    if (target?.scope === 'ligand' && target.receptor && target.ligand) {
      const ligandEntry = pdbLigandSdfEntryForResidue(target.receptor, target.atom);
      if (ligandEntry) return ligandEntry;
      const ligandFormat = normalizeFormat(target.ligand.format);
      if (ligandFormat === 'sdf') return target.ligand;
    }
    if (target?.scope === 'ligand' && target.selectedEntry && target.sourceEntry) {
      const ligandEntry = pdbLigandSdfEntryForResidue(target.sourceEntry, target.atom) || target.selectedEntry;
      if (normalizeFormat(ligandEntry?.format) === 'sdf') return ligandEntry;
    }
    if (target?.scope === 'ligand' && normalizeFormat(target.selectedEntry?.format) === 'sdf') {
      return target.selectedEntry;
    }
    return null;
  }

  function molstarContextSdfExportAvailable(target) {
    return !!molstarContextSdfEntryForExport(target);
  }

  function molstarContextSdfExportPayload(target) {
    const ligandEntry = molstarContextSdfEntryForExport(target);
    if (!ligandEntry) throw new Error('SDF export is available only for ligand selections with SDF data or PDB residue data.');
    const text = String(ligandEntry.data || '');
    if (!text.trim()) throw new Error('The selected ligand has no SDF data to save.');
    return {
      name: molstarSelectionExportFileName(ligandEntry.label || target?.label || 'ligand', 'sdf'),
      mimeType: 'chemical/x-mdl-sdfile',
      text: text.endsWith('\n') ? text : `${text}\n`,
      count: 1
    };
  }

  function molstarModifiedStructureExportPayload() {
    const toMmCif = molstarExportToMmCif();
    if (!toMmCif) return molstarModifiedPdbExportPayload();
    return molstarModifiedMmCifExportPayload();
  }

  function molstarModifiedStructureExportPayloadForFormat(format, target) {
    const normalized = normalizeFormat(format);
    if (normalized === 'mmcif' || normalized === 'cifCore') return molstarModifiedMmCifExportPayload();
    if (normalized === 'pdb') return molstarModifiedPdbExportPayload();
    if (normalized === 'sdf') return molstarContextSdfExportPayload(target);
    throw new Error(`Unsupported structure export format: ${format || 'unknown'}.`);
  }

  function postMolstarModifiedStructureExport(payload) {
    const posted = postHostMessage({
      type: 'exportText',
      name: payload.name,
      mimeType: payload.mimeType,
      text: payload.text
    });
    if (!posted) throw new Error('Structure saving is unavailable in this host.');
    return payload;
  }

  function saveMolstarModifiedStructure() {
    return postMolstarModifiedStructureExport(molstarModifiedStructureExportPayload());
  }

  function saveMolstarModifiedStructureAs(format, target) {
    return postMolstarModifiedStructureExport(molstarModifiedStructureExportPayloadForFormat(format, target));
  }

  function molstarEditSnapshotFormat(payload) {
    const explicit = String(payload?.format || '').trim();
    if (explicit) return normalizeFormat(explicit);
    const name = String(payload?.name || '').toLowerCase();
    const mimeType = String(payload?.mimeType || '').toLowerCase();
    if (mimeType.includes('pdb') || name.endsWith('.pdb')) return 'pdb';
    if (mimeType.includes('cif') || name.endsWith('.cif') || name.endsWith('.mcif') || name.endsWith('.mmcif')) return 'mmcif';
    return normalizeFormat(activeConfig?.molstarFormat || activeConfig?.format || 'mmcif');
  }

  function captureMolstarEditUndoSnapshot(label) {
    const payload = molstarModifiedStructureExportPayload();
    const text = String(payload?.text || '');
    if (!text.trim()) throw new Error('Mol* returned an empty undo snapshot.');
    return {
      label: String(label || payload.name || 'Mol* edit'),
      dirty: molstarStructureDirty,
      payload: {
        name: payload.name,
        mimeType: payload.mimeType,
        text,
        format: molstarEditSnapshotFormat(payload)
      }
    };
  }

  function pushMolstarEditUndoSnapshot(snapshot) {
    if (!snapshot?.payload?.text) return;
    molstarEditUndoStack.push(snapshot);
    while (molstarEditUndoStack.length > MOLSTAR_EDIT_HISTORY_LIMIT) molstarEditUndoStack.shift();
  }

  function clearMolstarEditUndoHistory() {
    molstarEditUndoStack.length = 0;
  }

  async function restoreMolstarEditUndoSnapshot(snapshot) {
    if (!activeViewer) throw new Error('Mol* viewer is not ready.');
    const payload = snapshot?.payload || {};
    const text = String(payload.text || '');
    if (!text.trim()) throw new Error('Undo snapshot is empty.');
    const format = molstarEditSnapshotFormat(payload);
    const label = String(snapshot.label || payload.name || 'Mol* undo snapshot');
    const prepared = {
      data: text,
      format,
      label,
      molstarStyleOverride: configuredMolstarStyle(activeConfig || window.BurreteConfig || {})
    };
    const plugin = activeViewer.plugin;
    const transitionFrame = captureMolstarTransitionFrame();
    try {
      if (typeof plugin?.clear !== 'function') throw new Error('Mol* cannot replace the current structure in this runtime.');
      await plugin.clear();
      await withTimeout(
        loadPreparedStructure(activeViewer, prepared),
        45000,
        `Mol* timed out while restoring ${label}.`
      );
      applyLayoutState(activeViewer);
      scheduleLayoutStateReapply(activeViewer);
      try { activeViewer.handleResize(); } catch (_) {}
      fadeMolstarTransitionFrame(transitionFrame);
    } catch (error) {
      removeMolstarTransitionFrame(transitionFrame);
      throw error;
    }
    setMolstarStructureDirty(snapshot.dirty === true);
    clearMolstarSelection();
    try {
      window.BurreteAgent?.notifyStructureLoaded?.({
        viewer: activeViewer,
        plugin: activeViewer.plugin,
        config: activeConfig || window.BurreteConfig || {},
        prepared
      });
      postHostMessage({ type: 'agentReady', message: 'Burrete agent ready' });
    } catch (error) {
      debug('BurreteAgent notifyStructureLoaded failed after Mol* undo: ' + (error && error.message || String(error)));
    }
  }

  async function undoMolstarLastEdit() {
    const snapshot = molstarEditUndoStack.pop();
    if (!snapshot) {
      setStatus('[web] Nothing to undo.');
      return;
    }
    try {
      await restoreMolstarEditUndoSnapshot(snapshot);
    } catch (error) {
      molstarEditUndoStack.push(snapshot);
      throw error;
    }
    setStatus(`[web] Undid ${snapshot.label}.`);
    setTimeout(hideStatus, isQuickLookHost() ? 0 : 700);
  }

  async function resetMolstarCameraForContext() {
    try {
      const result = await window.BurreteAgent?.run?.({
        command: 'resetCamera',
        args: { durationMs: 250 }
      });
      if (result?.ok !== false) return true;
    } catch (_) {}
    try {
      activeViewer?.plugin?.canvas3d?.requestCameraReset?.({ durationMs: 250 });
      return true;
    } catch (_) {
      return false;
    }
  }

  function selectMolstarContextPick(target, options = {}) {
    const loci = target?.loci || molstarContextMenuPick?.loci;
    if (!loci || molstarLociIsEmpty(loci)) return false;
    const additive = options.additive === true;
    const applyGranularity = options.applyGranularity ?? false;
    const selects = activeViewer?.plugin?.managers?.interactivity?.lociSelects;
    const selection = activeViewer?.plugin?.managers?.structure?.selection;
    let handled = false;
    if (typeof selects?.select === 'function') {
      if (!additive && typeof selects.deselectAll === 'function') selects.deselectAll();
      selects.select({ loci }, applyGranularity);
      handled = true;
    }
    if (typeof selection?.fromLoci === 'function') {
      if (!additive) selection.clear?.();
      selection.fromLoci(additive ? 'add' : 'set', loci, applyGranularity);
      handled = true;
    }
    if (handled) scheduleMolstarSelectedMoleculePreview(target);
    return handled;
  }

  function molstarContextTargetComponents(target) {
    const components = Array.isArray(target?.structure?.components) ? target.structure.components : [];
    const componentManager = activeViewer?.plugin?.managers?.structure?.component;
    if (typeof componentManager?.canBeModified !== 'function') return components;
    return components.filter(component => componentManager.canBeModified(component));
  }

  async function deleteMolstarContextLoci(target, loci, applyGranularity = true) {
    if (!loci || molstarLociIsEmpty(loci)) return false;
    const plugin = activeViewer?.plugin;
    const selection = plugin?.managers?.structure?.selection;
    const componentManager = plugin?.managers?.structure?.component;
    const components = molstarContextTargetComponents(target);
    if (!components.length || typeof selection?.fromLoci !== 'function' || typeof componentManager?.modifyByCurrentSelection !== 'function') {
      return false;
    }
    selection.clear?.();
    try {
      selection.fromLoci('set', loci, applyGranularity);
      await componentManager.modifyByCurrentSelection(components, 'subtract');
    } finally {
      selection.clear?.();
    }
    return true;
  }

  async function deleteMolstarContextPick(target) {
    const loci = target?.loci || molstarContextMenuPick?.loci;
    return deleteMolstarContextLoci(target, loci, !target?.selectionBased);
  }

  function molstarContextChainLociFromPick(target) {
    const sourceAtom = target?.atom;
    const structure = target?.loci?.structure || molstarContextMenuPick?.loci?.structure;
    const units = Array.isArray(structure?.units) ? structure.units : [];
    if (!sourceAtom || !units.length) return null;
    const elements = [];
    for (const unit of units) {
      const unitElements = unit?.elements;
      if (!unit?.model || !unitElements?.length) continue;
      const indices = [];
      for (let i = 0; i < unitElements.length; i++) {
        const atomIndex = molstarContextNumberOrUndefined(unitElements[i]);
        if (molstarContextAtomBelongsToChain(unit.model, atomIndex, sourceAtom)) indices.push(i);
      }
      if (indices.length) elements.push({ unit, indices });
    }
    if (!elements.length) return null;
    return { kind: 'element-loci', structure, elements };
  }

  async function deleteMolstarContextChain(target) {
    if (target?.scope !== 'residue') return false;
    const chainLoci = molstarContextChainLociFromPick(target);
    return deleteMolstarContextLoci(target, chainLoci, false);
  }

  function molstarContextComponentId(atom) {
    return String(atom?.auth_comp_id || atom?.label_comp_id || '').trim().toUpperCase();
  }

  function molstarContextBulkDeleteLabel(target) {
    const comp = molstarContextComponentId(target?.atom);
    if (target?.scope === 'water') return 'all water';
    if (target?.scope === 'ion') return comp ? `all ${comp} ions` : 'all ions';
    if (target?.scope === 'ligand') return comp ? `all ${comp} ligands` : 'all ligands';
    return 'all matching molecules';
  }

  function molstarContextCanBulkDelete(target) {
    return !!target?.atom && (target.scope === 'water' || target.scope === 'ion' || target.scope === 'ligand');
  }

  function molstarContextAtomMatchesBulkDelete(atom, target) {
    if (!atom || !target?.atom) return false;
    const kind = molstarContextAtomKind(atom);
    if (target.scope === 'water') return kind === 'water';
    if (target.scope === 'ion') return kind === 'ion' && molstarContextComponentId(atom) === molstarContextComponentId(target.atom);
    if (target.scope === 'ligand') return kind === 'ligand' && molstarContextComponentId(atom) === molstarContextComponentId(target.atom);
    return false;
  }

  function molstarContextBulkDeleteLoci(target) {
    if (!molstarContextCanBulkDelete(target)) return null;
    const structure = target?.loci?.structure || molstarContextMenuPick?.loci?.structure;
    const units = Array.isArray(structure?.units) ? structure.units : [];
    const elements = [];
    for (const unit of units) {
      const unitElements = unit?.elements;
      if (!unit?.model || !unitElements?.length) continue;
      const indices = [];
      for (let i = 0; i < unitElements.length; i++) {
        const atomIndex = molstarContextNumberOrUndefined(unitElements[i]);
        const atom = molstarContextAtomFromModelIndex(unit.model, atomIndex);
        if (molstarContextAtomMatchesBulkDelete(atom, target)) indices.push(i);
      }
      if (indices.length) elements.push({ unit, indices });
    }
    if (!elements.length) return null;
    return { kind: 'element-loci', structure, elements };
  }

  async function deleteMolstarContextBulkType(target) {
    const loci = molstarContextBulkDeleteLoci(target);
    return deleteMolstarContextLoci(target, loci, false);
  }

  function focusMolstarContextPick(target) {
    const loci = target?.loci || molstarContextMenuPick?.loci;
    if (!loci || molstarLociIsEmpty(loci)) return false;
    const camera = activeViewer?.plugin?.managers?.camera;
    if (typeof camera?.focusLoci !== 'function') return false;
    camera.focusLoci(loci, { durationMs: 250 });
    return true;
  }

  function molstarContextTargetNoun(target) {
    if (target?.scope === 'water') return 'water';
    if (target?.scope === 'ligand') return 'ligand';
    if (target?.scope === 'ion') return 'ion';
    if (target?.scope === 'residue') return 'residue';
    return 'selection';
  }

  function molstarContextAtomLabel(target) {
    const residue = molstarContextResidueLabel(target?.atom);
    const atom = String(target?.atom?.auth_atom_id || target?.atom?.label_atom_id || '').trim();
    return atom ? `${residue} atom ${atom}` : `${residue} atom`;
  }

  function molstarContextMenuActions(target, mode = 'molecule') {
    if (mode === 'atom' && target?.scope === 'ligand') {
      const actions = [
        ['select-atom', 'Select atom'],
        ['remove-atom', 'Delete atom'],
        ['save-modified', 'Save modified structure'],
        ['save-format:mmcif', 'Save as mmCIF']
      ];
      if (molstarModifiedPdbExportAvailable()) actions.push(['save-format:pdb', 'Save as PDB']);
      if (molstarContextSdfExportAvailable(target)) actions.push(['save-format:sdf', 'Save ligand as SDF']);
      actions.push(['focus-atom', 'Focus atom in current view']);
      return actions;
    }
    const noun = molstarContextTargetNoun(target);
    const actions = [
      ['select', `Select ${noun}`],
      ['remove', molstarContextCanBulkDelete(target) ? `Delete selected ${noun}` : `Delete ${noun}`]
    ];
    if (molstarContextCanBulkDelete(target)) actions.push(['remove-type', `Delete ${molstarContextBulkDeleteLabel(target)}`]);
    if (target?.scope === 'residue') actions.push(['remove-chain', 'Delete chain']);
    if (molstarContextDocumentPayload(target)) actions.push(['molstar', 'Open in Mol*']);
    actions.push(['save-modified', 'Save modified structure']);
    actions.push(['save-format:mmcif', 'Save as mmCIF']);
    if (molstarModifiedPdbExportAvailable()) actions.push(['save-format:pdb', 'Save as PDB']);
    if (molstarContextSdfExportAvailable(target)) actions.push(['save-format:sdf', 'Save ligand as SDF']);
    if (molstarPubChemSearchAvailable(target)) {
      actions.push(['pubchem:identity', 'Search PubChem — Identical']);
      actions.push(['pubchem:similarity', 'Search PubChem — Similar (90%)']);
    }
    if (canGenerate3DConformerFromConfig(activeConfig || {}, 'molstar')) {
      actions.push(['compute:optimizeGeometry', 'Compute — Optimize geometry']);
      actions.push(['compute:semiempiricalRm1', 'Compute — RM1 energy & charges']);
      if (isSdfPoseConformerSet(activeConfig || {})) actions.push(['compute:alignPoses', 'Compute — Align & compare poses']);
    }
    actions.push(['focus', 'Focus in current view']);
    return actions;
  }

  function molstarContextActionsPayload(actions) {
    return (Array.isArray(actions) ? actions : []).map(([name, title]) => ({
      name: String(name || ''),
      title: String(title || '')
    })).filter(action => action.name && action.title);
  }

  function showNativeMolstarContextMenu(menuTarget, mode) {
    if (!document.body?.classList.contains('burette-mobile-host')) return false;
    const supportsAtomMode = menuTarget?.scope === 'ligand' && !!menuTarget?.atomLoci;
    const moleculeActions = molstarContextActionsPayload(molstarContextMenuActions(menuTarget, 'molecule'));
    const atomActions = supportsAtomMode
      ? molstarContextActionsPayload(molstarContextMenuActions(menuTarget, 'atom'))
      : [];
    if (!moleculeActions.length && !atomActions.length) return false;
    return postHostMessage({
      type: 'mobileContextMenu',
      label: menuTarget?.label || '',
      scope: menuTarget?.scope || 'selection',
      mode: mode === 'atom' ? 'atom' : 'molecule',
      moleculeActions,
      atomActions
    });
  }

  async function moleculeContextMenuAction(action, label) {
    const target = molstarContextTarget();
    const targetLabel = target.label;
    let previewAfterAction = null;
    try {
      if (action === 'select') {
        const selectionLoci = molstarContextSelectionLoci(target);
        if (!selectMolstarContextPick({ ...target, loci: selectionLoci }, { applyGranularity: false })) throw new Error('No Mol* residue or ligand is available to select.');
        if (target.scope === 'ligand' || target.scope === 'ion') previewAfterAction = target;
        setStatus(`[web] Selected ${targetLabel}.`);
      } else if (action === 'remove') {
        const undoSnapshot = captureMolstarEditUndoSnapshot(`delete ${targetLabel}`);
        if (!await deleteMolstarContextPick(target)) throw new Error('No editable Mol* residue or ligand is available to delete.');
        pushMolstarEditUndoSnapshot(undoSnapshot);
        setMolstarStructureDirty(true);
        setStatus(`[web] Deleted ${targetLabel}.`);
      } else if (action === 'remove-type') {
        const bulkLabel = molstarContextBulkDeleteLabel(target);
        const undoSnapshot = captureMolstarEditUndoSnapshot(`delete ${bulkLabel}`);
        if (!await deleteMolstarContextBulkType(target)) throw new Error(`No editable Mol* ${bulkLabel} is available to delete.`);
        pushMolstarEditUndoSnapshot(undoSnapshot);
        setMolstarStructureDirty(true);
        setStatus(`[web] Deleted ${bulkLabel}.`);
      } else if (action === 'remove-chain') {
        const chainLabel = molstarContextChainLabel(target.atom);
        const undoSnapshot = captureMolstarEditUndoSnapshot(`delete ${chainLabel}`);
        if (!await deleteMolstarContextChain(target)) throw new Error('No editable Mol* protein chain is available to delete.');
        pushMolstarEditUndoSnapshot(undoSnapshot);
        setMolstarStructureDirty(true);
        setStatus(`[web] Deleted ${chainLabel}.`);
      } else if (action === 'select-atom') {
        if (!target.atomLoci || !selectMolstarContextPick({ ...target, loci: target.atomLoci }, { additive: molstarContextMenuMode === 'atom', applyGranularity: false })) throw new Error('No Mol* atom is available to select.');
        if (target.scope === 'ligand' || target.scope === 'ion') previewAfterAction = target;
        setStatus(`[web] Selected ${molstarContextAtomLabel(target)}.`);
      } else if (action === 'remove-atom') {
        const atomLabel = molstarContextAtomLabel(target);
        const undoSnapshot = captureMolstarEditUndoSnapshot(`delete ${atomLabel}`);
        if (!target.atomLoci || !await deleteMolstarContextLoci(target, target.atomLoci, false)) throw new Error('No editable Mol* atom is available to delete.');
        pushMolstarEditUndoSnapshot(undoSnapshot);
        setMolstarStructureDirty(true);
        setStatus(`[web] Deleted ${atomLabel}.`);
      } else if (action === 'molstar') {
        const contextDocument = molstarContextDocumentPayload(target);
        if (!contextDocument) throw new Error('No molecule-level Mol* context is available for this target.');
        const posted = postHostMessage({
          type: 'openMolstarContextDocument',
          renderer: 'molstar',
          contextDocument
        });
        setStatus(posted ? `[web] Opening ${targetLabel} in Mol*...` : '[web] Separate Mol* view is unavailable in this host.');
      } else if (action === 'save-modified') {
        const saved = saveMolstarModifiedStructure();
        setStatus(`[web] Saving ${saved.name} (${saved.count} structure${saved.count === 1 ? '' : 's'}).`);
        setMolstarStructureDirty(false);
      } else if (action.startsWith('save-format:')) {
        const format = action.slice('save-format:'.length);
        const saved = saveMolstarModifiedStructureAs(format, target);
        setStatus(`[web] Saving ${saved.name} (${saved.count} structure${saved.count === 1 ? '' : 's'}).`);
        if (normalizeFormat(format) !== 'sdf') setMolstarStructureDirty(false);
      } else if (action.startsWith('pubchem:')) {
        const searchType = action.slice('pubchem:'.length);
        await openMolstarPubChemSearch(target, searchType);
        setStatus(`[web] Opening PubChem ${searchType === 'identity' ? 'identity' : '90% similarity'} search for ${targetLabel}.`);
      } else if (action.startsWith('compute:')) {
        requestMolecularCompute(action.slice('compute:'.length));
      } else if (action === 'focus') {
        const handled = focusMolstarContextPick(target) || await resetMolstarCameraForContext();
        if (target.scope === 'ligand' || target.scope === 'ion') previewAfterAction = target;
        setStatus(handled ? `[web] Focused ${targetLabel} in the current Mol* view.` : `[web] ${targetLabel} is already visible in Mol*.`);
      } else if (action === 'focus-atom') {
        const handled = focusMolstarContextPick({ ...target, loci: target.atomLoci }) || await resetMolstarCameraForContext();
        if (target.scope === 'ligand' || target.scope === 'ion') previewAfterAction = target;
        setStatus(handled ? `[web] Focused ${molstarContextAtomLabel(target)} in the current Mol* view.` : `[web] ${molstarContextAtomLabel(target)} is already visible in Mol*.`);
      } else {
        setStatus(`[web] ${label} is unavailable.`);
      }
    } catch (error) {
      setStatus(`[web] ${label} failed.\n\n${error?.message || String(error)}`, 'error');
    } finally {
      if (!(action === 'select-atom' && molstarContextMenuMode === 'atom')) hideMolstarContextMenu();
      if (previewAfterAction) scheduleMolstarSelectedMoleculePreview(previewAfterAction);
    }
  }

  window.BurreteRunMobileContextMenuAction = function (action, mode = 'molecule') {
    const actionName = String(action || '');
    if (!actionName) return;
    const nextMode = mode === 'atom' ? 'atom' : 'molecule';
    molstarContextMenuMode = nextMode;
    const target = molstarContextTarget();
    const matchedAction = molstarContextMenuActions(target, nextMode).find(([name]) => name === actionName);
    void moleculeContextMenuAction(actionName, matchedAction?.[1] || actionName);
  };

  function molstarMoleculePreviewEntry(target) {
    if (!target || (target.scope !== 'ligand' && target.scope !== 'ion')) return null;
    const sdfEntry = molstarMoleculePreviewSdfEntry(target);
    if (sdfEntry) return sdfEntry;
    const entry = target.selectedEntry || target.ligand || null;
    return molstarStandaloneMoleculePreviewEntryForTarget(target, entry);
  }

  function molstarMoleculePreviewSdfEntry(target) {
    if (!target || (target.scope !== 'ligand' && target.scope !== 'ion')) return null;
    if (target.atom && target.receptor) {
      const ligandEntry = pdbLigandSdfEntryForResidue(target.receptor, target.atom);
      if (ligandEntry) return ligandEntry;
    }
    if (target.atom && target.sourceEntry) {
      const ligandEntry = pdbLigandSdfEntryForResidue(target.sourceEntry, target.atom);
      if (ligandEntry) return ligandEntry;
    }
    if (target.scope === 'ligand') {
      const ligandEntry = molstarContextSdfEntryForExport(target);
      if (ligandEntry) return ligandEntry;
    }
    const entry = target.selectedEntry || target.ligand || null;
    return normalizeFormat(entry?.format) === 'sdf' ? entry : null;
  }

  function molstarPubChemSearchAvailable(target) {
    return activeConfig?.appViewer === true
      && activeConfig?.pubChemSearch === true
      && !molstarStructureDirty
      && !!molstarExactPubChemSdfEntry(target);
  }

  function molstarExactPubChemSdfEntry(target) {
    if (!target || (target.scope !== 'ligand' && target.scope !== 'ion')) return null;
    for (const entry of [target.ligand, target.selectedEntry, target.sourceEntry]) {
      if (normalizeFormat(entry?.format) === 'sdf' && String(entry?.data || '').trim()) return entry;
    }
    return null;
  }

  async function openMolstarPubChemSearch(target, searchType) {
    if (searchType !== 'identity' && searchType !== 'similarity') throw new Error('Unsupported PubChem search type.');
    if (!molstarPubChemSearchAvailable(target)) throw new Error('PubChem search requires an unmodified molecule with an exact SDF structure.');
    const entry = molstarExactPubChemSdfEntry(target);
    const rdkit = await molstarPreviewInitRDKit();
    let molecule = null;
    try {
      molecule = rdkit.get_mol(String(entry?.data || ''));
      if (!molecule || (typeof molecule.is_valid === 'function' && !molecule.is_valid())) throw new Error('RDKit could not read the molecule.');
      const smiles = typeof molecule.get_smiles === 'function' ? String(molecule.get_smiles() || '').trim() : '';
      if (!validPubChemSmiles(smiles)) throw new Error('The molecule does not have a complete PubChem-searchable SMILES.');
      if (!postHostMessage({ type: 'openPubChemSearch', searchType, smiles })) throw new Error('PubChem search is unavailable in this host.');
    } finally {
      try { molecule?.delete?.(); } catch (_) {}
    }
  }

  function validPubChemSmiles(smiles) {
    const value = String(smiles || '').trim();
    return value.length > 0
      && value.length <= 4096
      && !value.includes('*')
      && !/[\u0000-\u001F\u007F]/u.test(value);
  }

  function molstarStandaloneMoleculePreviewEntryForTarget(target, entry = null) {
    if (!target || (target.scope !== 'ligand' && target.scope !== 'ion')) return null;
    if (normalizeFormat(entry?.format) === 'sdf') return null;
    const preview = molstarStandaloneMoleculePreviewTarget(activeConfig);
    const ligand = preview?.ligand || null;
    return normalizeFormat(ligand?.format) === 'sdf' ? ligand : null;
  }

  function molstarMoleculePreviewTargetForAction(action) {
    const selector = action?.selector || action?.args?.selector || null;
    const kind = String(selector?.kind || '').toLowerCase();
    if (kind && kind !== 'ligand' && kind !== 'ion') return null;
    const sourceEntry = molstarContextSourceEntryForActiveConfig();
    if (!sourceEntry) return null;
    const atom = {
      auth_comp_id: selector?.auth_comp_id ?? selector?.label_comp_id,
      label_comp_id: selector?.label_comp_id ?? selector?.auth_comp_id,
      auth_asym_id: selector?.auth_asym_id ?? selector?.label_asym_id,
      label_asym_id: selector?.label_asym_id ?? selector?.auth_asym_id,
      auth_seq_id: selector?.auth_seq_id ?? selector?.label_seq_id,
      label_seq_id: selector?.label_seq_id ?? selector?.auth_seq_id
    };
    if (!atom.auth_seq_id && !atom.label_seq_id) return null;
    const selectedEntry = pdbEntryForResidue(sourceEntry, atom);
    if (!selectedEntry) return null;
    const scope = kind === 'ion' ? 'ion' : 'ligand';
    const structures = molstarContextStructures();
    return {
      structures,
      structure: structures[0]?.structure || structures[0] || null,
      atom,
      label: molstarContextResidueLabel(atom),
      scope,
      sourceEntry,
      selectedEntry
    };
  }

  function molstarPreviewKey(entry) {
    return `${normalizeFormat(entry?.format)}:${String(entry?.data || '')}`;
  }

  function molstarMoleculePreviewResizeHandlesHTML() {
    return ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].map(direction =>
      `<span class="buret-molstar-molecule-preview-resize buret-molstar-molecule-preview-resize-${direction}" data-buret-molecule-preview-resize="${direction}" aria-hidden="true"></span>`
    ).join('');
  }

  function openMolstarMoleculePreviewInKetcher(target) {
    const entry = molstarMoleculePreviewEntry(target);
    const text = String(entry?.data || '').trim();
    if (!text) {
      setStatus('[web] This molecule has no structure text to open in Ketcher.', 'error');
      return;
    }
    const label = target?.label || entry?.label || 'ligand';
    const extension = normalizeFormat(entry?.format) || 'sdf';
    const title = `${label}.${extension}`;
    const ok = postHostMessage({
      type: 'openInKetcher',
      title,
      extension,
      textBase64: bytesToBase64(new TextEncoder().encode(text))
    });
    if (!ok) setStatus('[web] Ketcher is unavailable in this preview host.', 'error');
  }

  function installMolstarMoleculePreviewResize(popover) {
    if (!popover || popover.dataset.buretResizeInstalled === '1') return;
    popover.dataset.buretResizeInstalled = '1';
    const minWidth = 96;
    const minHeight = 126;
    const maxWidth = 560;
    const maxHeight = 520;
    const margin = 8;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const finish = (event) => {
      if (!molstarMoleculePreviewDrag || molstarMoleculePreviewDrag.popover !== popover) return;
      const drag = molstarMoleculePreviewDrag;
      try { popover.releasePointerCapture?.(molstarMoleculePreviewDrag.pointerId); } catch (_) {}
      popover.classList.remove('buret-molstar-molecule-preview-resizing');
      popover.classList.remove('buret-molstar-molecule-preview-moving');
      if (drag.moved) {
        molstarMoleculePreviewSuppressClickUntil = Date.now() + 450;
      } else if (drag.action === 'move') {
        molstarMoleculePreviewSuppressClickUntil = Date.now() + 450;
        openMolstarMoleculePreviewInKetcher(molstarMoleculePreviewTarget);
      }
      molstarMoleculePreviewDrag = null;
      event?.preventDefault?.();
    };
    popover.addEventListener('pointerdown', event => {
      const handle = event.target instanceof Element ? event.target.closest('[data-buret-molecule-preview-resize]') : null;
      if (handle && !popover.contains(handle)) return;
      if (event.button !== 0) return;
      const direction = handle?.getAttribute('data-buret-molecule-preview-resize') || '';
      const rect = popover.getBoundingClientRect();
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || rect.right + margin;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || rect.bottom + margin;
      molstarMoleculePreviewDrag = {
        popover,
        action: handle ? 'resize' : 'move',
        pointerId: event.pointerId,
        direction,
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        bottom: viewportHeight - rect.bottom,
        width: rect.width,
        height: rect.height,
        viewportWidth,
        viewportHeight,
        moved: false
      };
      popover.style.left = `${Math.round(rect.left)}px`;
      popover.style.bottom = `${Math.round(viewportHeight - rect.bottom)}px`;
      popover.style.right = 'auto';
      popover.style.top = 'auto';
      popover.style.width = `${Math.round(rect.width)}px`;
      popover.style.height = `${Math.round(rect.height)}px`;
      popover.classList.toggle('buret-molstar-molecule-preview-resizing', !!handle);
      popover.classList.toggle('buret-molstar-molecule-preview-moving', !handle);
      try { popover.setPointerCapture?.(event.pointerId); } catch (_) {}
      event.preventDefault();
      event.stopPropagation();
    });
    popover.addEventListener('pointermove', event => {
      const drag = molstarMoleculePreviewDrag;
      if (!drag || drag.popover !== popover || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      const direction = drag.direction;
      let left = drag.left;
      let bottom = drag.bottom;
      let width = drag.width;
      let height = drag.height;
      if (drag.action === 'move') {
        width = Math.min(width, drag.viewportWidth - margin * 2);
        height = Math.min(height, drag.viewportHeight - margin * 2);
        left = clamp(drag.left + dx, margin, drag.viewportWidth - margin - width);
        bottom = clamp(drag.bottom - dy, margin, drag.viewportHeight - margin - height);
      } else {
        if (direction.includes('e')) width = drag.width + dx;
        if (direction.includes('w')) width = drag.width - dx;
        if (direction.includes('n') || direction.includes('s')) height = drag.height - dy;
        const right = drag.left + drag.width;
        const maxAllowedWidth = direction.includes('w')
          ? Math.min(maxWidth, right - margin)
          : Math.min(maxWidth, drag.viewportWidth - margin - drag.left);
        const maxAllowedHeight = Math.min(maxHeight, drag.viewportHeight - margin - drag.bottom);
        width = clamp(width, minWidth, Math.max(minWidth, maxAllowedWidth));
        height = clamp(height, minHeight, Math.max(minHeight, maxAllowedHeight));
        if (direction.includes('w')) {
          left = clamp(right - width, margin, drag.viewportWidth - margin - width);
        }
      }
      popover.style.left = `${Math.round(left)}px`;
      popover.style.bottom = `${Math.round(bottom)}px`;
      popover.style.top = 'auto';
      popover.style.width = `${Math.round(width)}px`;
      popover.style.height = `${Math.round(height)}px`;
      event.preventDefault();
      event.stopPropagation();
    });
    popover.addEventListener('pointerup', finish);
    popover.addEventListener('pointercancel', finish);
    popover.addEventListener('click', event => {
      if (event.target instanceof Element && event.target.closest('[data-buret-molecule-preview-resize]')) return;
      if (Date.now() < molstarMoleculePreviewSuppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      openMolstarMoleculePreviewInKetcher(molstarMoleculePreviewTarget);
      event.preventDefault();
      event.stopPropagation();
    });
  }

  function molstarPreviewLoadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing && window.initRDKitModule) {
        resolve();
        return;
      }
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
  }

  async function molstarPreviewLoadRDKitScript() {
    const sources = [
      runtimeURL('BurreteRDKitJSURL', '../assets/rdkit/RDKit_minimal.js'),
      'rdkit/RDKit_minimal.js'
    ];
    let lastError = null;
    for (const src of sources) {
      if (!src) continue;
      try {
        await molstarPreviewLoadScript(src);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('RDKit_minimal.js is missing.');
  }

  function molstarPreviewRDKitWasmCandidates() {
    const candidates = [];
    const add = value => {
      const text = String(value || '').trim();
      if (text && !candidates.includes(text)) candidates.push(text);
    };
    add(window.BurreteConfig?.rdkitWasmPath);
    add(runtimeURL('BurreteRDKitWasmURL', ''));
    add('rdkit/RDKit_minimal.wasm');
    add('../assets/rdkit/RDKit_minimal.wasm');
    add('/__burette/rdkit-wasm');
    return candidates;
  }

  async function molstarPreviewLoadRDKitWasmBinary() {
    let lastError = null;
    for (const path of molstarPreviewRDKitWasmCandidates()) {
      try {
        const response = await fetch(path, { cache: 'force-cache' });
        if (!response.ok) throw new Error(`Failed to load RDKit wasm from ${path}: ${response.status} ${response.statusText}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!bytes.length) throw new Error(`Failed to load RDKit wasm from ${path}: empty response`);
        return bytes;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('RDKit_minimal.wasm is missing.');
  }

  async function molstarPreviewLoadRDKitWasmData() {
    if (window.BurreteRDKitWasmBase64) return;
    const dataURL = runtimeURL('BurreteRDKitWasmDataURL', '');
    if (!dataURL) return;
    await molstarPreviewLoadScript(dataURL);
  }

  function molstarPreviewRDKitWasmPath(file) {
    if (!String(file || '').endsWith('.wasm')) return file;
    return molstarPreviewRDKitWasmCandidates()[0] || 'rdkit/RDKit_minimal.wasm';
  }

  async function molstarPreviewInitRDKit() {
    if (molstarPreviewRdkit) return molstarPreviewRdkit;
    if (molstarPreviewRdkitPromise) return molstarPreviewRdkitPromise;
    molstarPreviewRdkitPromise = (async () => {
      if (typeof window.initRDKitModule !== 'function') {
        await molstarPreviewLoadRDKitScript();
      }
      if (typeof window.initRDKitModule !== 'function') throw new Error('RDKit_minimal.js is missing.');
      await molstarPreviewLoadRDKitWasmData();
      const options = { locateFile: molstarPreviewRDKitWasmPath };
      if (window.BurreteRDKitWasmBase64) {
        options.wasmBinary = base64ToBytes(window.BurreteRDKitWasmBase64);
        window.BurreteRDKitWasmBase64 = '';
      } else {
        options.wasmBinary = await molstarPreviewLoadRDKitWasmBinary();
      }
      molstarPreviewRdkit = await window.initRDKitModule(options);
      return molstarPreviewRdkit;
    })().finally(() => {
      molstarPreviewRdkitPromise = null;
    });
    return molstarPreviewRdkitPromise;
  }

  function molstarPreviewCleanRDKitSVG(svg) {
    return String(svg || '')
      .replace(/<script[\s\S]*?<\/script>/giu, '')
      .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/giu, '')
      .replace(/\sclip-path="url\([^"]+\)"/giu, '')
      .replace(/<svg([^>]*)>/iu, (_match, attrs) => {
        if (/style=/iu.test(attrs)) return `<svg${attrs}>`;
        return `<svg${attrs} style="width:100%;height:100%;display:block">`;
      });
  }

  function molstarPreviewParseMolblock2D(data) {
    const lines = String(data || '').replace(/\r\n/gu, '\n').replace(/\r/gu, '\n').split('\n');
    const countsIndex = lines.findIndex(line => /\bV2000\b/u.test(line));
    if (countsIndex < 0) return null;
    const countsLine = lines[countsIndex] || '';
    const countsTokens = countsLine.trim().split(/\s+/u);
    const atomCount = Number.parseInt(countsLine.slice(0, 3).trim() || countsTokens[0], 10);
    const bondCount = Number.parseInt(countsLine.slice(3, 6).trim() || countsTokens[1], 10);
    if (!Number.isFinite(atomCount) || atomCount <= 0 || atomCount > 512) return null;
    const atoms = [];
    for (let i = 0; i < atomCount; i++) {
      const line = lines[countsIndex + 1 + i] || '';
      const tokens = line.trim().split(/\s+/u);
      const x = Number.parseFloat(line.slice(0, 10).trim() || tokens[0]);
      const y = Number.parseFloat(line.slice(10, 20).trim() || tokens[1]);
      const z = Number.parseFloat(line.slice(20, 30).trim() || tokens[2]);
      const element = (line.slice(31, 34).trim() || tokens[3] || 'C').replace(/[^A-Za-z0-9+-]/gu, '') || 'C';
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      atoms.push({ x, y, z: Number.isFinite(z) ? z : 0, element });
    }
    const bonds = [];
    for (let i = 0; i < bondCount; i++) {
      const line = lines[countsIndex + 1 + atomCount + i] || '';
      const tokens = line.trim().split(/\s+/u);
      const a = Number.parseInt(line.slice(0, 3).trim() || tokens[0], 10) - 1;
      const b = Number.parseInt(line.slice(3, 6).trim() || tokens[1], 10) - 1;
      const order = Number.parseInt(line.slice(6, 9).trim() || tokens[2], 10);
      if (Number.isInteger(a) && Number.isInteger(b) && atoms[a] && atoms[b]) {
        bonds.push({ a, b, order: Number.isFinite(order) ? Math.max(1, Math.min(3, order)) : 1 });
      }
    }
    return { atoms, bonds };
  }

  function molstarPreviewAtomColor(element) {
    const key = String(element || '').toUpperCase();
    if (key === 'O') return '#ef3124';
    if (key === 'N') return '#3157d8';
    if (key === 'S') return '#d6c51d';
    if (key === 'P') return '#f28c28';
    if (key === 'F' || key === 'CL') return '#52b947';
    if (key === 'BR') return '#8f4b2e';
    if (key === 'I') return '#7442a8';
    if (key === 'H') return '#f7f7f7';
    return '#8f9499';
  }

  function molstarMoleculePreviewFallbackSVG(entry) {
    const parsed = molstarPreviewParseMolblock2D(entry?.data);
    if (!parsed?.atoms?.length) return '';
    const size = MOLSTAR_PREVIEW_RDKIT_SVG_SIZE;
    const pad = 18;
    let atoms = parsed.atoms;
    let minX = Math.min(...atoms.map(atom => atom.x));
    let maxX = Math.max(...atoms.map(atom => atom.x));
    let minY = Math.min(...atoms.map(atom => atom.y));
    let maxY = Math.max(...atoms.map(atom => atom.y));
    if (Math.abs(maxX - minX) < 0.001 && Math.abs(maxY - minY) < 0.001) {
      atoms = atoms.map((atom, index) => {
        const angle = (Math.PI * 2 * index) / Math.max(1, parsed.atoms.length);
        return { ...atom, x: Math.cos(angle), y: Math.sin(angle) };
      });
      minX = Math.min(...atoms.map(atom => atom.x));
      maxX = Math.max(...atoms.map(atom => atom.x));
      minY = Math.min(...atoms.map(atom => atom.y));
      maxY = Math.max(...atoms.map(atom => atom.y));
    }
    const width = Math.max(0.001, maxX - minX);
    const height = Math.max(0.001, maxY - minY);
    const scale = Math.min((size - pad * 2) / width, (size - pad * 2) / height);
    const dx = (size - width * scale) / 2;
    const dy = (size - height * scale) / 2;
    const point = atom => ({
      x: dx + (atom.x - minX) * scale,
      y: size - (dy + (atom.y - minY) * scale)
    });
    const bondLines = parsed.bonds.map(bond => {
      const a = point(atoms[bond.a]);
      const b = point(atoms[bond.b]);
      return `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="#4c5258" stroke-width="${Math.max(2, bond.order + 1)}" stroke-linecap="round" />`;
    }).join('');
    const atomNodes = atoms.map(atom => {
      const p = point(atom);
      const color = molstarPreviewAtomColor(atom.element);
      const label = escapeHTML(atom.element);
      return `<g><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="8.5" fill="${color}" stroke="#202326" stroke-width="1.5" /><text x="${p.x.toFixed(1)}" y="${(p.y + 3.5).toFixed(1)}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="8" font-weight="700" fill="#111">${label}</text></g>`;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" data-buret-rdkit-svg="fallback" style="width:100%;height:100%;display:block"><rect width="${size}" height="${size}" rx="14" fill="#fff"/>${bondLines}${atomNodes}</svg>`;
  }

  function molstarPreviewCacheSVG(key, svg) {
    molstarPreviewSvgCache.set(key, svg);
    while (molstarPreviewSvgCache.size > 64) molstarPreviewSvgCache.delete(molstarPreviewSvgCache.keys().next().value);
  }

  async function molstarMoleculePreviewRDKitSVG(entry) {
    if (normalizeFormat(entry?.format) !== 'sdf') return '';
    const key = molstarPreviewKey(entry);
    if (molstarPreviewSvgCache.has(key)) return molstarPreviewSvgCache.get(key);
    try {
      const rdkit = await molstarPreviewInitRDKit();
      let mol = null;
      try {
        const molblock = splitSdfRecords(String(entry.data || ''))[0] || String(entry.data || '');
        mol = rdkit.get_mol(molblock);
        if (!mol || (typeof mol.is_valid === 'function' && !mol.is_valid())) throw new Error('invalid molecule');
        try { mol.set_new_coords?.(); } catch (_) {}
        const svg = molstarPreviewCleanRDKitSVG(mol.get_svg(MOLSTAR_PREVIEW_RDKIT_SVG_SIZE, MOLSTAR_PREVIEW_RDKIT_SVG_SIZE));
        if (!svg.includes('<svg')) throw new Error('empty drawing');
        molstarPreviewCacheSVG(key, svg);
        return svg;
      } finally {
        try { mol?.delete?.(); } catch (_) {}
      }
    } catch (error) {
      debug(`RDKit molecule preview failed; using SVG fallback: ${error?.message || error}`);
      const fallback = molstarMoleculePreviewFallbackSVG(entry);
      if (!fallback) throw error;
      molstarPreviewCacheSVG(key, fallback);
      return fallback;
    }
  }

  function showMolstarMoleculePreview(target) {
    const entry = molstarMoleculePreviewEntry(target);
    if (normalizeFormat(entry?.format) !== 'sdf') {
      hideMolstarMoleculePreview();
      return;
    }
    const key = molstarPreviewKey(entry);
    const image = molstarPreviewSvgCache.get(key) || '';
    const label = target?.label || entry?.label || (target?.scope === 'ion' ? 'Ion' : 'Ligand');
    const subtitle = target?.scope === 'ion' ? 'Ion' : 'Small molecule';
    let popover = molstarMoleculePreview;
    molstarMoleculePreviewTarget = target || null;
    if (!popover) {
      popover = document.createElement('div');
      popover.className = 'buret-molstar-molecule-preview';
      popover.setAttribute('role', 'tooltip');
      popover.tabIndex = 0;
      installMolstarMoleculePreviewResize(popover);
      document.body.appendChild(popover);
      molstarMoleculePreview = popover;
    }
    popover.innerHTML = `
      <div class="buret-molstar-molecule-preview-image">${image || escapeHTML('Rendering 2D preview...')}</div>
      <div class="buret-molstar-molecule-preview-title">${escapeHTML(label)}</div>
      <div class="buret-molstar-molecule-preview-subtitle">${escapeHTML(subtitle)}</div>
      ${molstarMoleculePreviewResizeHandlesHTML()}`;
    popover.dataset.buretPreviewKey = key;
    void molstarMoleculePreviewRDKitSVG(entry)
      .then(svg => {
        if (!svg || !molstarMoleculePreview || molstarMoleculePreview.dataset.buretPreviewKey !== key) return;
        const imageEl = molstarMoleculePreview.querySelector('.buret-molstar-molecule-preview-image');
        if (imageEl) imageEl.innerHTML = svg;
      })
      .catch(() => {
        if (!image && molstarMoleculePreview?.dataset?.buretPreviewKey === key) {
          const imageEl = molstarMoleculePreview.querySelector('.buret-molstar-molecule-preview-image');
          if (imageEl) imageEl.textContent = '2D preview unavailable';
        }
      });
  }

  function molstarSelectionMoleculePreviewTarget() {
    const structures = molstarContextStructures();
    if (!structures.length) return null;
    const sourceEntry = molstarContextSourceEntryForActiveConfig();
    for (const structureRef of structures) {
      const structure = molstarStructureFromRef(structureRef) || structureRef;
      const loci = molstarContextSelectionLociForStructure(structureRef);
      const atom = molstarContextAtomFromLoci(loci);
      const scope = molstarContextScopeForAtom(atom);
      if (scope !== 'ligand' && scope !== 'ion') continue;
      const selectedEntry = sourceEntry ? pdbEntryForResidue(sourceEntry, atom) : null;
      return {
        structures: [structureRef],
        structure: structureRef,
        loci,
        atomLoci: molstarContextAtomLociForStructure(structure || loci?.structure, atom),
        atom,
        selectionBased: true,
        label: selectedEntry?.label || molstarContextResidueLabel(atom),
        scope,
        sourceEntry,
        selectedEntry
      };
    }
    return null;
  }

  function molstarSelectedMoleculePreviewTarget(target = null) {
    const resolved = target || molstarContextTarget();
    if (resolved?.scope === 'ligand' || resolved?.scope === 'ion') return resolved;
    if (resolved?.selectionBased && resolved.atom) {
      const scope = molstarContextScopeForAtom(resolved.atom);
      if (scope === 'ligand' || scope === 'ion') {
        return {
          ...resolved,
          scope,
          label: resolved.selectedEntry?.label || molstarContextResidueLabel(resolved.atom) || resolved.label
        };
      }
    }
    if (!target) return molstarSelectionMoleculePreviewTarget();
    return null;
  }

  function molstarSelectedMoleculeTargetFromSelection() {
    const target = molstarContextTargetIgnoringMenuPick();
    return target?.selectionBased ? molstarSelectedMoleculePreviewTarget(target) : null;
  }

  function showMolstarSelectedMoleculePreviewNow(target) {
    const resolved = molstarSelectedMoleculePreviewTarget(target);
    if (!molstarMoleculePreviewEntry(resolved)) return false;
    showMolstarMoleculePreview(resolved);
    return !!molstarMoleculePreview;
  }

  function showMolstarSelectedMoleculePreview(fallbackTarget = null) {
    const target = molstarSelectedMoleculePreviewTarget();
    if (target && showMolstarSelectedMoleculePreviewNow(target)) return true;
    if (fallbackTarget && showMolstarSelectedMoleculePreviewNow(fallbackTarget)) return true;
    return false;
  }

  function scheduleMolstarSelectedMoleculePreview(fallbackTarget = null) {
    const hasCandidate = Boolean(molstarSelectedMoleculePreviewTarget() || fallbackTarget);
    if (!hasCandidate) {
      hideMolstarMoleculePreview({ force: true });
      return;
    }
    if (showMolstarSelectedMoleculePreview(fallbackTarget)) return;
    if (molstarMoleculePreviewFrame) cancelAnimationFrame(molstarMoleculePreviewFrame);
    const showOrHide = () => {
      if (!showMolstarSelectedMoleculePreview(fallbackTarget)) hideMolstarMoleculePreview({ force: true });
    };
    molstarMoleculePreviewFrame = requestAnimationFrame(() => {
      molstarMoleculePreviewFrame = 0;
      if (showMolstarSelectedMoleculePreview(fallbackTarget)) return;
      setTimeout(showOrHide, 250);
      setTimeout(showOrHide, 900);
    });
  }

  function molstarMoleculePreviewIsActive() {
    if (!molstarMoleculePreview) return false;
    return molstarMoleculePreview.matches(':hover') ||
      molstarMoleculePreview.contains(document.activeElement);
  }

  function clearMolstarPersistentMoleculePreview() {
    hideMolstarMoleculePreview({ force: true });
  }

  function hideMolstarMoleculePreview(options = {}) {
    if (molstarMoleculePreviewFrame) {
      cancelAnimationFrame(molstarMoleculePreviewFrame);
      molstarMoleculePreviewFrame = 0;
    }
    if (!molstarMoleculePreview) return;
    molstarMoleculePreview.remove();
    molstarMoleculePreview = null;
    molstarMoleculePreviewTarget = null;
  }

  function hideMolstarContextMenu(options = {}) {
    document.querySelector('.buret-molecule-context-menu:not(.buret-xyzrender-context-menu)')?.remove();
    molstarContextMenuPick = null;
    if (options.keepMoleculePreview) return;
    scheduleMolstarSelectedMoleculePreview();
  }

  function showMolstarContextMenu(event, pick) {
    hideMolstarContextMenu({ keepMoleculePreview: true });
    molstarContextMenuPick = pick || null;
    const menuTarget = molstarContextTarget();
    if (!menuTarget.structures.length || menuTarget.scope === 'none') {
      hideMolstarContextMenu();
      return;
    }
    postHostMessage({
      type: 'mobileInspectorTarget',
      label: menuTarget.label || '',
      scope: menuTarget.scope || ''
    });
    let mode = menuTarget.scope === 'ligand' && menuTarget.atomLoci && molstarContextMenuMode === 'atom' ? 'atom' : 'molecule';
    if (showNativeMolstarContextMenu(menuTarget, mode)) {
      molstarContextMenuMode = mode;
      return;
    }
    const menu = document.createElement('div');
    menu.className = 'buret-molecule-context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Molecule actions');
    const title = document.createElement('div');
    title.className = 'buret-molecule-context-menu-title';
    title.textContent = 'Molecule actions';
    const subtitle = document.createElement('div');
    subtitle.className = 'buret-molecule-context-menu-subtitle';
    subtitle.textContent = menuTarget.label;
    menu.append(title, subtitle);
    const actionContainer = document.createElement('div');
    actionContainer.className = 'buret-molecule-context-menu-actions';
    const renderActions = () => {
      actionContainer.replaceChildren();
      molstarContextMenuActions(menuTarget, mode).forEach(([action, label]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('role', 'menuitem');
        button.dataset.buretMoleculeAction = action;
        button.textContent = label;
        button.addEventListener('click', () => { void moleculeContextMenuAction(action, label); });
        actionContainer.appendChild(button);
      });
    };
    if (menuTarget.scope === 'ligand' && menuTarget.atomLoci) {
      const modeGroup = document.createElement('div');
      modeGroup.className = 'buret-molecule-context-mode';
      modeGroup.dataset.mode = mode;
      modeGroup.setAttribute('role', 'group');
      modeGroup.setAttribute('aria-label', 'Ligand selection scope');
      [['molecule', 'Molecule'], ['atom', 'Atom']].forEach(([value, label]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'buret-molecule-context-mode-button';
        button.dataset.buretContextMode = value;
        button.textContent = label;
        button.setAttribute('aria-pressed', value === mode ? 'true' : 'false');
        button.addEventListener('click', () => {
          mode = value;
          molstarContextMenuMode = mode;
          modeGroup.dataset.mode = mode;
          modeGroup.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', item.dataset.buretContextMode === mode ? 'true' : 'false'));
          renderActions();
        });
        modeGroup.appendChild(button);
      });
      menu.appendChild(modeGroup);
    }
    renderActions();
    menu.appendChild(actionContainer);
    document.body.appendChild(menu);
    positionMolstarContextMenu(menu, event.clientX, event.clientY);
  }

  function installMolstarContextMenu(viewer) {
    if (molstarContextMenuCleanup) {
      molstarContextMenuCleanup();
      molstarContextMenuCleanup = null;
    }
    if (molstarSelectionPreviewCleanup) {
      molstarSelectionPreviewCleanup();
      molstarSelectionPreviewCleanup = null;
    }
    let contextPointer = null;
    let touchContextPointer = null;
    const menuIsOpen = () => !!document.querySelector('.buret-molecule-context-menu');
    const menuIsInAtomMode = () => menuIsOpen() && molstarContextMenuMode === 'atom';
    const clearMolstarHoverHighlights = () => {
      try { activeViewer?.plugin?.managers?.interactivity?.lociHighlights?.clearHighlights?.(); } catch (_) {}
    };
    const clearTouchContextPointer = () => {
      if (touchContextPointer?.timer) clearTimeout(touchContextPointer.timer);
      touchContextPointer = null;
    };
    const syntheticContextEvent = (pointer) => ({
      clientX: pointer.clientX,
      clientY: pointer.clientY,
      target: pointer.target,
      preventDefault() {},
      stopPropagation() {}
    });
    const selectAtomFromEvent = (event) => {
      const contextPick = molstarContextPickFromEvent(event, molstarContextTouchPickOptions(event));
      if (!contextPick) return false;
      molstarContextMenuPick = contextPick;
      const target = molstarContextTarget();
      if (target.scope !== 'ligand' || !target.atomLoci) return false;
      if (!selectMolstarContextPick({ ...target, loci: target.atomLoci }, { additive: true, applyGranularity: false })) return false;
      setStatus(`[web] Selected ${molstarContextAtomLabel(target)}.`);
      showMolstarContextMenu(event, contextPick);
      return true;
    };
    const openFromEvent = (event, picked = null) => {
      if (!viewer || (!picked && !isMolstarContextMenuTarget(event.target))) {
        hideMolstarContextMenu();
        return false;
      }
      const contextPick = picked || molstarContextPickFromEvent(event);
      if (!contextPick) {
        event.preventDefault();
        event.stopPropagation();
        hideMolstarContextMenu();
        return false;
      }
      event.preventDefault();
      event.stopPropagation();
      showMolstarContextMenu(event, contextPick);
      return true;
    };
    const onContextMenu = (event) => {
      if (menuIsOpen() && !contextPointer) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (contextPointer) {
        event.preventDefault();
        event.stopPropagation();
        if (!contextPointer.moved) return;
        hideMolstarContextMenu();
        contextPointer = null;
        return;
      }
      openFromEvent(event, contextPointer?.pick || null);
      contextPointer = null;
    };
    const onPointerDown = (event) => {
      beginMolstarEmptyClickSelectionPreserve(event);
      clearTouchContextPointer();
      if (event.button === 2) {
        if (!viewer || !isMolstarContextMenuTarget(event.target)) {
          contextPointer = null;
          hideMolstarContextMenu();
          return;
        }
        const contextPick = molstarContextPickFromEvent(event);
        if (!contextPick) {
          contextPointer = null;
          hideMolstarContextMenu();
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        contextPointer = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
          pick: contextPick
        };
        hideMolstarContextMenu();
        return;
      }
      if (molstarContextEventIsTouch(event) && event.isPrimary !== false && event.button === 0 && viewer && isMolstarContextMenuTarget(event.target)) {
        const pointer = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          clientX: event.clientX,
          clientY: event.clientY,
          target: event.target,
          moved: false,
          opened: false,
          timer: 0
        };
        pointer.timer = window.setTimeout(() => {
          if (touchContextPointer !== pointer || pointer.moved) return;
          const contextPick = molstarContextPickFromEvent(syntheticContextEvent(pointer), {
            radiusPx: MOLSTAR_TOUCH_PICK_RADIUS_PX,
            stepPx: MOLSTAR_TOUCH_PICK_STEP_PX
          });
          if (!contextPick) {
            clearTouchContextPointer();
            return;
          }
          pointer.opened = true;
          openFromEvent(syntheticContextEvent(pointer), contextPick);
        }, MOLSTAR_TOUCH_CONTEXT_MENU_DELAY_MS);
        touchContextPointer = pointer;
      }
      const target = event.target;
      if (target instanceof Element && target.closest('.buret-molecule-context-menu')) return;
      if (event.button === 0 && menuIsInAtomMode() && isMolstarContextMenuTarget(target)) {
        event.preventDefault();
        event.stopPropagation();
        if (selectAtomFromEvent(event)) return;
        return;
      }
      contextPointer = null;
      hideMolstarContextMenu();
    };
    const onPointerMove = (event) => {
      if (touchContextPointer && event.pointerId === touchContextPointer.pointerId) {
        touchContextPointer.clientX = event.clientX;
        touchContextPointer.clientY = event.clientY;
        if (!touchContextPointer.moved) {
          touchContextPointer.moved =
            Math.abs(event.clientX - touchContextPointer.startX) > MOLSTAR_TOUCH_CONTEXT_MENU_MOVE_THRESHOLD_PX ||
            Math.abs(event.clientY - touchContextPointer.startY) > MOLSTAR_TOUCH_CONTEXT_MENU_MOVE_THRESHOLD_PX;
        }
        if (touchContextPointer.moved) clearTouchContextPointer();
      }
      if (!contextPointer || event.pointerId !== contextPointer.pointerId) return;
      if (contextPointer.moved) return;
      contextPointer.moved =
        Math.abs(event.clientX - contextPointer.startX) > MOLSTAR_CONTEXT_MENU_DRAG_THRESHOLD_PX ||
        Math.abs(event.clientY - contextPointer.startY) > MOLSTAR_CONTEXT_MENU_DRAG_THRESHOLD_PX;
    };
    const onPointerUp = (event) => {
      finishMolstarEmptyClickSelectionPreserve(event);
      if (touchContextPointer && event.pointerId === touchContextPointer.pointerId) {
        const opened = touchContextPointer.opened;
        clearTouchContextPointer();
        if (opened) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
      if (!contextPointer || event.pointerId !== contextPointer.pointerId) return;
      if (contextPointer.moved) {
        hideMolstarContextMenu();
        contextPointer = null;
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      openFromEvent(event, contextPointer.pick);
      contextPointer = null;
    };
    const onPointerCancel = (event) => {
      if (touchContextPointer && event.pointerId === touchContextPointer.pointerId) clearTouchContextPointer();
      if (contextPointer && event.pointerId === contextPointer.pointerId) contextPointer = null;
    };
    const suppressAtomModeHover = (event) => {
      if (!menuIsInAtomMode()) return;
      if (Number(event.buttons || 0) !== 0) return;
      if (!isMolstarContextMenuTarget(event.target)) return;
      event.stopPropagation();
      clearMolstarHoverHighlights();
    };
    const showMoleculePreviewFromEvent = (event) => {
      const pick = molstarContextPickFromEvent(event);
      if (!pick) return false;
      const previewTarget = molstarContextTargetForPick(pick);
      if (previewTarget.scope !== 'ligand' && previewTarget.scope !== 'ion') return false;
      showMolstarMoleculePreview(previewTarget);
      return true;
    };
    const updateMoleculePreviewFromEvent = (event) => {
      if (event.target instanceof Element && event.target.closest('.buret-molstar-molecule-preview')) return;
      if (Number(event.buttons || 0) !== 0 || menuIsOpen() || !isMolstarContextMenuTarget(event.target)) {
        if (!molstarMoleculePreviewIsActive()) scheduleMolstarSelectedMoleculePreview();
        return;
      }
      if (molstarMoleculePreviewFrame) return;
      const clientX = event.clientX;
      const clientY = event.clientY;
      const target = event.target;
      molstarMoleculePreviewFrame = requestAnimationFrame(() => {
        molstarMoleculePreviewFrame = 0;
        const synthetic = { clientX, clientY, target };
        if (!showMoleculePreviewFromEvent(synthetic)) {
          if (!molstarMoleculePreviewIsActive()) scheduleMolstarSelectedMoleculePreview();
        }
      });
    };
    const hideMoleculePreviewFromEvent = (event) => {
      if (event.target instanceof Element && event.target.closest('.buret-molstar-molecule-preview')) return;
      scheduleMolstarSelectedMoleculePreview();
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        hideMolstarContextMenu();
        clearMolstarPersistentMoleculePreview();
      }
    };
    const onResize = () => {
      hideMolstarContextMenu();
      clearMolstarPersistentMoleculePreview();
    };
    document.addEventListener('contextmenu', onContextMenu, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerCancel, true);
    document.addEventListener('pointermove', suppressAtomModeHover, true);
    document.addEventListener('pointermove', updateMoleculePreviewFromEvent, true);
    document.addEventListener('pointerleave', hideMoleculePreviewFromEvent, true);
    document.addEventListener('mousemove', suppressAtomModeHover, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', hideMolstarMoleculePreview, true);
    molstarContextMenuCleanup = () => {
      document.removeEventListener('contextmenu', onContextMenu, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerCancel, true);
      document.removeEventListener('pointermove', suppressAtomModeHover, true);
      document.removeEventListener('pointermove', updateMoleculePreviewFromEvent, true);
      document.removeEventListener('pointerleave', hideMoleculePreviewFromEvent, true);
      document.removeEventListener('mousemove', suppressAtomModeHover, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', hideMolstarMoleculePreview, true);
      clearTouchContextPointer();
      hideMolstarContextMenu();
      clearMolstarPersistentMoleculePreview();
    };
  }

  function subscribeMolstarPreviewEvent(source, update, disposers) {
    if (!source || typeof source.subscribe !== 'function') return;
    try {
      const subscription = source.subscribe(update);
      disposers.push(() => subscription?.unsubscribe?.());
    } catch (error) {
      debug('Mol* selection preview subscription failed: ' + (error?.message || String(error)));
    }
  }

  function molstarSelectionAtomCount(target) {
    const entry = molstarMoleculePreviewEntry(target);
    const declared = Number(entry?.atomCount);
    if (Number.isFinite(declared) && declared > 0) return Math.min(1000000, Math.trunc(declared));
    const count = ligandAtomCoordinates(entry).length;
    return count > 0 ? Math.min(1000000, count) : null;
  }

  function notifyMolstarSelectionChanged(target) {
    const candidate = target && (target.scope === 'ligand' || target.scope === 'ion') ? target : null;
    const atomCount = candidate ? molstarSelectionAtomCount(candidate) : null;
    const contextDocument = candidate ? molstarContextDocumentPayload(candidate) : null;
    const selected = atomCount !== null && contextDocument ? candidate : null;
    const selector = selected
      ? selected.focus?.selector || (selected.atom
        ? molstarContextLigandSelector(selected.atom)
        : { kind: selected.scope })
      : null;
    const label = String(selected?.label || '').trim().slice(0, 256);
    const selection = selector ? {
      selector,
      label: label || (selected.scope === 'ion' ? 'Selected ion' : 'Selected ligand'),
      value: label,
      atoms: atomCount
    } : null;
    const signature = JSON.stringify(selection);
    if (signature === molstarSelectionHostSignature) return;
    molstarSelectionHostSignature = signature;
    postHostMessage({ type: 'selectionChanged', selection });
  }

  function installMolstarSelectionPreviewSync(viewer) {
    if (molstarSelectionPreviewCleanup) {
      try { molstarSelectionPreviewCleanup(); } catch (_) {}
      molstarSelectionPreviewCleanup = null;
    }
    const plugin = viewer?.plugin;
    if (!plugin) return;
    const update = () => {
      const target = molstarSelectedMoleculeTargetFromSelection();
      scheduleMolstarSelectedMoleculePreview(target);
      notifyMolstarSelectionChanged(target);
    };
    const disposers = [];
    const selectionEvents = plugin.managers?.structure?.selection?.events || {};
    const interactivityEvents = plugin.managers?.interactivity?.lociSelects?.events || {};
    [
      selectionEvents.changed,
      selectionEvents.add,
      selectionEvents.remove,
      selectionEvents.clear,
      interactivityEvents.changed,
      interactivityEvents.add,
      interactivityEvents.remove,
      interactivityEvents.clear
    ].forEach(event => subscribeMolstarPreviewEvent(event, update, disposers));
    ['pointerup', 'keyup'].forEach(eventName => {
      document.addEventListener(eventName, update, true);
      disposers.push(() => document.removeEventListener(eventName, update, true));
    });
    molstarSelectionPreviewCleanup = () => {
      disposers.forEach(dispose => {
        try { dispose(); } catch (_) {}
      });
    };
    update();
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
    const option = (key, fallback) => activeConfig?.[key] !== undefined ? !!activeConfig[key] : fallback;
    const numberOption = (key) => {
      const value = Number(activeConfig?.[key]);
      return Number.isFinite(value) && value > 0 ? value : undefined;
    };
    const stringOption = (key, allowed) => {
      const value = String(activeConfig?.[key] || '');
      return allowed.includes(value) ? value : undefined;
    };
    const pixelScale = numberOption('molstarPixelScale');
    const pickScale = numberOption('molstarPickScale');
    const resolutionMode = stringOption('molstarResolutionMode', ['auto', 'scaled', 'native']);
    return {
      // Keep the real Mol* application UI, not a minimal canvas-only preview.
      // This is intentionally close to https://molstar.org/viewer/: right controls,
      // sequence strip, import/session panels, toolbar buttons and full interactivity.
      layoutIsExpanded: true,
      layoutShowControls: option('layoutShowControls', true),
      layoutShowRemoteState: false,
      layoutShowSequence: option('layoutShowSequence', true),
      layoutShowLog: option('layoutShowLog', true),
      layoutShowLeftPanel: option('layoutShowLeftPanel', true),
      viewportShowReset: option('viewportShowReset', true),
      viewportShowScreenshotControls: option('viewportShowScreenshotControls', true),
      viewportShowControls: option('viewportShowControls', true),
      viewportShowExpand: false,
      viewportShowToggleFullscreen: false,
      viewportShowSelectionMode: option('viewportShowSelectionMode', true),
      // Keep the native Mol* top-left animation button on every Mol* screen. Do not remove.
      viewportShowAnimation: true,
      viewportShowTrajectoryControls: showTrajectoryControls,
      viewportShowSettings: option('viewportShowSettings', true),
      collapseLeftPanel: true,
      collapseRightPanel: true,
      pdbProvider: 'rcsb',
      emdbProvider: 'rcsb',
      preferWebgl1: option('molstarPreferWebgl1', true),
      disableAntialiasing: option('molstarDisableAntialiasing', true),
      ...(pixelScale !== undefined ? { pixelScale } : {}),
      ...(pickScale !== undefined ? { pickScale } : {}),
      ...(resolutionMode !== undefined ? { resolutionMode } : {}),
      viewportBackgroundColor: transparentBackground ? undefined : canvasBackgroundCSS(),
      powerPreference: String(activeConfig?.molstarPowerPreference || '') === 'default' || isQuickLookHost()
        ? 'default'
        : 'high-performance'
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

  function installMolstarContainerResizeObserver(viewer) {
    if (typeof ResizeObserver !== 'function') return null;
    const app = document.getElementById('app');
    if (!app) return null;
    let lastWidth = -1;
    let lastHeight = -1;
    const observer = new ResizeObserver(entries => {
      const entry = entries && entries[0];
      const rect = entry?.contentRect || app.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width === lastWidth && height === lastHeight) return;
      lastWidth = width;
      lastHeight = height;
      scheduleViewerResize(viewer, 20);
    });
    observer.observe(app);
    return () => observer.disconnect();
  }

  function disposeActiveMolstarViewer() {
    notifyMolstarSelectionChanged(null);
    molstarSelectionHostSignature = '';
    setMolstarStructureDirty(false);
    clearMolstarEditUndoHistory();
    resetXyzFrameOverlayState(activeViewer);
    const viewer = activeViewer || window.BurreteViewer || window.BuretteViewer;
    try { viewer?.plugin?.dispose?.(); } catch (_) {}
    if (molstarContainerResizeCleanup) {
      molstarContainerResizeCleanup();
      molstarContainerResizeCleanup = null;
    }
    if (molstarContextMenuCleanup) {
      molstarContextMenuCleanup();
      molstarContextMenuCleanup = null;
    }
    if (molstarWindowResizeHandler) {
      window.removeEventListener('resize', molstarWindowResizeHandler);
      molstarWindowResizeHandler = null;
    }
    if (burreteAgentActionPollTimer) {
      window.clearInterval(burreteAgentActionPollTimer);
      burreteAgentActionPollTimer = 0;
    }
    activeViewer = null;
    activeMolstarPrepared = null;
    trajectorySmoothingState = null;
    updateSdfPoseButton(null);
    activeMolstarCacheBuster = null;
    window.BurreteViewer = null;
    window.BuretteViewer = null;
  }

  async function startMolstar(config, cb) {
    disposeActiveMolstarViewer();
    activeSdfPoseMode = readSdfPoseMode(config);
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
    molstarContainerResizeCleanup = installMolstarContainerResizeObserver(viewer);
    applyViewerUIScale(viewer);
    initViewerKeyboardShortcuts(viewer);
    initBuretToolbar(viewer);
    installMolstarContextMenu(viewer);
    installMolstarSelectionPreviewSync(viewer);
    installLeftPanelVisibilityGuard();
    scheduleLayoutStateReapply(viewer);

    await waitForAnimationFrame();
    applyLayoutState(viewer);
    try { viewer.handleResize(); } catch (_) {}

    debug('before structureDataForMolstar: bytes=' + (window.BurreteDataBytes ? window.BurreteDataBytes.length : -1) + '; base64 chars=' + (window.BurreteDataBase64 ? window.BurreteDataBase64.length : -1));
    const prepared = structureDataForMolstar(config);
    activeMolstarCacheBuster = cb;
    debug('prepared format=' + prepared.format + '; data type=' + (prepared.data && prepared.data.constructor ? prepared.data.constructor.name : typeof prepared.data) + '; data length=' + (prepared.data ? prepared.data.length : -1));
    setStatus(`[web] Parsing structure…\n${prepared.label} (${describeFormat(prepared.format, config.binary)})`);

    await withTimeout(
      loadPreparedStructure(viewer, prepared),
      45000,
      `Mol* timed out while parsing/rendering ${prepared.label} as ${prepared.format}.`
    );
    applyLayoutState(viewer);
    scheduleLayoutStateReapply(viewer);
    if (!hasMolstarContextFocus(config)) {
      scheduleMolstarStructureFocus(viewer, { reason: 'initial-load', durationMs: 120 });
    }

    try {
      window.BurreteAgent?.notifyStructureLoaded?.({ viewer, plugin: viewer.plugin, config, prepared });
      postHostMessage({ type: 'agentReady', message: 'Burrete agent ready' });
    } catch (error) {
      debug('BurreteAgent notifyStructureLoaded failed: ' + (error && error.message || String(error)));
    }
    await applyMolstarContextFocus(config);
    notifyMolstarSelectionChanged(molstarSelectedMoleculePreviewTarget());
    void reportBurreteAgentState();
    startBurreteAgentActionPolling();
    trackMolstarOrientation(viewer, config);

    if (molstarWindowResizeHandler) window.removeEventListener('resize', molstarWindowResizeHandler);
    molstarWindowResizeHandler = () => scheduleViewerResize(viewer, 100);
    window.addEventListener('resize', molstarWindowResizeHandler);
    await waitForAnimationFrame();
    applyLayoutState(viewer);
    try { viewer.handleResize(); } catch (_) {}

    const stagedEntries = Array.isArray(config.stagedEntries) ? config.stagedEntries : [];
    if (stagedEntries.length > 0) {
      try {
        await loadStagedMolstarEntries(viewer, config, cb);
        if (!hasMolstarContextFocus(config)) {
          scheduleMolstarStructureFocus(viewer, { reason: 'staged-entries', durationMs: 120 });
        }
      } catch (error) {
        setStatus(`[web] Could not load staged solvent.\n\n${error?.message || String(error)}`, 'error');
        // eslint-disable-next-line no-console
        console.error(error);
        if (stagedEntries.some(entry => entry?.requiredForReady === true)) {
          throw error;
        }
      }
    }
    {
      const poseCount = Number(prepared?.poseCount || prepared?.sdfPoseRecordCount || prepared?.xyzFrameCount || config?.trajectoryFrameCount || 0);
      setStatus(`[web] Rendered ${config.label || 'structure'}`);
      setTimeout(() => hideStatus(molstarReadyPayload(config, prepared, {
        molstarStructureCount: currentMolstarStructureCount(viewer),
        poseCount,
        trajectoryFrameCount: Math.max(Number(config?.trajectoryFrameCount || 0), poseCount)
      })), isQuickLookHost() ? 0 : 700);
    }
  }

  async function start() {
    debug('viewer.js executed');
    setStatus('[web] Booting Burrete viewer JavaScript…');
    installDownloadExportBridge();

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
    if (renderer === 'xyzrender-external') {
      await startExternalArtifact(config);
      return;
    }

    await startMolstar(config, cb);
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
        if (!Number.isFinite(fx) || !Number.isFinite(fy) || !Number.isFinite(fz)) continue;
        if (haveCell) {
          [x, y, z] = fracToCart(fx, fy, fz, a, b, c, alpha, beta, gamma);
        } else {
          // Open Babel writes Cartesian coordinates under fractional tags when
          // exporting a molecule without a crystallographic unit cell.
          [x, y, z] = [fx, fy, fz];
        }
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

  function pdbAtomLine(serial, atom, options = {}) {
    const elem = cleanElement(atom.element);
    const atomName = (atom.label || elem).replace(/[^A-Za-z0-9]/gu, '').slice(0, 4) || elem;
    const compId = String(options.compId || 'MOL').replace(/[^A-Za-z0-9]/gu, '').toUpperCase().slice(0, 3).padStart(3, ' ');
    const chainId = String(options.chainId || 'A').replace(/[^A-Za-z0-9]/gu, '').slice(0, 1) || 'A';
    const seqId = Number.isFinite(Number(options.seqId)) ? Math.max(-999, Math.min(9999, Math.trunc(Number(options.seqId)))) : 1;
    return ['HETATM', String(serial).padStart(5, ' '), ' ', atomName.padStart(4, ' ').slice(0, 4), ' ', compId, ` ${chainId}`, String(seqId).padStart(4, ' '), '    ', atom.x.toFixed(3).padStart(8, ' '), atom.y.toFixed(3).padStart(8, ' '), atom.z.toFixed(3).padStart(8, ' '), '  1.00', ' 10.00', '          ', elem.padStart(2, ' ')].join('');
  }

  function showError(error) {
    const message = error && (error.stack || error.message) ? (error.stack || error.message) : String(error);
    const diagnostics = window.__BURRETE_HOSTED_MCP_WIDGET__ === true
      ? ''
      : '\n\nCheck: ./scripts/tail-log.sh';
    setStatus(`[web] Burrete web renderer failed to load this file.\n\n${message}${diagnostics}`, 'error');
    // eslint-disable-next-line no-console
    console.error(error);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => start().catch(showError));
  } else {
    start().catch(showError);
  }
})();
