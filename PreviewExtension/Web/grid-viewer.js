(() => {
  'use strict';

  const root = document.getElementById('app');
  const status = document.getElementById('status');
  const CARD_MIN_STORAGE_KEY = 'buret.grid.cardMin';
  const GRID_VIEW_MODE_STORAGE_KEY = 'buret.grid.viewMode';
  const TABLE_HIDDEN_COLUMNS_STORAGE_KEY = 'buret.grid.tableHiddenColumns';
  const CARD_RENDERER_STORAGE_KEY = 'buret.grid.cardRenderer';
  const RDKIT_USE_INPUT_COORDS_STORAGE_KEY = 'buret.grid.rdkitUseInputCoords';
  const CLUSTER_CUTOFF_STORAGE_KEY = 'buret.grid.clusterCutoff';
  const CONFORMER_VARIANT_STORAGE_KEY = 'buret.grid.conformerVariant';
  const MMFF_VARIANT_STORAGE_KEY = 'buret.grid.mmffVariant';
  const SEMIEMPIRICAL_METHOD_STORAGE_KEY = 'buret.grid.semiempiricalMethod';
  const CONFORMER_VARIANTS = ['DG', 'KDG', 'ETDG', 'ETDGv2', 'ETKDG', 'ETKDGv2', 'ETKDGv3', 'srETKDGv3'];
  const MMFF_VARIANTS = ['MMFF94', 'MMFF94s'];
  const SEMIEMPIRICAL_METHODS = ['RM1', 'AM1', 'PM3', 'PM6_SP', 'AM1_STAR'];
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
  const MIN_CARD_MIN = 86;
  const MAX_CARD_MIN = 360;
  const DEFAULT_CARD_MIN = 174;
  const RDKIT_SVG_SIZE = 260;
  const SVG_FIT_MIN_PADDING = 12;
  const SVG_FIT_PADDING_FRACTION = 0.08;
  const XYZRENDER_CARD_CONCURRENCY = 4;
  const GRID_LOAD_AHEAD_PX = 720;
  const RDKIT_CARD_ROOT_MARGIN = 900;
  const XYZRENDER_CARD_ROOT_MARGIN = '120px 0px';
  const XYZRENDER_CARD_BATCH_SIZE = 12;
  const XYZRENDER_CARD_BATCH_MIN_CONCURRENCY = 1;
  const XYZRENDER_CARD_BATCH_MAX_CONCURRENCY = 3;
  const XYZRENDER_CARD_BATCH_DELAY_MS = 16;
  const RDKIT_CARD_FRAME_BATCH = 6;
  const RDKIT_CARD_FRAME_BUDGET_MS = 8;
  const GRID_WINDOW_OVERSCAN_ROWS = 4;
  const GRID_MAX_WINDOW_ROWS = 18;
  const GRID_MIN_ESTIMATED_ROW_HEIGHT = 190;
  const TABLE_COLUMN_PICKER_LIMIT = 240;
  const TABLE_DEFAULT_COLUMN_WIDTH = 118;
  const TABLE_COLUMN_OVERSCAN_PX = 360;
  const RDKIT_SVG_CACHE_LIMIT = 220;
  const XYZRENDER_CARD_CACHE_LIMIT = 180;
  const STRUCTURE_DRAG_MIME = 'application/x-burrete-structure-paths';
  const state = {
    rdkit: null,
    rdkitError: '',
    all: Array.isArray(window.BurreteGridRecords) ? window.BurreteGridRecords : [],
    rows: [],
    totalRows: 0,
    recordsIndexed: 0,
    recordsTotalHint: null,
    indexReady: true,
    indexing: false,
    visibleCount: 0,
    renderedCount: 0,
    query: '',
    smarts: '',
    smartsError: '',
    smartsMatches: new Map(),
    sort: 'index',
    descriptorFilters: [],
    descriptorSort: null,
    showProperties: false,
    viewMode: storedGridViewMode(),
    tableColumnPanelOpen: false,
    tableFiltersOpen: false,
    tableColumnQuery: '',
    tableColumnVisibleLimit: TABLE_COLUMN_PICKER_LIMIT,
    tableHiddenColumns: storedStringSet(TABLE_HIDDEN_COLUMNS_STORAGE_KEY),
    tableColumnFilters: {},
    tableColumnCatalogCache: null,
    tableColumnPanelOutsideController: null,
    tableScrollLeft: 0,
    tableColumnScrollFrame: 0,
    remoteDescriptorIds: [],
    remoteAnalysisColumns: [],
    tableFilterTimer: 0,
    cardRenderer: storedCardRenderer(),
    xyzrenderPreset: null,
    rdkitUseInputCoords: storedBoolean(RDKIT_USE_INPUT_COORDS_STORAGE_KEY, false),
    cardMin: storedOptionalInteger(CARD_MIN_STORAGE_KEY, MIN_CARD_MIN, MAX_CARD_MIN),
    hiddenRows: new Set(),
    selected: new Set(),
    ketcherOpenPendingUntil: 0,
    selectionAnchorIndex: null,
    selectionKeydownHandler: null,
    svgCache: new Map(),
    rdkitCardQueue: [],
    rdkitCardRendering: false,
    rdkitCardPending: new Map(),
    rdkitCardSeq: 0,
    rdkitCardObserver: null,
    rdkitCardLazyJobs: new WeakMap(),
    rdkitCardLazyTargets: [],
    xyzrenderCardCache: new Map(),
    xyzrenderCardQueue: [],
    xyzrenderCardsRunning: 0,
    xyzrenderBatchesRunning: 0,
    xyzrenderBatchTimer: 0,
    xyzrenderCardSeq: 0,
    xyzrenderCardObserver: null,
    xyzrenderCardLazyJobs: new WeakMap(),
    xyzrenderCardLazyTargets: [],
    hostRequests: new Map(),
    remoteMode: false,
    remoteLoading: false,
    dirty: false,
    dirtyReason: '',
    undoStack: [],
    rowPatches: new Map(),
    insertedRows: [],
    indexPollTimer: null,
    requestSeq: 0,
    token: 0,
    rendering: false,
    pendingRender: false,
    pendingLoad: false,
    loadObserver: null,
    scrollHandler: null,
    resizeHandler: null,
    virtualFrame: 0,
    lastPerfMetricAt: 0,
    windowStart: 0,
    windowEnd: 0,
    estimatedColumnCount: 1,
    estimatedRowHeight: GRID_MIN_ESTIMATED_ROW_HEIGHT,
    estimatedGridGap: 10,
    contextMenuOutsideHandler: null,
    contextMenuKeyHandler: null,
    generating3d: false,
    conformerVariant: storedChoice(CONFORMER_VARIANT_STORAGE_KEY, CONFORMER_VARIANTS, 'ETKDGv3'),
    mmffVariant: storedChoice(MMFF_VARIANT_STORAGE_KEY, MMFF_VARIANTS, 'MMFF94s'),
    aligningPoses: false,
    evaluatingSemiempirical: false,
    semiempiricalMethod: storedChoice(SEMIEMPIRICAL_METHOD_STORAGE_KEY, SEMIEMPIRICAL_METHODS, 'RM1'),
    clustering: false,
    findingSimilar: false,
    exportingClusterRepresentatives: false,
    clusterCutoff: storedClusterCutoff(),
    tableMoleculePreview: null,
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

  function gridReadyPayload(cfg = config(), extra = {}) {
    const cards = root ? root.querySelectorAll('.buret-card').length : 0;
    const rdkitImages = root ? root.querySelectorAll('.buret-rdkit-card-image').length : 0;
    const rdkitPending = (root ? root.querySelectorAll('[data-buret-rdkit-card-key]').length : 0)
      + state.rdkitCardQueue.length
      + state.rdkitCardPending.size;
    const xyzrenderImages = root ? root.querySelectorAll('.buret-xyzrender-card-image').length : 0;
    const moleculeRowCount = state.rows.reduce((count, row) => (
      count + (String(row?.molblock || row?.smiles || '').trim() ? 1 : 0)
    ), 0);
    return {
      mode: 'grid2d',
      renderer: state.cardRenderer === 'xyzrender' ? 'xyzrender-grid' : 'rdkit',
      format: cfg?.format || '',
      sourceExtension: cfg?.sourceExtension || cfg?.format || '',
      rowCount: state.rows.length,
      moleculeRowCount,
      renderedCount: state.renderedCount,
      rdkitLoaded: Boolean(state.rdkit),
      rdkitImages,
      rdkitPending,
      xyzrenderImages,
      cards,
      ...extra
    };
  }

  function postGridReady(cfg = config(), extra = {}) {
    post('ready', 'ready', gridReadyPayload(cfg, extra));
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
      const opensCommandPalette = (commandKey && key === 'p') || (!commandKey && !event.altKey && key === '/');
      if (!opensCommandPalette && !togglesSidebar) return;
      event.preventDefault();
      post(togglesSidebar ? 'toggleSidebar' : 'openCommandPalette');
    }, true);
  }

  initShellShortcutBridge();

  function nowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  function emitGridPerfMetric(cfg, phase, startedAt, payload = {}) {
    if (!cfg || cfg.appViewer !== true) return;
    const now = nowMs();
    const elapsedMs = Math.max(0, now - Number(startedAt || now));
    if (!payload.force && phase === 'window-render' && now - state.lastPerfMetricAt < 500) return;
    state.lastPerfMetricAt = now;
    post('gridPerfMetric', '[grid] Performance metric.', {
      phase,
      renderer: state.cardRenderer,
      remoteMode: state.remoteMode,
      elapsedMs: Math.round(elapsedMs * 10) / 10,
      rowsLoaded: state.rows.length,
      totalRows: state.totalRows,
      renderedCount: state.renderedCount,
      windowStart: state.windowStart,
      windowEnd: state.windowEnd,
      cards: root ? root.querySelectorAll('.buret-card').length : 0,
      rdkitImages: root ? root.querySelectorAll('.buret-rdkit-card-image').length : 0,
      xyzrenderImages: root ? root.querySelectorAll('.buret-xyzrender-card-image').length : 0,
      domNodes: root ? root.getElementsByTagName('*').length : 0,
      scrollY: Math.round(window.scrollY || document.documentElement.scrollTop || 0),
      ...payload
    });
  }

  function setStatus(message, kind = 'info') {
    const cfg = window.BurreteConfig && typeof window.BurreteConfig === 'object' ? window.BurreteConfig : {};
    if (status) {
      setStatusText(String(message || ''));
      status.classList.toggle('error', kind === 'error');
      status.classList.toggle('hidden', kind !== 'error' && !window.BurreteDebug);
      if (kind === 'error' && status && !window.BurreteDebug && cfg.appViewer === true) status.classList.add('hidden');
    }
    if (kind === 'error' || window.BurreteDebug) post(kind === 'error' ? 'error' : 'status', message || '');
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

  function config() {
    if (!window.BurreteConfig || typeof window.BurreteConfig !== 'object') {
      throw new Error('preview-config.js did not define window.BurreteConfig.');
    }
    return window.BurreteConfig;
  }

  function capabilities(cfg) {
    const caps = cfg.capabilities || {};
    const molecularGrid = effectiveMolecularGrid(cfg);
    return {
      selection: !!caps.selection,
      export: !!caps.export,
      substructureSearch: molecularGrid && !!caps.substructureSearch,
      ketcherOpen: cfg.appViewer === true && !!caps.rendererSwitch,
      rendererSwitch: molecularGrid && (cfg.appViewer === true || cfg.quickLookViewer === true) && !!caps.rendererSwitch,
      cluster: molecularGrid && cfg.appViewer === true && cfg.gridDataMode === 'bridge'
    };
  }

  function rowHasMolecule(row) {
    return !!String(row?.smiles || '').trim() || !!String(row?.molblock || '').trim();
  }

  function effectiveMolecularGrid(cfg) {
    if (state.remoteMode) return true;
    return state.all.some(rowHasMolecule);
  }

  function isRemoteMode(cfg) {
    return cfg.appViewer === true && cfg.gridDataMode === 'bridge' && !Array.isArray(window.BurreteGridRecords);
  }

  function installHostMessageListener() {
    window.addEventListener('message', event => {
      const data = event.data;
      if (!data || (data.source !== 'burrete-grid-host' && data.source !== 'burrete-host')) return;
      const body = data.body || {};
      if (body.type === 'workspaceHistoryCommand') {
        const direction = body.direction === 'redo' ? 'redo' : 'undo';
        let handled = false;
        if (direction === 'undo' && state.undoStack.length) {
          undoLastGridEdit(config());
          handled = true;
        }
        event.source?.postMessage({
          source: 'burrete-grid',
          body: {
            type: 'workspaceHistoryCommandResult',
            requestId: body.requestId,
            handled
          }
        }, '*');
        return;
      }
      if (body.type === 'gridRecordsAppended') {
        state.hiddenRows.clear();
        state.selected.clear();
        state.svgCache.clear();
        state.xyzrenderCardCache.clear();
        markGridDirty('appended molecules');
        setStatus(`[grid] Added ${Number(body.recordsAppended || 0).toLocaleString()} molecule${Number(body.recordsAppended || 0) === 1 ? '' : 's'}.`);
        void refreshRemote(config());
        return;
      }
      if (body.type === 'gridAppendRecords') {
        void appendGridRecordsFromHost(body, config());
        return;
      }
      if (body.type === 'gridDescriptorControls') {
        applyDescriptorGridControls(body, config());
        return;
      }
      if (body.type === 'gridDescriptorResults') {
        applyDescriptorGridResults(body, config());
        return;
      }
      if (body.type === 'gridGenerate3DStarted') {
        setGridGenerate3DPending(true);
        setStatus('[grid] Generating 3D conformers.');
        return;
      }
      if (body.type === 'gridAlignmentStarted') {
        state.aligningPoses = true;
        refreshGridControls(config());
        setStatus('[grid] Aligning and scoring selected poses on Metal.');
        return;
      }
      if (body.type === 'gridAlignmentFinished') {
        state.aligningPoses = false;
        refreshGridControls(config());
        void refreshRemote(config());
        return;
      }
      if (body.type === 'gridAlignmentError') {
        state.aligningPoses = false;
        refreshGridControls(config());
        setStatus(body.error || '[grid] Pose alignment failed.', 'error');
        return;
      }
      if (body.type === 'gridSemiempiricalStarted') {
        state.evaluatingSemiempirical = true;
        refreshGridControls(config());
        setStatus('[grid] Calculating RM1 energies and atomic charges; execution provenance will identify Metal or CPU fallback.');
        return;
      }
      if (body.type === 'gridSemiempiricalFinished') {
        state.evaluatingSemiempirical = false;
        refreshGridControls(config());
        void refreshRemote(config());
        return;
      }
      if (body.type === 'gridSemiempiricalError') {
        state.evaluatingSemiempirical = false;
        refreshGridControls(config());
        setStatus(body.error || '[grid] RM1 evaluation failed.', 'error');
        return;
      }
      if (body.type === 'gridGenerate3DFinished') {
        setGridGenerate3DPending(false);
        return;
      }
      if (body.type === 'gridGenerate3DError') {
        setGridGenerate3DPending(false);
        setStatus(body.error || '[grid] 3D generation failed.', 'error');
        return;
      }
      if (body.type === 'gridClusterStarted') {
        setGridClusteringPending(true);
        setStatus('[grid] Preparing immutable clustering inputs.');
        return;
      }
      if (body.type === 'gridClusterProgress') {
        setGridClusteringPending(true);
        const completed = Number(body.completedRecords || 0);
        const total = Number(body.totalRecords || 0);
        if (body.phase === 'fingerprints' && total > 0) {
          setStatus(`[grid] Fingerprints ${completed.toLocaleString()} / ${total.toLocaleString()}.`);
        } else if (body.phase === 'similarity') {
          setStatus('[grid] Building blockwise Tanimoto neighbors and Butina clusters.');
        } else if (body.phase === 'publishing') {
          setStatus('[grid] Publishing verified cluster results.');
        }
        return;
      }
      if (body.type === 'gridClusterFinished') {
        setGridClusteringPending(false);
        const backend = body.backend === 'nativeMetal' ? 'Metal GPU' : 'reference CPU';
        const clusterCount = Number(body.clusterCount || 0);
        const failed = Number(body.failedRecords || 0);
        const warning = String(body.gridWarning || '').trim();
        setStatus(
          warning
            ? `[grid] Created ${clusterCount.toLocaleString()} clusters via ${backend}; Grid writeback warning: ${warning}`
            : `[grid] Created ${clusterCount.toLocaleString()} clusters via ${backend}${failed ? `; ${failed.toLocaleString()} fingerprint failures` : ''}.`,
          warning ? 'error' : 'info'
        );
        if (body.gridApplied === true) void refreshRemote(config());
        return;
      }
      if (body.type === 'gridClusterError') {
        setGridClusteringPending(false);
        setStatus(body.error || '[grid] Clustering failed.', 'error');
        return;
      }
      if (body.type === 'gridSimilaritySearchStarted') {
        setGridSimilaritySearchPending(true);
        setStatus('[grid] Scoring the verified fingerprint library against the selected query.');
        return;
      }
      if (body.type === 'gridSimilaritySearchFinished') {
        setGridSimilaritySearchPending(false);
        const backend = body.backend === 'nativeMetal' ? 'Metal GPU' : 'reference CPU';
        const displayed = Array.isArray(body.matches) ? body.matches.length : 0;
        const qualified = Number(body.qualifiedMatchCount || displayed);
        const library = Number(body.validRecordCount || body.libraryRecordCount || 0);
        const warning = String(body.gridWarning || '').trim();
        setStatus(
          warning
            ? `[grid] Found ${displayed.toLocaleString()} displayed matches via ${backend}; Grid writeback warning: ${warning}`
            : `[grid] Found ${displayed.toLocaleString()} displayed match${displayed === 1 ? '' : 'es'} via ${backend} from ${library.toLocaleString()} valid molecules${qualified > displayed ? `; ${qualified.toLocaleString()} passed the cutoff` : ''}.`,
          warning ? 'error' : 'info'
        );
        if (body.gridApplied === true) void refreshRemote(config());
        return;
      }
      if (body.type === 'gridSimilaritySearchError') {
        setGridSimilaritySearchPending(false);
        setStatus(body.error || '[grid] Similarity search failed.', 'error');
        return;
      }
      if (body.type === 'gridClusterRepresentativesExportStarted') {
        setGridClusterRepresentativeExportPending(true);
        setStatus('[grid] Preparing an immutable diverse-representative bundle.');
        return;
      }
      if (body.type === 'gridClusterRepresentativesExportFinished') {
        setGridClusterRepresentativeExportPending(false);
        const count = Number(body.representativeCount || 0);
        const bundlePath = String(body.bundlePath || '').trim();
        setStatus(
          `[grid] Exported ${count.toLocaleString()} diverse representative${count === 1 ? '' : 's'}${bundlePath ? ` to ${bundlePath}` : ''}.`,
          'info'
        );
        return;
      }
      if (body.type === 'gridClusterRepresentativesExportCancelled') {
        setGridClusterRepresentativeExportPending(false);
        setStatus('[grid] Diverse-representative export cancelled.');
        return;
      }
      if (body.type === 'gridClusterRepresentativesExportError') {
        setGridClusterRepresentativeExportPending(false);
        setStatus(body.error || '[grid] Diverse-representative export failed.', 'error');
        return;
      }
      if (body.type === 'poseReviewSelection') {
        selectPoseReviewRow(body.activePose, config());
        return;
      }
      if (body.type === 'gridSavedAs') {
        markGridClean();
        setStatus(`[grid] Saved as ${body.name || 'collection file'}.`);
        updateChrome(config());
        return;
      }
      if (body.type === 'gridSaveAsError') {
        setStatus(body.error || '[grid] Save As failed.', 'error');
        return;
      }
      if (body.type === 'gridSaved') {
        markGridClean();
        setStatus(`[grid] Saved ${body.name || 'collection file'}.`);
        updateChrome(config());
        return;
      }
      if (body.type === 'gridSaveError') {
        setStatus(body.error || '[grid] Save failed.', 'error');
        return;
      }
      if (body.type === 'gridApplyKetcherRow') {
        applyKetcherGridRow(body, config());
        return;
      }
      if (body.type === 'gridMoleculeExported') {
        setStatus(`[grid] Exported ${body.name || 'molecule file'}.`);
        return;
      }
      if (body.type === 'gridMoleculeExportError') {
        setStatus(body.error || '[grid] Export molecule failed.', 'error');
        return;
      }
      const requestId = String(body.requestId || '');
      if (!requestId || !state.hostRequests.has(requestId)) return;
      const pending = state.hostRequests.get(requestId);
      state.hostRequests.delete(requestId);
      try { clearTimeout(pending.timeoutId); } catch (_) {}
      if (body.type === 'gridPage' || body.type === 'xyzrenderCard') pending.resolve(body.result || {});
      else if (body.type === 'structureText') pending.resolve({ text: String(body.text || '') });
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

  function applyGridPageState(result) {
    state.totalRows = Number(result.totalRows || 0);
    state.recordsIndexed = Number(result.recordsIndexed || state.totalRows || 0);
    state.recordsTotalHint = result.recordsTotalHint == null ? null : Number(result.recordsTotalHint || 0);
    state.indexReady = result.indexReady !== false;
    state.indexing = result.indexing === true || !state.indexReady;
    state.remoteDescriptorIds = Array.isArray(result.descriptorIds) ? result.descriptorIds.map(String) : [];
    state.remoteAnalysisColumns = Array.isArray(result.analysisColumns)
      ? result.analysisColumns.filter(column => column && typeof column === 'object')
      : [];
  }

  function scheduleIndexPoll(cfg) {
    if (!state.remoteMode || !state.indexing || state.indexPollTimer) return;
    state.indexPollTimer = window.setTimeout(() => {
      state.indexPollTimer = null;
      if (state.indexing) void loadMoreRemote(cfg);
    }, 500);
  }

  async function initRDKit() {
    if (state.rdkit) return state.rdkit;
    if (typeof window.initRDKitModule !== 'function') {
      throw new Error('RDKit_minimal.js is missing. Run bun run vendor:rdkit and rebuild.');
    }
    setStatus('[grid] Loading RDKit.js...');
    const cfg = config();
    const wasmPaths = rdkitWasmCandidates(cfg);
    let wasmPath = wasmPaths[0] || '../assets/rdkit/RDKit_minimal.wasm';
    const options = { locateFile: () => wasmPath };
    if (window.BurreteRDKitWasmBase64) {
      options.wasmBinary = base64ToBytes(window.BurreteRDKitWasmBase64);
      window.BurreteRDKitWasmBase64 = '';
    } else if (wasmPaths.length) {
      const loaded = await loadFirstWasmBinary(wasmPaths);
      wasmPath = loaded.path;
      options.locateFile = () => wasmPath;
      options.wasmBinary = loaded.bytes;
    }
    state.rdkit = await window.initRDKitModule(options);
    return state.rdkit;
  }

  function rdkitWasmCandidates(cfg) {
    const paths = [];
    const push = value => {
      const path = String(value || '').trim();
      if (path && !paths.includes(path)) paths.push(path);
    };
    push(cfg.rdkitWasmPath);
    push(rdkitWasmAssetURLFromLocation());
    try {
      push(new URL('../assets/rdkit/RDKit_minimal.wasm', window.location.href).href);
    } catch (_) {}
    push('../assets/rdkit/RDKit_minimal.wasm');
    return paths;
  }

  function rdkitWasmAssetURLFromLocation() {
    const prefix = 'asset://localhost/';
    const href = String(window.location.href || '');
    if (!href.startsWith(prefix)) return '';
    const encodedPath = href.slice(prefix.length).split(/[?#]/u)[0];
    let filePath = '';
    try {
      filePath = decodeURIComponent(encodedPath);
    } catch (_) {
      return '';
    }
    const assetPath = filePath.replace(/\/viewer\/[^/]+\/index\.html$/u, '/viewer/assets/rdkit/RDKit_minimal.wasm');
    if (assetPath === filePath) return '';
    return `${prefix}${encodeURIComponent(assetPath)}`;
  }

  async function loadFirstWasmBinary(paths) {
    let lastError = null;
    for (const path of paths) {
      try {
        return { path, bytes: await loadWasmBinary(path) };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('Failed to load RDKit wasm.');
  }

  async function loadWasmBinary(path) {
    let response;
    try {
      response = await fetch(String(path));
    } catch (error) {
      try {
        return await loadWasmBinaryViaXHR(path);
      } catch (xhrError) {
        const message = xhrError && xhrError.message ? xhrError.message : String(error);
        throw new Error(`Failed to fetch RDKit wasm from ${path}: ${message}`);
      }
    }
    if (!response.ok) {
      throw new Error(`Failed to load RDKit wasm from ${path}: ${response.status} ${response.statusText}`.trim());
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  function loadWasmBinaryViaXHR(path) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('GET', String(path), true);
      request.responseType = 'arraybuffer';
      request.onload = () => {
        if ((request.status >= 200 && request.status < 300) || (request.status === 0 && request.response)) {
          resolve(new Uint8Array(request.response));
          return;
        }
        reject(new Error(`${request.status} ${request.statusText}`.trim()));
      };
      request.onerror = () => reject(new Error('XHR load failed'));
      request.send();
    });
  }

  function base64ToBytes(value) {
    const binary = atob(String(value || ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function loadBatchSize(cfg) {
    const value = Number(cfg.pageSize || 720);
    return Number.isFinite(value) ? Math.max(12, Math.min(1000, Math.floor(value))) : 720;
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

  function storedGridViewMode() {
    try {
      return window.localStorage?.getItem(GRID_VIEW_MODE_STORAGE_KEY) === 'table' ? 'table' : 'cards';
    } catch (_) {
      return 'cards';
    }
  }

  function storedChoice(key, choices, fallback) {
    try {
      const value = window.localStorage?.getItem(key);
      return choices.includes(value) ? value : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function storedStringSet(key) {
    try {
      const raw = window.localStorage?.getItem(key);
      const values = JSON.parse(raw || '[]');
      return new Set(Array.isArray(values) ? values.map(value => String(value || '')).filter(Boolean) : []);
    } catch (_) {
      return new Set();
    }
  }

  function storeStringSet(key, values) {
    try {
      window.localStorage?.setItem(key, JSON.stringify([...values].sort()));
    } catch (_) {}
  }

  function supportsXyzrenderCards(cfg) {
    return cfg?.appViewer === true && (
      cfg?.gridDataMode === 'bridge'
      || (typeof cfg?.xyzrenderEndpoint === 'string' && cfg.xyzrenderEndpoint.trim().length > 0)
    );
  }

  function normalizeCardRenderer(cfg) {
    if (!effectiveMolecularGrid(cfg)) {
      state.cardRenderer = 'rdkit';
      return;
    }
    if (state.cardRenderer !== 'xyzrender' || supportsXyzrenderCards(cfg)) return;
    state.cardRenderer = 'rdkit';
    store(CARD_RENDERER_STORAGE_KEY, 'rdkit');
  }

  function normalizeGridViewMode(cfg) {
    if (effectiveMolecularGrid(cfg)) return;
    state.viewMode = 'table';
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

  function storedClusterCutoff() {
    try {
      const value = Number(window.localStorage?.getItem(CLUSTER_CUTOFF_STORAGE_KEY));
      return [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9].includes(value) ? value : 0.7;
    } catch (_) {
      return 0.7;
    }
  }

  function setClusterCutoff(value) {
    const cutoff = Number(value);
    if (![0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9].includes(cutoff)) return;
    state.clusterCutoff = cutoff;
    store(CLUSTER_CUTOFF_STORAGE_KEY, cutoff);
    syncGridClusterControls();
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
    if (background === 'graphite') return '#111111';
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
        <div id="grid-controls"></div>
        <nav class="buret-grid-rail" data-buret-grid-rail aria-label="Molecule navigation">
          <span class="buret-grid-rail-active-marker" data-buret-grid-rail-active aria-hidden="true"></span>
          <div class="buret-grid-rail-ticks" data-buret-grid-rail-ticks></div>
          <div class="buret-grid-rail-popover" data-buret-grid-rail-popover hidden>
            <div class="buret-grid-rail-popover-index" data-buret-grid-rail-popover-index></div>
            <div class="buret-grid-rail-popover-name" data-buret-grid-rail-popover-name></div>
          </div>
        </nav>
        <main id="grid" class="buret-grid"></main>
        <div id="load-sentinel" class="buret-load-sentinel" aria-hidden="true"></div>
        <footer id="footer" class="buret-grid-footer"></footer>
      </section>`;
    mountGridControls(cfg, caps);
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
    applyGridPreferences(cfg);
    initGridRail(cfg);
    initInfiniteLoading(cfg);
  }

  function mountGridControls(cfg, caps) {
    const host = document.getElementById('grid-controls');
    if (!host || !window.BurreteGridUI || typeof window.BurreteGridUI.mountGridControls !== 'function') {
      throw new Error('BurreteGridUI is missing. Ensure grid-ui.js loads before grid-viewer.js.');
    }
    window.BurreteGridUI.mountGridControls(host, {
      format: ['csv', 'dwar', 'sdf', 'smiles', 'tsv'].includes(cfg.format) ? cfg.format : 'smiles',
      label: cfg.label || 'Molecule collection',
      exportEnabled: caps.export,
      selectionEnabled: caps.selection,
      substructureSearch: caps.substructureSearch,
      supportsXyzrenderCards: supportsXyzrenderCards(cfg),
      viewMode: state.viewMode,
      cardRenderer: state.cardRenderer,
      xyzrenderPreset: currentXyzrenderPreset(cfg),
      xyzrenderPresetOptions: xyzrenderPresetOptions(cfg),
      ketcherOpen: caps.ketcherOpen,
      rendererSwitch: caps.rendererSwitch,
      generating3d: state.generating3d,
      conformerVariant: state.conformerVariant,
      mmffVariant: state.mmffVariant,
      aligningPoses: state.aligningPoses,
      evaluatingSemiempirical: state.evaluatingSemiempirical,
      semiempiricalEnabled: caps.cluster,
      semiempiricalMethod: state.semiempiricalMethod,
      clusterEnabled: caps.cluster,
      clustering: state.clustering,
      findingSimilar: state.findingSimilar,
      exportingClusterRepresentatives: state.exportingClusterRepresentatives,
      clusterRepresentativesAvailable: Boolean(latestRepresentativeAnalysisColumn()),
      similarityQuerySelected: state.selected.size === 1,
      clusterCutoff: state.clusterCutoff,
      sortOptions: propertyOptionList(cfg),
      onSearchInput(value) {
        setUnifiedSearchQuery(value || '', cfg);
        refresh(cfg);
      },
      onSortChange(value) {
        state.sort = value || 'index';
        refresh(cfg);
      },
      onShowProperties() {
        state.showProperties = !state.showProperties;
        applyGridPreferences(cfg);
      },
      onClearSmarts() {
        state.query = '';
        state.smarts = '';
        const input = document.getElementById('search');
        if (input) input.value = '';
        refresh(cfg);
        input?.focus();
      },
      onSelectAll() { selectAllRows(cfg); },
      onClearSelection() { clearSelection(cfg); },
      onCluster() { requestClustering(cfg); },
      onFindSimilar() { requestSimilaritySearch(cfg); },
      onExportClusterRepresentatives() { requestClusterRepresentativeExport(cfg); },
      onClusterCutoffChange(value) { setClusterCutoff(value); },
      onCopySelected() { copySelected(); },
      onSaveGrid() { saveGrid(cfg); },
      onSaveGridAs() { saveGridAs(cfg); },
      onUndoGridEdit() { undoLastGridEdit(cfg); },
      onExportSmiles() { exportSmiles(cfg); },
      onExportCSV() { exportCSV(cfg); },
      onViewModeChange(value) { setGridViewMode(value, cfg); },
      onToggleTableColumns() { toggleTableColumnPanel(cfg); },
      onToggleTableFilters() { toggleTableFilters(cfg); },
      onSetCardRenderer(value) { setCardRenderer(value, cfg); },
      onXyzrenderPresetChange(value) { setXyzrenderPreset(value, cfg); },
      onOpenKetcher() { requestSelectedKetcherDocument(cfg); },
      onAlignSelectedPoses() { requestSelectedPoseAlignment(cfg); },
      onEvaluateSemiempirical() { requestSelectedSemiempiricalEvaluation(cfg); },
      onSemiempiricalMethodChange(value) {
        state.semiempiricalMethod = SEMIEMPIRICAL_METHODS.includes(value) ? value : 'RM1';
        store(SEMIEMPIRICAL_METHOD_STORAGE_KEY, state.semiempiricalMethod);
        refreshGridControls(cfg);
      },
      onGenerate3D() { requestSelected3DGeneration(cfg); },
      onOptimizeGeometry() { requestSelectedGeometryOptimization(cfg); },
      onConformerVariantChange(value) {
        state.conformerVariant = CONFORMER_VARIANTS.includes(value) ? value : 'ETKDGv3';
        store(CONFORMER_VARIANT_STORAGE_KEY, state.conformerVariant);
        refreshGridControls(cfg);
      },
      onMmffVariantChange(value) {
        state.mmffVariant = MMFF_VARIANTS.includes(value) ? value : 'MMFF94s';
        store(MMFF_VARIANT_STORAGE_KEY, state.mmffVariant);
        refreshGridControls(cfg);
      },
      onCalculateSelectedDescriptors() { requestSelectedDescriptorCalculation(cfg); },
      onRendererSwitch(value) { requestRendererSwitch(value, cfg); },
      onRdkitUseInputCoordsChange(checked) {
        state.rdkitUseInputCoords = checked === true;
        store(RDKIT_USE_INPUT_COORDS_STORAGE_KEY, state.rdkitUseInputCoords ? 'true' : 'false');
        state.svgCache.clear();
        render(cfg);
      }
    });
    bindGridEditControlHandlers(cfg);
  }

  function refreshGridControls(cfg) {
    const currentCfg = cfg || config();
    mountGridControls(currentCfg, capabilities(currentCfg));
  }

  function bindGridEditControlHandlers(cfg) {
    const bindings = [
      ['save-grid', () => saveGrid(cfg)],
      ['undo-grid-edit', () => undoLastGridEdit(cfg)]
    ];
    bindings.forEach(([id, handler]) => {
      const button = document.getElementById(id);
      if (!button || button.dataset.buretGridEditBound === '1') return;
      button.dataset.buretGridEditBound = '1';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        handler();
      }, true);
    });
  }

  function applyGridPreferences(cfg) {
    const currentCfg = cfg || config();
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
      propertiesToggle.hidden = state.viewMode !== 'cards';
      propertiesToggle.classList.toggle('active', state.showProperties);
      propertiesToggle.setAttribute('aria-pressed', state.showProperties ? 'true' : 'false');
    }
    syncCardRendererSwitch();
    syncGridViewModeSwitch();
    syncTableColumnsButton();
    syncTableFiltersButtons();
    syncXyzrenderPresetControl(currentCfg);
    syncRdkitCoordinatesControl();
    syncGridEditControls();
    syncGridGenerate3DControls();
  }

  function syncGridEditControls() {
    const saveButton = document.getElementById('save-grid');
    if (saveButton) {
      saveButton.disabled = !state.dirty;
      saveButton.title = state.dirty ? 'Overwrite the source collection file' : 'No unsaved changes';
    }
    const undoButton = document.getElementById('undo-grid-edit');
    if (undoButton) {
      undoButton.disabled = state.undoStack.length === 0;
      undoButton.title = state.undoStack.length ? 'Undo the last collection edit' : 'Nothing to undo';
    }
  }

  function xyzrenderPresetOptions(cfg) {
    const seen = new Set();
    const rows = Array.isArray(cfg?.xyzrenderPresetOptions) && cfg.xyzrenderPresetOptions.length
      ? cfg.xyzrenderPresetOptions
      : DEFAULT_XYZRENDER_PRESETS;
    const options = [];
    for (const row of rows) {
      const value = normalizeXyzrenderPreset(row?.value);
      if (seen.has(value)) continue;
      seen.add(value);
      options.push({ value, label: String(row?.label || value) });
    }
    return options.length ? options : DEFAULT_XYZRENDER_PRESETS;
  }

  function normalizeXyzrenderPreset(value) {
    const raw = String(value || 'default').trim().toLowerCase();
    return DEFAULT_XYZRENDER_PRESETS.some(row => row.value === raw) ? raw : 'default';
  }

  function currentXyzrenderPreset(cfg) {
    if (state.xyzrenderPreset) return state.xyzrenderPreset;
    const preset = normalizeXyzrenderPreset(cfg?.externalArtifact?.preset || cfg?.xyzrenderPreset || 'default');
    state.xyzrenderPreset = preset;
    return preset;
  }

  function setXyzrenderPreset(value, cfg) {
    const next = normalizeXyzrenderPreset(value);
    if (currentXyzrenderPreset(cfg) === next) return;
    state.xyzrenderPreset = next;
    resetXyzrenderCardObserver();
    state.xyzrenderCardCache.clear();
    resetCardRenderQueues();
    refreshGridControls(cfg);
    applyGridPreferences(cfg);
    if (state.cardRenderer === 'xyzrender') render(cfg);
  }

  function propertyOptionList(cfg) {
    const options = [
      { value: 'index', label: 'File order' },
      { value: 'name', label: 'Name' },
      { value: 'smiles', label: 'SMILES' }
    ];
    if (isRemoteMode(cfg)) return options;
    const keys = new Set();
    for (const row of state.all) {
      Object.keys(row.props || {}).forEach(key => {
        if (keys.size < 24) keys.add(key);
      });
      if (keys.size >= 24) break;
    }
    for (const key of [...keys].sort()) options.push({ value: `prop:${key}`, label: key });
    return options;
  }

  function setCardRenderer(value, cfg) {
    const next = value === 'xyzrender' && supportsXyzrenderCards(cfg) ? 'xyzrender' : 'rdkit';
    if (state.cardRenderer === next) return;
    state.cardRenderer = next;
    store(CARD_RENDERER_STORAGE_KEY, next);
    refreshGridControls(cfg);
    applyGridPreferences(cfg);
    render(cfg);
  }

  function setGridViewMode(value, cfg) {
    const next = value === 'table' ? 'table' : 'cards';
    if (state.viewMode === next) return;
    state.viewMode = next;
    store(GRID_VIEW_MODE_STORAGE_KEY, next);
    if (next !== 'table') {
      state.tableColumnPanelOpen = false;
      state.tableFiltersOpen = false;
      state.tableColumnPanelOutsideController?.abort();
      state.tableColumnPanelOutsideController = null;
    }
    applyGridPreferences(cfg);
    void render(cfg);
  }

  function toggleTableColumnPanel(cfg) {
    if (state.viewMode !== 'table') {
      state.viewMode = 'table';
      store(GRID_VIEW_MODE_STORAGE_KEY, 'table');
    }
    if (state.tableColumnPanelOpen) {
      closeTableColumnPanel(cfg);
      return;
    }
    state.tableColumnPanelOpen = !state.tableColumnPanelOpen;
    applyGridPreferences(cfg);
    void render(cfg);
  }

  function toggleTableFilters(cfg) {
    if (state.viewMode !== 'table') {
      state.viewMode = 'table';
      store(GRID_VIEW_MODE_STORAGE_KEY, 'table');
    }
    state.tableFiltersOpen = !state.tableFiltersOpen;
    applyGridPreferences(cfg);
    void render(cfg);
  }

  function closeTableColumnPanel(cfg) {
    if (!state.tableColumnPanelOpen) return;
    state.tableColumnPanelOpen = false;
    state.tableColumnPanelOutsideController?.abort();
    state.tableColumnPanelOutsideController = null;
    applyGridPreferences(cfg);
    void render(cfg);
  }

  function applyDescriptorGridControls(body, cfg) {
    state.descriptorFilters = normalizeDescriptorFilters(body.filters || body.descriptorFilters);
    state.descriptorSort = normalizeDescriptorSort(body.descriptorSort);
    setStatus('[grid] Descriptor controls applied.');
    if (state.remoteMode) void refreshRemote(cfg);
    else refresh(cfg);
  }

  function applyDescriptorGridResults(body, cfg) {
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const descriptorIds = new Set(state.remoteDescriptorIds || []);
    let applied = 0;
    for (const result of rows) {
      const index = Number(result?.index);
      if (!Number.isFinite(index)) continue;
      const target = state.all.find(row => Number(row.index) === index);
      if (!target) continue;
      const descriptors = normalizeDescriptorResultMap(result.descriptors);
      const ids = Object.keys(descriptors);
      if (!ids.length) continue;
      target.descriptors = { ...target.descriptors, ...descriptors };
      ids.forEach(id => descriptorIds.add(id));
      applied += 1;
    }
    state.remoteDescriptorIds = Array.from(descriptorIds).sort((left, right) => left.localeCompare(right));
    if (Array.isArray(window.BurreteGridRecords)) window.BurreteGridRecords = state.all;
    invalidateTableColumnCatalog();
    refreshOpenMoleculeDetail(cfg);
    setStatus(`[grid] Applied descriptors to ${applied.toLocaleString()} molecule${applied === 1 ? '' : 's'}.`);
    refresh(cfg);
  }

  function normalizeDescriptorResultMap(value) {
    if (!value || typeof value !== 'object') return {};
    const descriptors = {};
    for (const [id, cell] of Object.entries(value)) {
      if (!id || !cell || typeof cell !== 'object') continue;
      descriptors[id] = {
        label: String(cell.label || cell.id || id),
        value: cell.value === undefined ? null : cell.value,
        missingKind: cell.missingKind ?? null,
        errorText: cell.errorText ?? null
      };
    }
    return descriptors;
  }

  function normalizeDescriptorFilters(filters) {
    if (!Array.isArray(filters)) return [];
    return filters
      .map(filter => {
        const id = String(filter?.id || '').trim();
        if (!id) return null;
        const min = Number(filter?.min);
        const max = Number(filter?.max);
        const normalized = { id };
        if (Number.isFinite(min)) normalized.min = min;
        if (Number.isFinite(max)) normalized.max = max;
        return normalized.min === undefined && normalized.max === undefined ? null : normalized;
      })
      .filter(Boolean);
  }

  function normalizeDescriptorSort(sort) {
    const id = String(sort?.id || '').trim();
    if (!id) return null;
    return {
      id,
      direction: sort?.direction === 'desc' ? 'desc' : 'asc'
    };
  }

  function gridFetchPayload(fields) {
    return {
      ...fields,
      columnFilters: remoteTableColumnFilters(),
      descriptorFilters: mergedDescriptorFilters(),
      analysisFilters: mergedAnalysisFilters(),
      descriptorSort: state.descriptorSort
    };
  }

  function remoteTableColumnFilters() {
    const filters = [];
    for (const [columnId, filter] of Object.entries(state.tableColumnFilters || {})) {
      if (!filter || columnId.startsWith('descriptor:') || columnId.startsWith('analysis:')) continue;
      const row = { id: columnId, filterType: filter.type === 'number' ? 'number' : 'text' };
      if (row.filterType === 'number') {
        const min = Number(filter.min);
        const max = Number(filter.max);
        if (Number.isFinite(min)) row.min = min;
        if (Number.isFinite(max)) row.max = max;
        if (row.min === undefined && row.max === undefined) continue;
      } else {
        const text = String(filter.text || '').trim();
        if (!text) continue;
        row.text = text;
      }
      filters.push(row);
    }
    return filters;
  }

  function mergedDescriptorFilters() {
    const merged = [...state.descriptorFilters];
    for (const [columnId, filter] of Object.entries(state.tableColumnFilters || {})) {
      if (!columnId.startsWith('descriptor:') || filter?.type !== 'number') continue;
      const id = columnId.slice('descriptor:'.length);
      const min = Number(filter.min);
      const max = Number(filter.max);
      const row = { id };
      if (Number.isFinite(min)) row.min = min;
      if (Number.isFinite(max)) row.max = max;
      if (row.min !== undefined || row.max !== undefined) merged.push(row);
    }
    return merged;
  }

  function mergedAnalysisFilters() {
    const filters = [];
    for (const [columnId, filter] of Object.entries(state.tableColumnFilters || {})) {
      if (!columnId.startsWith('analysis:') || filter?.type !== 'number') continue;
      const valueId = columnId.slice('analysis:'.length);
      const column = (state.remoteAnalysisColumns || []).find(candidate => String(candidate.valueId || '') === valueId);
      const runId = String(column?.runId || '');
      if (!runId) continue;
      const row = { runId, valueId };
      const min = Number(filter.min);
      const max = Number(filter.max);
      if (Number.isFinite(min)) row.min = min;
      if (Number.isFinite(max)) row.max = max;
      if (row.min !== undefined || row.max !== undefined) filters.push(row);
    }
    return filters;
  }

  function syncCardRendererSwitch() {
    document.body.dataset.buretGridCardRenderer = state.cardRenderer;
    root.querySelectorAll('[data-buret-grid-card-renderer]').forEach(button => {
      const active = button.getAttribute('data-buret-grid-card-renderer') === state.cardRenderer;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function syncGridViewModeSwitch() {
    document.body.dataset.buretGridViewMode = state.viewMode;
    root.querySelectorAll('[data-buret-grid-view-mode]').forEach(button => {
      const active = button.getAttribute('data-buret-grid-view-mode') === state.viewMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function syncTableColumnsButton() {
    const button = document.getElementById('table-columns');
    if (!button) return;
    button.hidden = state.viewMode !== 'table';
    button.classList.toggle('active', state.tableColumnPanelOpen);
    button.setAttribute('aria-pressed', state.tableColumnPanelOpen ? 'true' : 'false');
  }

  function syncTableFiltersButtons() {
    root.querySelectorAll('[data-buret-table-filter-toggle]').forEach(button => {
      button.classList.toggle('active', state.tableFiltersOpen);
      button.setAttribute('aria-pressed', state.tableFiltersOpen ? 'true' : 'false');
    });
  }

  function syncXyzrenderPresetControl(cfg) {
    const control = document.getElementById('xyzrender-preset-control');
    const select = document.getElementById('xyzrender-preset');
    if (!control || !select) return;
    const enabled = state.cardRenderer === 'xyzrender';
    control.hidden = !enabled;
    select.disabled = !enabled;
    select.value = currentXyzrenderPreset(cfg);
  }

  function initRdkitCoordinatesControl(cfg) {
    const input = document.getElementById('rdkit-use-input-coords');
    if (!input) return;
    input.checked = state.rdkitUseInputCoords;
    syncRdkitCoordinatesControl();
  }

  function syncRdkitCoordinatesControl() {
    const control = document.getElementById('rdkit-use-input-coords-control');
    const input = document.getElementById('rdkit-use-input-coords');
    if (!control || !input) return;
    const hasInputCoordinates = hasInputCoordinateRows();
    control.hidden = state.cardRenderer !== 'rdkit' || !hasInputCoordinates;
    control.toggleAttribute('aria-disabled', !hasInputCoordinates);
    control.title = hasInputCoordinates ? 'Use coordinates embedded in the file' : 'No file coordinates in this grid';
    input.disabled = !hasInputCoordinates;
    input.checked = hasInputCoordinates && state.rdkitUseInputCoords;
  }

  function hasInputCoordinateRows() {
    const rows = state.rows.length ? state.rows : state.all;
    return rows.some(row => hasMolblockInputCoordinates(row.molblock));
  }

  function requestRendererSwitch(renderer, cfg) {
    const value = normalizeRenderer(renderer);
    if (value === 'molstar') {
      if (cfg?.quickLookViewer === true) {
        post('setRenderer', '[grid] Switch renderer to molstar.', {
          value,
          documentId: cfg?.documentId || null
        });
        return;
      }
      void requestSdfPoseDocument(cfg);
      return;
    }
    post('setRenderer', `[grid] Switch renderer to ${value}.`, {
      value,
      documentId: cfg?.documentId || null
    });
  }

  async function requestSdfPoseDocument(cfg) {
    const receptorPath = String(cfg?.dockingReceptorPath || '').trim();
    const rows = selectedMolstarRows();
    if (!rows.length) {
      setStatus('[grid] Select one or more molecules before opening Molstar.', 'error');
      return;
    }
    if (rows.length > 1) setStatus('[grid] Aligning selected molecules for Molstar.');
    const records = await sdfRecordTextsForMolstar(rows);
    if (!records.length) {
      setStatus('[grid] Selected molecules do not have SDF structure data for Molstar.', 'error');
      return;
    }
    const title = records.length === 1
      ? `${safeStructureFileStem(rows[0]?.name || `molecule-${Number(rows[0]?.index) + 1 || 1}`, Number(rows[0]?.index))}.sdf`
      : `selected-${records.length}-molecules.sdf`;
    post('openSdfMolstarDocument', '[grid] Open selected molecules in Molstar.', {
      documentId: cfg?.documentId || null,
      title,
      extension: 'sdf',
      textBase64: textToBase64(records.join('\n')),
      controlLabel: 'Molecule',
      receptorPath: receptorPath || null
    });
    setStatus(`[grid] Opening ${records.length.toLocaleString()} selected molecule${records.length === 1 ? '' : 's'} in Molstar.`);
  }

  async function requestSingleMolstarDocument(row, cfg) {
    const records = await sdfRecordTextsForMolstar([row]);
    const record = records[0] || null;
    const label = row?.name || `Molecule ${Number(row?.index) + 1 || 1}`;
    if (!record) {
      setStatus(`[grid] ${label} does not have SDF structure data for Molstar.`, 'error');
      return;
    }
    const receptorPath = String(cfg?.dockingReceptorPath || '').trim();
    const title = `${safeStructureFileStem(label, Number(row?.index))}.sdf`;
    post('openSdfMolstarDocument', `[grid] Open ${label} in Molstar.`, {
      documentId: cfg?.documentId || null,
      title,
      extension: 'sdf',
      textBase64: textToBase64(record),
      controlLabel: 'Molecule',
      receptorPath: receptorPath || null
    });
    setStatus(`[grid] Opening ${label} in Molstar.`);
  }

  function requestSelectedKetcherDocument(cfg) {
    const now = Date.now();
    if (now < state.ketcherOpenPendingUntil) return;
    const rows = selectedMolstarRows();
    if (!rows.length) {
      setStatus('[grid] Select one or more molecules before opening Ketcher.', 'error');
      return;
    }
    const fragments = rows.map(row => {
      const record = gridDragRecord(row);
      if (!record) return null;
      const text = ketcherFragmentText(record);
      if (!text.trim()) return null;
      return {
        title: record.path,
        extension: record.inputExtension,
        textBase64: textToBase64(text)
      };
    }).filter(Boolean);
    if (!fragments.length) {
      setStatus('[grid] Selected molecules do not have structure data for Ketcher.', 'error');
      return;
    }
    post('openSdfKetcherDocument', '[grid] Open selected molecules in Ketcher.', {
      documentId: cfg?.documentId || null,
      fragments
    });
    state.ketcherOpenPendingUntil = now + 1200;
    updateChrome(cfg);
    window.setTimeout(() => updateChrome(cfg), 1250);
    setStatus(`[grid] Opening ${fragments.length.toLocaleString()} selected molecule${fragments.length === 1 ? '' : 's'} in Ketcher.`);
  }

  function selectedMolstarRows() {
    if (!state.selected.size) return [];
    const pool = state.remoteMode ? state.rows : state.all;
    return pool
      .filter(row => state.selected.has(Number(row.index)))
      .sort((a, b) => Number(a.index) - Number(b.index));
  }

  function requestSelected3DGeneration(cfg) {
    const rows = selectedMolstarRows();
    if (!rows.length) {
      setStatus('[grid] Select one or more molecules before generating 3D.', 'error');
      return;
    }
    request3DGenerationForRows(rows, cfg);
  }

  function requestSelectedGeometryOptimization(cfg) {
    const rows = selectedMolstarRows();
    if (!rows.length) {
      setStatus('[grid] Select one or more molecules with input 3D coordinates first.');
      return;
    }
    const molecules = rows.map(row => gridConformerGenerationInput(row)).filter(Boolean);
    const title = `${cfg?.label || 'Molecules'} — optimized geometry`;
    setGridGenerate3DPending(true);
    post('optimizeGeometryGridSelection', '[grid] Optimize selected input geometry.', {
      documentId: cfg?.documentId || null,
      title,
      sourceIndexes: rows.map(row => Number(row.index)),
      molecules,
      conformerVariant: state.conformerVariant,
      mmffVariant: state.mmffVariant
    });
    setStatus(`[grid] Optimizing ${molecules.length.toLocaleString()} input geometr${molecules.length === 1 ? 'y' : 'ies'}.`);
  }

  function requestSelectedPoseAlignment(cfg) {
    if (state.aligningPoses) return;
    const rows = selectedMolstarRows();
    if (rows.length < 2) {
      setStatus('[grid] Select at least two 3D poses. The first selected row is the reference.', 'error');
      return;
    }
    state.aligningPoses = true;
    refreshGridControls(cfg);
    post('alignGridPoses', '[grid] Align and compare selected poses.', {
      documentId: cfg?.documentId || null,
      sourceIndexes: rows.map(row => Number(row.index))
    });
    setStatus(`[grid] Aligning ${rows.length.toLocaleString()} poses to the first selected row on Metal.`);
  }

  function requestSelectedSemiempiricalEvaluation(cfg) {
    if (state.evaluatingSemiempirical) return;
    const rows = selectedMolstarRows();
    const methodLabel = state.semiempiricalMethod === 'AM1_STAR' ? 'AM1*' : state.semiempiricalMethod;
    if (!rows.length) {
      setStatus(`[grid] Select at least one molecule with explicit coordinates before calculating ${methodLabel}.`, 'error');
      return;
    }
    state.evaluatingSemiempirical = true;
    refreshGridControls(cfg);
    post('evaluateSemiempiricalGridSelection', `[grid] Calculate ${methodLabel} energies and charges.`, {
      documentId: cfg?.documentId || null,
      sourceIndexes: rows.map(row => Number(row.index)),
      method: state.semiempiricalMethod
    });
    setStatus(`[grid] Calculating ${methodLabel} energies and charges for ${rows.length.toLocaleString()} selected molecule${rows.length === 1 ? '' : 's'}; execution provenance will identify Metal or CPU fallback.`);
  }

  function requestSingle3DGeneration(row, cfg) {
    if (!row) {
      setStatus('[grid] Select a molecule before generating 3D.', 'error');
      return;
    }
    request3DGenerationForRows([row], cfg);
  }

  function request3DGenerationForRows(rows, cfg) {
    const molecules = rows
      .map(row => gridConformerGenerationInput(row))
      .filter(Boolean);
    if (!molecules.length) {
      setStatus('[grid] Selected molecules do not have SDF or SMILES structure data for 3D generation.', 'error');
      return;
    }
    const title = molecules.length === 1
      ? `${safeStructureFileStem(rows[0]?.name || `molecule-${Number(rows[0]?.index) + 1 || 1}`, Number(rows[0]?.index))}-3d.sdf`
      : `${baseName(cfg?.label || 'selected-molecules')}-3d.sdf`;
    setGridGenerate3DPending(true);
    post('generate3dGridSelection', '[grid] Generate 3D for selected molecules.', {
      documentId: cfg?.documentId || null,
      title,
      sourceIndexes: rows.map(row => Number(row.index)),
      molecules,
      conformerVariant: state.conformerVariant,
      mmffVariant: state.mmffVariant
    });
    setStatus(`[grid] Generating 3D for ${molecules.length.toLocaleString()} molecule${molecules.length === 1 ? '' : 's'}.`);
  }

  function gridConformerGenerationInput(row) {
    const record = gridDragRecord(row);
    if (!record || !['sdf', 'sd', 'mol', 'smi', 'smiles'].includes(String(record.inputExtension || '').toLowerCase())) return null;
    const text = String(record.text || '').trim();
    if (!text) return null;
    return {
      title: record.path,
      extension: record.inputExtension,
      textBase64: textToBase64(text)
    };
  }

  function setGridGenerate3DPending(pending) {
    state.generating3d = pending === true;
    syncGridGenerate3DControls();
  }

  function requestClustering(cfg) {
    if (state.clustering || state.findingSimilar) return;
    if (!state.indexReady) {
      setStatus('[grid] Wait for indexing to finish before clustering.', 'error');
      return;
    }
    const sourceIndexes = [...state.selected]
      .map(Number)
      .filter(index => Number.isSafeInteger(index) && index >= 0)
      .sort((left, right) => left - right);
    setGridClusteringPending(true);
    post('clusterMolecules', '[grid] Cluster molecules.', {
      documentId: cfg?.documentId || null,
      sourceIndexes,
      cutoff: state.clusterCutoff,
    });
    setStatus(sourceIndexes.length
      ? `[grid] Clustering ${sourceIndexes.length.toLocaleString()} selected molecules.`
      : '[grid] Clustering the full collection.');
  }

  function setGridClusteringPending(pending) {
    state.clustering = pending === true;
    syncGridClusterControls();
  }

  function requestSimilaritySearch(cfg) {
    if (state.clustering || state.findingSimilar) return;
    if (!state.indexReady) {
      setStatus('[grid] Wait for indexing to finish before searching for similar molecules.', 'error');
      return;
    }
    if (state.selected.size !== 1) {
      setStatus('[grid] Select exactly one query molecule before similarity search.', 'error');
      return;
    }
    const jobId = String(latestRepresentativeAnalysisColumn()?.runId || '').trim();
    if (!jobId) {
      setStatus('[grid] Run clustering before searching its verified fingerprint snapshot.', 'error');
      return;
    }
    const querySourceIndex = Number([...state.selected][0]);
    if (!Number.isSafeInteger(querySourceIndex) || querySourceIndex < 0) {
      setStatus('[grid] The selected query molecule has no valid source index.', 'error');
      return;
    }
    setGridSimilaritySearchPending(true);
    post('findSimilarMolecules', '[grid] Find similar molecules.', {
      documentId: cfg?.documentId || null,
      jobId,
      querySourceIndex,
      cutoff: state.clusterCutoff,
      topK: 50
    });
    setStatus(`[grid] Finding up to 50 molecules with Tanimoto similarity at least ${Number(state.clusterCutoff).toFixed(2)}.`);
  }

  function setGridSimilaritySearchPending(pending) {
    state.findingSimilar = pending === true;
    syncGridClusterControls();
  }

  function latestRepresentativeAnalysisColumn() {
    return (state.remoteAnalysisColumns || []).find(column => (
      String(column?.valueId || '') === 'isRepresentative'
      && String(column?.valueKind || '') === 'boolean'
      && String(column?.runId || '').trim()
    )) || null;
  }

  function requestClusterRepresentativeExport(cfg) {
    if (state.clustering || state.exportingClusterRepresentatives) return;
    const column = latestRepresentativeAnalysisColumn();
    const jobId = String(column?.runId || '').trim();
    if (!jobId) {
      setStatus('[grid] Run clustering before exporting diverse representatives.', 'error');
      return;
    }
    setGridClusterRepresentativeExportPending(true);
    post('exportClusterRepresentatives', '[grid] Export diverse representatives.', {
      documentId: cfg?.documentId || null,
      jobId,
      collectionName: baseName(cfg?.label || 'molecules')
    });
  }

  function setGridClusterRepresentativeExportPending(pending) {
    state.exportingClusterRepresentatives = pending === true;
    syncGridClusterControls();
  }

  function syncGridClusterControls() {
    const button = document.getElementById('cluster-molecules');
    const similarityButton = document.getElementById('find-similar-molecules');
    const exportButton = document.getElementById('export-cluster-representatives');
    const cutoff = document.getElementById('cluster-cutoff');
    const total = state.remoteMode
      ? (state.recordsTotalHint || state.recordsIndexed || state.totalRows)
      : state.all.length;
    const unavailable = state.clustering || state.findingSimilar || state.indexing || total === 0;
    if (button) {
      button.disabled = unavailable;
      button.setAttribute('aria-busy', state.clustering ? 'true' : 'false');
      button.title = state.clustering
        ? 'Clustering is running'
        : state.indexing
        ? 'Wait for indexing to finish'
        : state.selected.size
        ? `Cluster ${state.selected.size.toLocaleString()} selected molecules`
        : 'Cluster the full collection';
      const label = button.querySelector('[data-buret-grid-cluster-label]');
      if (label) {
        label.textContent = state.clustering
          ? 'Clustering...'
          : state.selected.size
          ? `Cluster selected (${state.selected.size.toLocaleString()})`
          : 'Cluster all';
      }
    }
    if (cutoff) {
      cutoff.disabled = state.clustering || state.findingSimilar;
      cutoff.value = Number(state.clusterCutoff).toFixed(2);
    }
    if (similarityButton) {
      const available = Boolean(latestRepresentativeAnalysisColumn());
      const querySelected = state.selected.size === 1;
      similarityButton.disabled = unavailable || !available || !querySelected;
      similarityButton.setAttribute('aria-busy', state.findingSimilar ? 'true' : 'false');
      similarityButton.title = state.findingSimilar
        ? 'Similarity search is running'
        : !available
        ? 'Run clustering before searching its verified fingerprint snapshot'
        : !querySelected
        ? 'Select exactly one query molecule'
        : `Find the top 50 matches at Tanimoto ≥ ${Number(state.clusterCutoff).toFixed(2)}`;
      const label = similarityButton.querySelector('[data-buret-grid-similarity-label]');
      if (label) label.textContent = state.findingSimilar ? 'Searching...' : 'Find similar';
    }
    if (exportButton) {
      const available = Boolean(latestRepresentativeAnalysisColumn());
      exportButton.disabled = state.clustering || state.exportingClusterRepresentatives || !available;
      exportButton.setAttribute('aria-busy', state.exportingClusterRepresentatives ? 'true' : 'false');
      exportButton.title = state.exportingClusterRepresentatives
        ? 'Representative export is running'
        : available
        ? 'Export immutable diverse representatives with provenance'
        : 'Run clustering before exporting diverse representatives';
      const label = exportButton.querySelector('[data-buret-grid-representative-export-label]');
      if (label) label.textContent = state.exportingClusterRepresentatives ? 'Exporting...' : 'Export diverse';
    }
  }

  function syncGridGenerate3DControls() {
    const button = document.getElementById('generate-3d-selected');
    if (button) {
      button.disabled = state.generating3d || state.selected.size === 0;
      button.classList.toggle('generating', state.generating3d);
      button.title = state.generating3d
        ? '3D generation is running'
        : state.selected.size
        ? 'Generate 3D conformers for selected molecules'
        : 'Select one or more molecules first';
    }
    const label = button?.querySelector?.('[data-buret-grid-generate-3d-label]');
    if (label) label.textContent = state.generating3d ? 'Generating...' : 'Generate 3D';
  }

  function selectedDescriptorRows() {
    if (!state.selected.size) return [];
    const pool = state.remoteMode ? state.rows : state.all;
    return pool
      .filter(row => state.selected.has(Number(row.index)))
      .sort((a, b) => Number(a.index) - Number(b.index));
  }

  function requestSelectedDescriptorCalculation(cfg) {
    const rows = selectedDescriptorRows();
    if (!rows.length) {
      setStatus('[grid] Select one or more molecules before calculating descriptors.', 'error');
      return;
    }
    requestDescriptorCalculationForRows(rows, cfg);
  }

  function requestDescriptorCalculationForRow(row, cfg) {
    requestDescriptorCalculationForRows([row], cfg);
  }

  function requestDescriptorCalculationForRows(rows, cfg) {
    const rowIndexes = rows
      .map(row => Math.trunc(Number(row?.index)))
      .filter(index => Number.isFinite(index) && index >= 0);
    if (!rowIndexes.length) {
      setStatus('[grid] No molecule rows are available for descriptor calculation.', 'error');
      return;
    }
    post('calculateGridDescriptors', `[grid] Calculate descriptors for ${rowIndexes.length} molecule${rowIndexes.length === 1 ? '' : 's'}.`, {
      documentId: cfg?.documentId || null,
      rowIndexes
    });
    setStatus(`[grid] Calculating descriptors for ${rowIndexes.length.toLocaleString()} molecule${rowIndexes.length === 1 ? '' : 's'}.`);
  }

  function sdfRecordTextForMolstar(row) {
    const record = gridDragRecord(row);
    if (!record) return null;
    if (record.inputExtension !== 'sdf') return smilesRecordTextForMolstar(row);
    const text = String(record.text || '').trimEnd();
    if (!text.trim()) return null;
    return sdfRecordFromMolblock(text);
  }

  async function smilesRecordTextForMolstar(row) {
    const molblock = String(row?.molblock || '').trimEnd();
    if (molblock.trim()) {
      return sdfRecordFromMolblock(molblock);
    }
    const smiles = String(row?.smiles || '').trim();
    if (!smiles) return null;
    let mol = null;
    try {
      const rdkit = await initRDKit();
      mol = rdkit.get_mol(smiles);
      if (!mol || (typeof mol.is_valid === 'function' && !mol.is_valid())) return null;
      try { mol.set_new_coords?.(); } catch (_) {}
      const molblock = typeof mol.get_molblock === 'function' ? mol.get_molblock() : '';
      return sdfRecordFromMolblock(molblock);
    } catch (error) {
      state.rdkitError = error?.message || String(error);
      return null;
    } finally {
      try { mol?.delete?.(); } catch {}
    }
  }

  async function sdfRecordTextsForMolstar(rows) {
    if (!Array.isArray(rows) || rows.length <= 1) {
      return (await Promise.all((rows || []).map(row => sdfRecordTextForMolstar(row))))
        .filter(text => typeof text === 'string' && text.trim().length > 0);
    }
    const aligned = await alignedSdfRecordTextsForMolstar(rows);
    if (aligned.length) return aligned;
    return (await Promise.all(rows.map(row => sdfRecordTextForMolstar(row))))
      .filter(text => typeof text === 'string' && text.trim().length > 0);
  }

  async function alignedSdfRecordTextsForMolstar(rows) {
    let rdkit = null;
    try {
      rdkit = await initRDKit();
    } catch (error) {
      state.rdkitError = error?.message || String(error);
      return [];
    }

    const molecules = [];
    let templateMol = null;
    try {
      for (const row of rows) {
        const mol = rdkitMolForMolstarRow(rdkit, row);
        if (!mol || (typeof mol.is_valid === 'function' && !mol.is_valid())) {
          try { mol?.delete?.(); } catch {}
          continue;
        }
        if (!templateMol) {
          ensureRdkitMolCoordinates(mol);
          templateMol = mol;
        }
        molecules.push(mol);
      }
      if (!templateMol) return [];
      return molecules
        .map(mol => alignedMolblockForMolstar(mol, templateMol))
        .map(sdfRecordFromMolblock)
        .filter(text => typeof text === 'string' && text.trim().length > 0);
    } finally {
      for (const mol of molecules) {
        try { mol?.delete?.(); } catch {}
      }
    }
  }

  function rdkitMolForMolstarRow(rdkit, row) {
    const record = gridDragRecord(row);
    if (!record) return null;
    if (record.inputExtension === 'sdf') {
      const text = String(record.text || '').replace(/\n?\$\$\$\$\s*$/u, '').trimEnd();
      return text.trim() ? rdkit.get_mol(text) : null;
    }
    const smiles = String(row?.smiles || '').trim();
    return smiles ? rdkit.get_mol(smiles) : null;
  }

  function ensureRdkitMolCoordinates(mol) {
    if (typeof mol?.has_coords === 'function' && mol.has_coords()) return;
    if (typeof mol?.set_new_coords === 'function') mol.set_new_coords();
  }

  function alignedMolblockForMolstar(mol, templateMol) {
    if (mol !== templateMol && typeof mol?.generate_aligned_coords === 'function') {
      mol.generate_aligned_coords(templateMol, JSON.stringify({
        acceptFailure: true,
        useCoordGen: false
      }));
    } else {
      ensureRdkitMolCoordinates(mol);
    }
    return typeof mol?.get_molblock === 'function' ? mol.get_molblock() : '';
  }

  function sdfRecordFromMolblock(value) {
    const text = String(value || '').trimEnd();
    if (!text.trim()) return null;
    return `${text.replace(/\n?\$\$\$\$\s*$/u, '').trimEnd()}\n$$$$\n`;
  }

  function requestOpenInKetcher(row, cfg) {
    const record = gridDragRecord(row);
    const label = row?.name || `Molecule ${Number(row?.index) + 1 || 1}`;
    if (!record) {
      setStatus(`[grid] ${label} has no structure data for Ketcher.`, 'error');
      return;
    }
    const payload = {
      title: record.path,
      extension: record.inputExtension,
      textBase64: textToBase64(ketcherFragmentText(record)),
      documentId: cfg?.documentId || null,
      rowIndex: Number(row?.index),
      gridEdit: true
    };
    const message = `[grid] Open ${label} in Ketcher.`;
    post('openInKetcher', message, payload);
  }

  function ketcherFragmentText(record) {
    const text = String(record?.text || '').trimEnd();
    const extension = String(record?.inputExtension || '').toLowerCase();
    if (!text.trim()) return '';
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

  function xyzrenderCardInputText(row, record) {
    const molblock = String(row?.molblock || '').trimEnd();
    if (molblock.trim()) {
      return `${molblock.replace(/\n?\$\$\$\$\s*$/u, '').trimEnd()}\n$$$$\n`;
    }
    const smiles = String(row?.smiles || '').trim();
    if (smiles) return `${smiles}\n`;
    return xyzrenderFragmentText(record);
  }

  function normalizeRenderer(renderer) {
    const value = String(renderer || 'molstar').toLowerCase();
    return value === 'xyzrender-external' || value === 'xyzrender' ? 'xyzrender-external' : 'molstar';
  }

  function queryLooksLikeExplicitSMARTS(value) {
    const text = String(value || '').trim();
    return !!text && !/\s/u.test(text) && /[[\]#@:+\\/$()=~!;]/u.test(text);
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
    resetGridWindowForNewResultSet();
    if (state.remoteMode) {
      void refreshRemote(cfg);
      return;
    }
    const query = state.smarts.trim() ? '' : normalize(state.query);
    const allRows = currentLocalCollectionRows();
    const textRows = query
      ? allRows.filter(row => normalize([row.name, row.smiles, ...Object.entries(row.props || {}).flat()].join('\n')).includes(query))
      : allRows.slice();
    state.rows = filterByTableColumnControls(filterByDescriptorControls(filterBySMARTS(textRows)));
    if (shouldFallbackSMARTSToTextSearch()) {
      const fallbackQuery = normalize(state.query);
      state.smartsError = '';
      state.smartsMatches = new Map();
      state.rows = fallbackQuery
        ? allRows.filter(row => normalize([row.name, row.smiles, ...Object.entries(row.props || {}).flat()].join('\n')).includes(fallbackQuery))
        : allRows.slice();
      state.rows = filterByTableColumnControls(filterByDescriptorControls(state.rows));
    }
    state.rows.sort((a, b) => compareWithDescriptorSort(a, b));
    state.totalRows = state.rows.length;
    render(cfg);
  }

  function resetGridWindowForNewResultSet() {
    cancelVirtualWindowRender();
    state.windowStart = 0;
    state.windowEnd = 0;
    state.renderedCount = 0;
    state.visibleCount = 0;
    const grid = document.getElementById('grid');
    if (!grid) return;
    const top = grid.getBoundingClientRect().top + scrollTop();
    if (scrollTop() > top) window.scrollTo({ top, left: window.scrollX || 0, behavior: 'auto' });
  }

  function filterByDescriptorControls(rows) {
    if (!state.descriptorFilters.length) return rows;
    return rows.filter(row => state.descriptorFilters.every(filter => {
      const value = descriptorNumericValue(row.descriptors?.[filter.id]);
      if (!Number.isFinite(value)) return false;
      if (Number.isFinite(filter.min) && value < filter.min) return false;
      if (Number.isFinite(filter.max) && value > filter.max) return false;
      return true;
    }));
  }

  function filterByTableColumnControls(rows) {
    const filters = Object.entries(state.tableColumnFilters || {});
    if (!filters.length) return rows;
    return rows.filter(row => filters.every(([columnId, filter]) => tableColumnFilterMatches(row, columnId, filter)));
  }

  function tableColumnFilterMatches(row, columnId, filter) {
    if (!filter) return true;
    if (filter.type === 'number') {
      const value = tableColumnNumericValue(row, columnId);
      if (!Number.isFinite(value)) return false;
      const min = Number(filter.min);
      const max = Number(filter.max);
      if (Number.isFinite(min) && value < min) return false;
      if (Number.isFinite(max) && value > max) return false;
      return true;
    }
    const text = String(filter.text || '').trim().toLowerCase();
    if (!text) return true;
    return tableColumnDisplayValue(row, columnId).toLowerCase().includes(text);
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

  function compareWithDescriptorSort(a, b) {
    if (state.descriptorSort?.id) {
      const left = descriptorNumericValue(a.descriptors?.[state.descriptorSort.id]);
      const right = descriptorNumericValue(b.descriptors?.[state.descriptorSort.id]);
      const leftFinite = Number.isFinite(left);
      const rightFinite = Number.isFinite(right);
      if (leftFinite && rightFinite && left !== right) {
        return state.descriptorSort.direction === 'desc' ? right - left : left - right;
      }
      if (leftFinite !== rightFinite) return leftFinite ? -1 : 1;
    }
    return compare(a, b, state.sort);
  }

  function descriptorNumericValue(value) {
    if (!value || value.errorText || value.missingKind) return Number.NaN;
    const numeric = Number(value.value);
    return Number.isFinite(numeric) ? numeric : Number.NaN;
  }

  function initInfiniteLoading(cfg) {
    const sentinel = document.getElementById('load-sentinel');
    if (!sentinel) return;
    state.loadObserver?.disconnect?.();
    if (typeof IntersectionObserver === 'function') {
      state.loadObserver = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) loadMore(cfg);
      }, { root: null, rootMargin: `${GRID_LOAD_AHEAD_PX}px 0px` });
      state.loadObserver.observe(sentinel);
    }
    if (state.scrollHandler) window.removeEventListener('scroll', state.scrollHandler);
    state.scrollHandler = () => handleGridScroll(cfg);
    window.addEventListener('scroll', state.scrollHandler, { passive: true });
    if (state.resizeHandler) window.removeEventListener('resize', state.resizeHandler);
    state.resizeHandler = () => {
      updateVirtualGridMetrics();
      scheduleVirtualWindowRender(cfg);
      updateGridRailActive();
      maybeLoadMore(cfg);
    };
    window.addEventListener('resize', state.resizeHandler, { passive: true });
  }

  function handleGridScroll(cfg) {
    scheduleVirtualWindowRender(cfg);
    maybeLoadMore(cfg);
    updateGridRailActive();
  }

  function hasMoreRows() {
    if (state.remoteMode) return state.visibleCount < state.rows.length || state.rows.length < state.totalRows || state.indexing;
    return false;
  }

  function maybeLoadMore(cfg) {
    if (!hasMoreRows()) return;
    const sentinel = document.getElementById('load-sentinel');
    const rect = sentinel?.getBoundingClientRect();
    if (!rect || rect.top <= window.innerHeight + GRID_LOAD_AHEAD_PX) loadMore(cfg);
  }

  async function render(cfg) {
    const token = ++state.token;
    const grid = document.getElementById('grid');
    cancelVirtualWindowRender();
    resetRdkitCardObserver();
    resetXyzrenderCardObserver();
    resetCardRenderQueues();
    root.querySelector('.buret-grid-molecule-context-menu')?.remove();
    grid.innerHTML = '';
    state.renderedCount = 0;
    state.windowStart = 0;
    state.windowEnd = 0;
    state.visibleCount = state.remoteMode ? Math.min(loadBatchSize(cfg), state.rows.length) : state.rows.length;
    if (!state.rows.length) {
      grid.innerHTML = '<div class="buret-empty">No molecules match this search.</div>';
      updateChrome(cfg);
      postGridReady(cfg);
      return;
    }
    await renderVirtualWindow(cfg, token, { force: true });
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
    state.visibleCount = state.remoteMode
      ? Math.min(state.rows.length, state.visibleCount + loadBatchSize(cfg))
      : state.rows.length;
    await renderVirtualWindow(cfg, state.token, { force: true });
  }

  async function refreshRemote(cfg) {
    const token = ++state.token;
    state.smartsError = '';
    state.smartsMatches = new Map();
    state.rows = [];
    invalidateTableColumnCatalog();
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
          invalidateTableColumnCatalog();
          state.totalRows = matches.length;
          state.visibleCount = Math.min(loadBatchSize(cfg), state.rows.length);
          await renderVirtualWindow(cfg, token, { force: true });
          return;
        }
        state.smartsError = '';
        state.smartsMatches = new Map();
      }
      const result = await hostRequest('gridFetchPage', gridFetchPayload({
        query: state.query || '',
        sort: state.sort || 'index',
        offset: 0,
        limit: loadBatchSize(cfg)
      }));
      if (token !== state.token) return;
      state.rows = applyVirtualGridEdits(await hydrateDataWarriorRows(Array.isArray(result.rows) ? result.rows : [], cfg));
      invalidateTableColumnCatalog();
      applyGridPageState(result);
      state.visibleCount = Math.min(loadBatchSize(cfg), state.rows.length);
      await renderVirtualWindow(cfg, token, { force: true });
      scheduleIndexPoll(cfg);
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
        const result = await hostRequest('gridFetchPage', gridFetchPayload({
          query: '',
          sort: state.sort || 'index',
          offset,
          limit
        }));
        const pageRows = await hydrateDataWarriorRows(Array.isArray(result.rows) ? result.rows : [], cfg);
        applyGridPageState(result);
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
    const cfg = config();
    if (cfg.appViewer === true && cfg.gridDataMode === 'bridge') {
      scheduleXyzrenderCardBatchQueue();
      return;
    }
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

  function scheduleXyzrenderCardBatchQueue() {
    if (
      state.xyzrenderBatchesRunning >= xyzrenderCardBatchConcurrency()
      || state.xyzrenderBatchTimer
      || !state.xyzrenderCardQueue.length
    ) return;
    state.xyzrenderBatchTimer = window.setTimeout(() => {
      state.xyzrenderBatchTimer = 0;
      pumpXyzrenderCardBatchQueue();
    }, XYZRENDER_CARD_BATCH_DELAY_MS);
  }

  function pumpXyzrenderCardBatchQueue() {
    if (!state.xyzrenderCardQueue.length) return;
    const concurrency = xyzrenderCardBatchConcurrency();
    while (
      state.xyzrenderBatchesRunning < concurrency
      && state.xyzrenderCardQueue.length
    ) {
      state.xyzrenderCardQueue.sort(compareCardRenderJobs);
      const jobs = takeXyzrenderCardBatchJobs();
      if (!jobs.length) return;
      state.xyzrenderBatchesRunning++;
      void requestXyzrenderCardBatch(jobs).finally(() => {
        state.xyzrenderBatchesRunning = Math.max(0, state.xyzrenderBatchesRunning - 1);
        scheduleXyzrenderCardBatchQueue();
      });
    }
  }

  function xyzrenderCardBatchConcurrency() {
    const cores = typeof navigator !== 'undefined' ? Number(navigator.hardwareConcurrency || 0) : 0;
    if (!Number.isFinite(cores) || cores <= 0) return 2;
    if (cores >= 12) return XYZRENDER_CARD_BATCH_MAX_CONCURRENCY;
    if (cores >= 8) return 2;
    return XYZRENDER_CARD_BATCH_MIN_CONCURRENCY;
  }

  function takeXyzrenderCardBatchJobs() {
    const visible = [];
    const deferred = [];
    for (const job of state.xyzrenderCardQueue) {
      if (visible.length < XYZRENDER_CARD_BATCH_SIZE && cardRenderPriority(job.target) === 0) {
        visible.push(job);
      } else {
        deferred.push(job);
      }
    }
    const jobs = visible.length ? visible : deferred.splice(0, XYZRENDER_CARD_BATCH_SIZE);
    if (!jobs.length) return;
    const selected = new Set(jobs);
    state.xyzrenderCardQueue = state.xyzrenderCardQueue.filter(job => !selected.has(job));
    return jobs;
  }

  async function loadMoreRemote(cfg) {
    if (state.remoteLoading) {
      state.pendingLoad = true;
      return;
    }
    if (!hasMoreRows()) return;
    if (state.visibleCount < state.rows.length) {
      state.visibleCount = Math.min(state.rows.length, state.visibleCount + loadBatchSize(cfg));
      await renderVirtualWindow(cfg, state.token, { force: true });
      return;
    }
    const token = state.token;
    state.remoteLoading = true;
    try {
      const result = await hostRequest('gridFetchPage', gridFetchPayload({
        query: state.query || '',
        sort: state.sort || 'index',
        offset: state.rows.length,
        limit: loadBatchSize(cfg)
      }));
      if (token !== state.token) return;
      const nextRows = applyVirtualGridEdits(await hydrateDataWarriorRows(Array.isArray(result.rows) ? result.rows : [], cfg));
      applyGridPageState(result);
      state.rows.push(...nextRows);
      if (nextRows.length) invalidateTableColumnCatalog();
      state.visibleCount = Math.min(state.rows.length, state.visibleCount + loadBatchSize(cfg));
      await renderVirtualWindow(cfg, state.token, { force: true });
      if (!nextRows.length && state.indexing) scheduleIndexPoll(cfg);
      else if (hasMoreRows()) window.setTimeout(() => loadMoreRemote(cfg), 0);
    } catch (error) {
      setStatus(error?.message || String(error), 'error');
    } finally {
      state.remoteLoading = false;
    }
  }

  function applyVirtualGridEdits(rows) {
    return rows
      .filter(row => !state.hiddenRows.has(Number(row.index)))
      .map(row => {
        const index = Number(row.index);
        const patch = state.rowPatches.get(index);
        if (!patch) return row;
        return {
          ...row,
          name: patch.name,
          molblock: patch.molblock,
          smiles: patch.smiles,
          props: patch.props || row.props || {}
        };
      });
  }

  function currentLocalCollectionRows() {
    return applyVirtualGridEdits(state.all);
  }

  function cancelVirtualWindowRender() {
    if (!state.virtualFrame) return;
    window.cancelAnimationFrame(state.virtualFrame);
    state.virtualFrame = 0;
  }

  function scheduleVirtualWindowRender(cfg) {
    if (state.virtualFrame || state.rendering || !state.rows.length) return;
    state.virtualFrame = window.requestAnimationFrame(() => {
      state.virtualFrame = 0;
      void renderVirtualWindow(cfg, state.token);
    });
  }

  function handleTableColumnScroll(wrapper, cfg) {
    const next = Math.max(0, Math.round(wrapper.scrollLeft || 0));
    if (next === state.tableScrollLeft) return;
    state.tableScrollLeft = next;
    if (state.tableColumnScrollFrame || state.rendering || !state.rows.length) return;
    state.tableColumnScrollFrame = window.requestAnimationFrame(() => {
      state.tableColumnScrollFrame = 0;
      void renderVirtualWindow(cfg, state.token, { force: true });
    });
  }

  function handleTableWheel(event, wrapper, cfg) {
    const maxScrollLeft = Math.max(0, wrapper.scrollWidth - wrapper.clientWidth);
    if (maxScrollLeft <= 0) return;
    const deltaX = Number(event.deltaX) || 0;
    const deltaY = Number(event.deltaY) || 0;
    const shouldScrollHorizontally = Math.abs(deltaX) > Math.abs(deltaY) || event.shiftKey;
    if (!shouldScrollHorizontally) return;
    const delta = Math.abs(deltaX) > 0 ? deltaX : deltaY;
    const next = Math.max(0, Math.min(maxScrollLeft, wrapper.scrollLeft + delta));
    if (next === wrapper.scrollLeft) return;
    event.preventDefault();
    wrapper.scrollLeft = next;
    handleTableColumnScroll(wrapper, cfg);
  }

  async function renderVirtualWindow(cfg, token, options = {}) {
    const grid = document.getElementById('grid');
    if (!grid || token !== state.token) return;
    if (state.rendering) {
      state.pendingRender = true;
      return;
    }
    const startedAt = nowMs();
    const range = virtualWindowRange(grid);
    if (!options.force && range.start === state.windowStart && range.end === state.windowEnd) {
      updateChrome(cfg);
      return;
    }
    state.rendering = true;
    try {
      resetRdkitCardObserver();
      resetXyzrenderCardObserver();
      resetCardRenderQueues();
      const fragment = document.createDocumentFragment();
      const cards = [];
      const rows = state.rows.slice(range.start, range.end);
      if (state.viewMode === 'table') {
        fragment.appendChild(gridTable(rows, cfg, range));
        grid.replaceChildren(fragment);
        restoreTableScrollPosition(grid);
        state.windowStart = range.start;
        state.windowEnd = range.end;
        state.renderedCount = Math.max(0, range.end - range.start);
        updateVirtualGridMetrics();
        updateChrome(cfg);
        scrollPendingGridRow();
        maybeLoadMoreForRenderedRange(cfg, range);
        postGridReady(cfg);
        emitGridPerfMetric(cfg, 'window-render', startedAt, { force: true });
        if (status && !window.BurreteDebug) status.classList.add('hidden');
        return;
      }
      if (range.topHeight > 0) fragment.appendChild(gridSpacer('top', range.topHeight));
      for (const row of rows) {
        if (token !== state.token) return;
        const nextCard = card(row, cfg);
        cards.push({ row, card: nextCard });
        fragment.appendChild(nextCard);
      }
      if (range.bottomHeight > 0) fragment.appendChild(gridSpacer('bottom', range.bottomHeight));
      grid.replaceChildren(fragment);
      for (const { row, card: nextCard } of cards) {
        scheduleRdkitCard(nextCard, row);
        scheduleXyzrenderCard(nextCard, row, cfg);
      }
      requestAnimationFrame(startVisibleRdkitCards);
      state.windowStart = range.start;
      state.windowEnd = range.end;
      state.renderedCount = Math.max(0, range.end - range.start);
      updateVirtualGridMetrics();
      updateChrome(cfg);
      scrollPendingGridRow();
      maybeLoadMoreForRenderedRange(cfg, range);
      postGridReady(cfg);
      emitGridPerfMetric(cfg, 'window-render', startedAt, { force: true });
      if (status && !window.BurreteDebug) status.classList.add('hidden');
    } finally {
      state.rendering = false;
      if (token === state.token) {
        if (state.pendingRender) {
          state.pendingRender = false;
          requestAnimationFrame(() => {
            void renderVirtualWindow(cfg, token, { force: true });
            maybeLoadMore(cfg);
          });
          return;
        }
        if (state.pendingLoad) {
          state.pendingLoad = false;
          loadMore(cfg);
        } else {
          requestAnimationFrame(() => {
            scheduleVirtualWindowRender(cfg);
            maybeLoadMore(cfg);
          });
        }
      }
    }
  }

  function restoreTableScrollPosition(grid) {
    const wrapper = grid?.querySelector?.('.buret-grid-table-wrap');
    if (!wrapper) return;
    const left = Math.max(0, Number(state.tableScrollLeft) || 0);
    wrapper.scrollLeft = left;
    window.requestAnimationFrame(() => {
      const current = grid?.querySelector?.('.buret-grid-table-wrap');
      if (current) current.scrollLeft = left;
    });
  }

  function gridSpacer(position, height) {
    const spacer = document.createElement('div');
    spacer.className = `buret-grid-spacer buret-grid-spacer-${position}`;
    spacer.style.height = `${Math.max(0, Math.round(height))}px`;
    spacer.setAttribute('aria-hidden', 'true');
    return spacer;
  }

  function maybeLoadMoreForRenderedRange(cfg, range) {
    if (!hasMoreRows() || state.remoteLoading) return;
    if (range.end >= Math.max(0, state.visibleCount - GRID_WINDOW_OVERSCAN_ROWS)) {
      window.setTimeout(() => loadMore(cfg), 0);
    }
  }

  function virtualWindowRange(grid) {
    updateVirtualGridMetrics();
    const visibleRows = Math.min(state.visibleCount, state.rows.length);
    if (!visibleRows) return { start: 0, end: 0, topHeight: 0, bottomHeight: 0 };
    const columns = Math.max(1, state.estimatedColumnCount);
    const totalGridRows = Math.ceil(visibleRows / columns);
    const gridTop = grid.getBoundingClientRect().top + scrollTop();
    const viewportTop = Math.max(0, scrollTop() - gridTop);
    const viewportBottom = viewportTop + viewportHeight();
    const rowHeight = estimatedRowStride();
    const firstGridRow = Math.max(0, Math.floor(viewportTop / rowHeight) - GRID_WINDOW_OVERSCAN_ROWS);
    const lastGridRow = Math.min(
      totalGridRows,
      Math.ceil(viewportBottom / rowHeight) + GRID_WINDOW_OVERSCAN_ROWS
    );
    const cappedLastGridRow = Math.min(totalGridRows, firstGridRow + GRID_MAX_WINDOW_ROWS);
    const start = Math.min(visibleRows, firstGridRow * columns);
    const end = Math.min(visibleRows, Math.max(start + columns, cappedLastGridRow * columns));
    return {
      start,
      end,
      topHeight: firstGridRow * rowHeight,
      bottomHeight: Math.max(0, (totalGridRows - Math.ceil(end / columns)) * rowHeight)
    };
  }

  function updateVirtualGridMetrics() {
    const grid = document.getElementById('grid');
    if (!grid) return;
    const styles = getComputedStyle(grid);
    const gap = cssPixels(styles.rowGap || styles.gap, state.estimatedGridGap || 10);
    state.estimatedGridGap = gap;
    if (state.viewMode === 'table') {
      const row = grid.querySelector('.buret-grid-table-row');
      const rect = row?.getBoundingClientRect?.();
      state.estimatedColumnCount = 1;
      state.estimatedRowHeight = rect && Number.isFinite(rect.height) && rect.height > 0
        ? Math.max(36, rect.height)
        : 44;
      return;
    }
    const card = grid.querySelector('.buret-card');
    const gridWidth = grid.getBoundingClientRect().width || window.innerWidth || DEFAULT_CARD_MIN;
    if (card) {
      const rect = card.getBoundingClientRect();
      if (Number.isFinite(rect.width) && rect.width > 0) {
        state.estimatedColumnCount = Math.max(1, Math.floor((gridWidth + gap) / (rect.width + gap)));
      }
      if (Number.isFinite(rect.height) && rect.height > 0) {
        state.estimatedRowHeight = Math.max(GRID_MIN_ESTIMATED_ROW_HEIGHT, rect.height);
      }
      return;
    }
    const cardMin = state.cardMin || DEFAULT_CARD_MIN;
    state.estimatedColumnCount = Math.max(1, Math.floor((gridWidth + gap) / (cardMin + gap)));
    state.estimatedRowHeight = Math.max(GRID_MIN_ESTIMATED_ROW_HEIGHT, cardMin + (state.showProperties ? 120 : 0));
  }

  function cssPixels(value, fallback) {
    const number = Number.parseFloat(String(value || ''));
    return Number.isFinite(number) ? number : fallback;
  }

  function estimatedRowStride() {
    if (state.viewMode === 'table') {
      return Math.max(36, state.estimatedRowHeight + state.estimatedGridGap);
    }
    return Math.max(GRID_MIN_ESTIMATED_ROW_HEIGHT, state.estimatedRowHeight + state.estimatedGridGap);
  }

  function scrollTop() {
    return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
  }

  function viewportHeight() {
    return window.innerHeight || document.documentElement.clientHeight || 800;
  }

  function updateChrome(cfg) {
    const total = state.remoteMode
      ? (state.recordsTotalHint || state.recordsIndexed || state.totalRows)
      : Number(cfg.recordsTotal || state.all.length);
    const included = state.remoteMode ? state.recordsIndexed : Number(cfg.recordsIncluded || state.all.length);
    const visible = state.remoteMode ? state.totalRows : state.rows.length;
    const scrollable = Math.min(state.visibleCount, state.rows.length);
    const summaryParts = [];
    if (state.indexing) {
      summaryParts.push(`Indexing ${moleculeCountLabel(included)}${total ? ` of ${total.toLocaleString()}` : ''}`);
    } else if (total > 0 && visible !== total) {
      summaryParts.push(`${visible.toLocaleString()} of ${moleculeCountLabel(total)}`);
    } else {
      summaryParts.push(moleculeCountLabel(visible || total || included));
    }
    if (state.dirty) summaryParts.push(`unsaved ${state.dirtyReason || 'edits'}`);
    if (state.selected.size) summaryParts.push(`${state.selected.size.toLocaleString()} selected`);
    document.getElementById('summary').textContent = summaryParts.filter(Boolean).join(' · ');
    if (!state.remoteMode && state.smarts.trim() && !state.smartsError) {
      document.getElementById('summary').textContent += ` · SMARTS matches ${state.smartsMatches.size.toLocaleString()}`;
    }
    const loadStatus = document.getElementById('load-status');
    if (loadStatus) {
      loadStatus.textContent = state.indexing
        ? `Indexing ${included.toLocaleString()}${state.recordsTotalHint ? ` / ${state.recordsTotalHint.toLocaleString()}` : ''} molecules`
        : hasMoreRows()
        ? 'More rows available'
        : '';
    }
    const clearSMARTS = document.getElementById('clear-smarts');
    if (clearSMARTS) clearSMARTS.hidden = !state.query.trim();
    const searchInput = document.getElementById('search');
    if (searchInput) searchInput.classList.toggle('invalid', !!state.smartsError);
    const selectableIndexes = selectableRowIndexes();
    const allCurrentSelected = selectableIndexes.length > 0 && selectableIndexes.every(index => state.selected.has(index));
    const selectAllButton = document.getElementById('select-all');
    if (selectAllButton) {
      selectAllButton.hidden = selectableIndexes.length === 0;
      selectAllButton.disabled = selectableIndexes.length === 0 || allCurrentSelected;
    }
    const clearSelectionButton = document.getElementById('clear-selection');
    if (clearSelectionButton) {
      clearSelectionButton.hidden = state.selected.size === 0;
      clearSelectionButton.disabled = state.selected.size === 0;
    }
    const selectedOpenActions = document.getElementById('selected-open-actions');
    if (selectedOpenActions) selectedOpenActions.hidden = state.selected.size === 0;
    const openSelectedMolstar = document.getElementById('open-selected-molstar');
    if (openSelectedMolstar) openSelectedMolstar.disabled = state.selected.size === 0;
    const openSelectedKetcher = document.getElementById('open-selected-ketcher');
    if (openSelectedKetcher) openSelectedKetcher.disabled = state.selected.size === 0 || Date.now() < state.ketcherOpenPendingUntil;
    syncGridClusterControls();
    syncRdkitCoordinatesControl();
    syncGridEditControls();
    let footerText;
    if (state.smartsError) {
      footerText = `SMARTS error: ${state.smartsError}`;
    } else if (state.dirty) {
      footerText = `Unsaved changes. Use Save to overwrite the source file, Save As to write a new file, or Undo to revert the last edit.`;
    } else if (state.indexing) {
      footerText = `Indexing continues in the background. Search and sort use ${included.toLocaleString()} indexed molecules so far.`;
    } else if (total > included && !state.remoteMode) {
      footerText = `Showing first ${included.toLocaleString()} of ${total.toLocaleString()} records.`;
    } else if (hasMoreRows()) {
      footerText = `Scroll to load more. ${scrollable.toLocaleString()} of ${visible.toLocaleString()} visible molecules are scrollable.`;
    } else if (state.remoteMode) {
      footerText = 'Desktop grid runtime loads rows on demand and keeps only the active window mounted.';
    } else {
      footerText = state.cardRenderer === 'xyzrender'
        ? 'External xyzrender card rendering.'
        : 'Offline RDKit.js rendering with windowed cards. No network access required.';
    }
    document.getElementById('footer').textContent = footerText;
    updateGridRail();
  }

  function moleculeCountLabel(count) {
    const numeric = Math.max(0, Number(count || 0));
    return `${numeric.toLocaleString()} ${numeric === 1 ? 'molecule' : 'molecules'}`;
  }

  function initGridRail(cfg) {
    const rail = root.querySelector('[data-buret-grid-rail]');
    const marker = root.querySelector('[data-buret-grid-rail-active]');
    const ticks = root.querySelector('[data-buret-grid-rail-ticks]');
    if (!rail || !ticks) return;
    rail.addEventListener('focusin', () => updateGridRailActive());
    ticks.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target.closest('[data-buret-grid-rail-position], [data-buret-grid-rail-index]') : null;
      if (!target) return;
      const position = Number(target.getAttribute('data-buret-grid-rail-position'));
      const index = Number(target.getAttribute('data-buret-grid-rail-index'));
      if (Number.isFinite(position)) void scrollToGridPosition(position, cfg, { behavior: 'smooth' });
      else scrollToGridRow(index, cfg, { behavior: 'smooth' });
    });
    ticks.addEventListener('pointerenter', event => updateGridRailPopoverFromPointer(event.clientY));
    ticks.addEventListener('pointermove', event => updateGridRailPopoverFromPointer(event.clientY));
    ticks.addEventListener('pointerleave', hideGridRailPopover);
    ticks.addEventListener('pointerdown', event => startGridRailTrackPointer(event, cfg));
    marker?.addEventListener('pointerdown', event => startGridRailDrag(event, cfg));
    window.addEventListener('scroll', updateGridRailActive, { passive: true });
    window.addEventListener('resize', updateGridRailActive, { passive: true });
    updateGridRail();
  }

  function updateGridRail() {
    const rail = root.querySelector('[data-buret-grid-rail]');
    const ticks = root.querySelector('[data-buret-grid-rail-ticks]');
    if (!rail || !ticks) return;
    const rows = state.rows || [];
    rail.hidden = gridRailTotalRows() < 2;
    if (rail.hidden) return;
    const railRows = gridRailRows(rows);
    ticks.innerHTML = railRows.map(({ row, position, active }) => {
      const index = row ? Number(row.index) : null;
      const title = escapeAttr(row?.name || `Molecule ${position + 1}`);
      const indexAttr = Number.isFinite(index) ? ` data-buret-grid-rail-index="${index}"` : '';
      return `<button type="button" class="buret-grid-rail-tick${active ? ' is-active' : ''}" data-buret-grid-rail-position="${position}"${indexAttr} aria-label="${title}"></button>`;
    }).join('');
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
    const cards = [...document.querySelectorAll('.buret-card[data-index], .buret-grid-table-row[data-index]')];
    if (!cards.length) return;
    const threshold = Math.max(96, window.innerHeight * 0.24);
    let activeIndex = Number(cards[0].getAttribute('data-index'));
    for (const card of cards) {
      if (card.getBoundingClientRect().top <= threshold) activeIndex = Number(card.getAttribute('data-index'));
      else break;
    }
    updateGridRailActiveMarker(activeIndex);
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

  function updateGridRailPopoverFromPointer(clientY) {
    const ticks = root.querySelector('[data-buret-grid-rail-ticks]');
    if (!ticks) return;
    const position = gridRailIndexFromPointer(clientY, ticks);
    if (position == null) return;
    showGridRailPopover(position, clientY);
  }

  function showGridRailPopover(position, clientY) {
    const popover = root.querySelector('[data-buret-grid-rail-popover]');
    const ticks = root.querySelector('[data-buret-grid-rail-ticks]');
    if (!popover || !ticks) return;
    const total = gridRailTotalRows();
    if (total < 2) return;
    const target = Math.max(0, Math.min(total - 1, Math.round(position)));
    const row = state.rows[target];
    const indexNode = popover.querySelector('[data-buret-grid-rail-popover-index]');
    const nameNode = popover.querySelector('[data-buret-grid-rail-popover-name]');
    if (indexNode) indexNode.textContent = `${(target + 1).toLocaleString()} / ${total.toLocaleString()}`;
    if (nameNode) nameNode.textContent = row?.name || `Molecule ${target + 1}`;
    const rect = ticks.getBoundingClientRect();
    const y = Math.max(rect.top, Math.min(clientY, rect.bottom));
    popover.style.setProperty('--buret-grid-rail-popover-offset', `${(y - rect.top - rect.height / 2).toFixed(2)}px`);
    popover.hidden = false;
  }

  function hideGridRailPopover() {
    const popover = root.querySelector('[data-buret-grid-rail-popover]');
    if (popover) popover.hidden = true;
  }

  function scrollToGridRow(index, cfg, options = {}) {
    const behavior = options.behavior || (state.railDragging ? 'auto' : 'smooth');
    let card = document.querySelector(`.buret-card[data-index="${index}"], .buret-grid-table-row[data-index="${index}"]`);
    if (card) {
      state.pendingGridScrollIndex = null;
      scrollGridCardIntoView(card, behavior);
      return;
    }
    const rowIndex = state.rows.findIndex(row => Number(row.index) === index);
    if (rowIndex >= 0) {
      state.pendingGridScrollIndex = index;
      state.visibleCount = Math.min(state.rows.length, Math.max(state.visibleCount, rowIndex + 1));
      scrollToEstimatedGridRow(rowIndex, behavior);
      if (state.rendering) {
        state.pendingLoad = true;
        return;
      }
      void renderVirtualWindow(cfg, state.token, { force: true });
      return;
    }
    state.pendingGridScrollIndex = null;
  }

  async function scrollToGridPosition(position, cfg, options = {}) {
    if (!Number.isFinite(position)) return;
    const total = gridRailTotalRows();
    const target = Math.max(0, Math.min(total - 1, Math.round(position)));
    if (state.remoteMode && target >= state.rows.length) {
      await loadRemoteRowsThrough(target, cfg, options);
    }
    const row = state.rows[target];
    if (row) scrollToGridRow(Number(row.index), cfg, options);
  }

  async function loadRemoteRowsThrough(position, cfg, options = {}) {
    if (!state.remoteMode || state.remoteLoading) {
      state.pendingGridRailPosition = position;
      return;
    }
    const token = state.token;
    state.remoteLoading = true;
    try {
      while (token === state.token && state.rows.length <= position && state.rows.length < state.totalRows) {
        const result = await hostRequest('gridFetchPage', gridFetchPayload({
          query: state.query || '',
          sort: state.sort || 'index',
          offset: state.rows.length,
          limit: Math.max(loadBatchSize(cfg), 240)
        }));
        if (token !== state.token) return;
        const nextRows = applyVirtualGridEdits(await hydrateDataWarriorRows(Array.isArray(result.rows) ? result.rows : [], cfg));
        state.totalRows = Number(result.totalRows || state.totalRows);
        if (!nextRows.length) break;
        state.rows.push(...nextRows);
        invalidateTableColumnCatalog();
      }
      if (position < state.rows.length) {
        const row = state.rows[position];
        if (row) state.pendingGridScrollIndex = Number(row.index);
        state.visibleCount = Math.min(state.rows.length, Math.max(state.visibleCount, position + 1));
        if (state.rendering) {
          state.pendingLoad = true;
          return;
        }
        scrollToEstimatedGridRow(position, options.behavior || 'auto');
        await renderVirtualWindow(cfg, state.token, { force: true });
      }
    } catch (error) {
      setStatus(error?.message || String(error), 'error');
    } finally {
      state.remoteLoading = false;
      const pending = state.pendingGridRailPosition;
      state.pendingGridRailPosition = null;
      if (pending != null && pending !== position) void scrollToGridPosition(pending, cfg, options);
    }
  }

  function scrollPendingGridRow() {
    if (state.pendingGridScrollIndex == null) return false;
    const card = document.querySelector(`.buret-card[data-index="${state.pendingGridScrollIndex}"], .buret-grid-table-row[data-index="${state.pendingGridScrollIndex}"]`);
    if (!card) return false;
    state.pendingGridScrollIndex = null;
    scrollGridCardIntoView(card, 'auto');
    return true;
  }

  function scrollGridCardIntoView(card, behavior = 'smooth') {
    card.scrollIntoView({ block: 'center', behavior });
    updateGridRailActive();
  }

  function scrollToEstimatedGridRow(position, behavior = state.railDragging ? 'auto' : 'smooth') {
    const grid = document.getElementById('grid');
    if (!grid || !Number.isFinite(position)) return;
    updateVirtualGridMetrics();
    const gridTop = grid.getBoundingClientRect().top + scrollTop();
    const row = Math.floor(Math.max(0, position) / Math.max(1, state.estimatedColumnCount));
    window.scrollTo({ top: Math.max(0, gridTop + row * estimatedRowStride()), behavior });
  }

  function startGridRailDrag(event, cfg) {
    if (event.button != null && event.button !== 0) return;
    const marker = event.currentTarget;
    const ticks = root.querySelector('[data-buret-grid-rail-ticks]');
    if (!marker || !ticks) return;
    event.preventDefault();
    event.stopPropagation();
    state.railDragging = true;
    document.body.classList.add('buret-grid-rail-dragging');
    const pointerId = event.pointerId;
    try { marker.setPointerCapture(pointerId); } catch (_) {}
    const updateFromPoint = clientY => {
      const position = gridRailIndexFromPointer(clientY, ticks);
      if (position == null) return;
      showGridRailPopover(position, clientY);
      scrollToGridPosition(position, cfg, { behavior: 'auto' });
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
      hideGridRailPopover();
      updateGridRailActive();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd, { once: true });
    window.addEventListener('pointercancel', onEnd, { once: true });
  }

  function startGridRailTrackPointer(event, cfg) {
    if (event.button != null && event.button !== 0) return;
    const ticks = root.querySelector('[data-buret-grid-rail-ticks]');
    if (!ticks) return;
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    let dragging = false;
    let lastClientY = event.clientY;
    const startClientY = event.clientY;
    try { ticks.setPointerCapture(pointerId); } catch (_) {}
    updateGridRailPopoverFromPointer(event.clientY);
    const scrollFromPoint = (clientY, behavior) => {
      const position = gridRailIndexFromPointer(clientY, ticks);
      if (position == null) return;
      showGridRailPopover(position, clientY);
      scrollToGridPosition(position, cfg, { behavior });
    };
    const onMove = moveEvent => {
      if (moveEvent.pointerId !== pointerId) return;
      lastClientY = moveEvent.clientY;
      if (Math.abs(lastClientY - startClientY) > 4) dragging = true;
      if (!dragging) {
        updateGridRailPopoverFromPointer(lastClientY);
        return;
      }
      state.railDragging = true;
      document.body.classList.add('buret-grid-rail-dragging');
      scrollFromPoint(lastClientY, 'auto');
    };
    const onEnd = () => {
      if (!dragging) scrollFromPoint(lastClientY, 'smooth');
      state.railDragging = false;
      document.body.classList.remove('buret-grid-rail-dragging');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      hideGridRailPopover();
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
    installCardDrop(el, row, cfg);
    return el;
  }

  function gridTable(rows, cfg, range) {
    const catalog = tableColumnCatalog();
    const allColumns = tableVisibleColumns(catalog);
    const columnWindow = tableColumnWindow(allColumns);
    const columns = tableRenderedColumns(columnWindow);
    const searchColumns = tableSearchMatchColumns(rows, columns);
    const columnSpan = tableRenderedColumnSpan(columnWindow);
    const wrapper = document.createElement('div');
    wrapper.className = 'buret-grid-table-wrap';
    wrapper.tabIndex = 0;
    wrapper.setAttribute('aria-label', 'Molecule table');
    wrapper.innerHTML = `
      ${state.tableColumnPanelOpen ? tableColumnPanelHTML(catalog, allColumns) : ''}
      <table class="buret-grid-table">
        <thead>
          <tr>${tableHeaderCellsHTML(columnWindow, searchColumns)}</tr>
          ${state.tableFiltersOpen ? `<tr class="buret-grid-table-filter-row">${tableFilterCellsHTML(columnWindow, searchColumns)}</tr>` : ''}
        </thead>
        <tbody>
          ${range.topHeight > 0 ? `<tr class="buret-grid-table-spacer" aria-hidden="true"><td colspan="${columnSpan}" style="height:${Math.max(0, Math.round(range.topHeight))}px"></td></tr>` : ''}
          ${rows.map(row => tableRowHTML(row, columns, cfg)).join('')}
          ${range.bottomHeight > 0 ? `<tr class="buret-grid-table-spacer" aria-hidden="true"><td colspan="${columnSpan}" style="height:${Math.max(0, Math.round(range.bottomHeight))}px"></td></tr>` : ''}
        </tbody>
      </table>`;
    wrapper.scrollLeft = state.tableScrollLeft;
    wrapper.addEventListener('scroll', () => handleTableColumnScroll(wrapper, cfg), { passive: true });
    wrapper.addEventListener('wheel', event => handleTableWheel(event, wrapper, cfg), { passive: false });
    wrapper.querySelectorAll('[data-buret-table-filter-toggle]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        toggleTableFilters(cfg);
      });
    });
    wrapper.querySelectorAll('.buret-grid-table-row').forEach(rowEl => {
      const index = Number(rowEl.getAttribute('data-index'));
      const row = state.rows.find(candidate => Number(candidate.index) === index);
      if (!row) return;
      rowEl.addEventListener('click', event => handleTableRowSelection(event, row, cfg, rowEl));
      rowEl.addEventListener('keydown', event => {
        if (event.key === ' ' || event.key === 'Enter') handleTableRowSelection(event, row, cfg, rowEl);
      });
      rowEl.addEventListener('dblclick', event => handleTableRowOpen(event, row, cfg));
      rowEl.addEventListener('contextmenu', event => showMoleculeContextMenu(event, row));
      installTableMoleculeHover(rowEl, row, cfg);
      scheduleRdkitCard(rowEl, row);
      scheduleXyzrenderCard(rowEl, row, cfg);
    });
    bindTableColumnPanel(wrapper, cfg, catalog);
    bindTableFilterControls(wrapper, cfg);
    return wrapper;
  }

  function tableColumnCatalog() {
    const rows = tableColumnDiscoveryRows();
    const cacheKey = tableColumnCatalogKey(rows);
    if (state.tableColumnCatalogCache?.key === cacheKey) {
      return state.tableColumnCatalogCache.columns;
    }
    const columns = [
      { id: 'index', label: '#', type: 'number', fixed: true, get: row => String(Number(row.index) + 1) },
      { id: 'molecule', label: 'Mol', type: 'none', fixed: true, html: (row, cfg) => `<div class="buret-grid-table-molecule" data-buret-molecule-picture>${draw(row, cfg)}</div>` },
      { id: 'name', label: 'Name', type: 'text', fixed: true, get: row => row.name || `Molecule ${Number(row.index) + 1}` },
      { id: 'smiles', label: 'SMILES', type: 'text', fixed: true, get: row => rowSmiles(row) }
    ];
    const descriptorColumns = new Map();
    const analysisColumns = new Map();
    const propColumns = new Set();
    for (const row of rows) {
      for (const [id, value] of Object.entries(row.descriptors || {})) {
        if (!descriptorColumns.has(id)) descriptorColumns.set(id, value?.label || id);
      }
      for (const [id, value] of Object.entries(row.analyses || {})) {
        if (!analysisColumns.has(id)) analysisColumns.set(id, {
          runId: value?.runId || '',
          valueId: value?.valueId || id,
          label: id,
          valueKind: value?.valueKind || 'text'
        });
      }
      for (const key of Object.keys(row.props || {})) {
        propColumns.add(key);
      }
    }
    if (state.remoteMode) {
      for (const id of state.remoteDescriptorIds || []) {
        if (!descriptorColumns.has(id)) descriptorColumns.set(id, id);
      }
      for (const column of state.remoteAnalysisColumns || []) {
        const valueId = String(column?.valueId || '');
        if (valueId) analysisColumns.set(valueId, column);
      }
    }
    for (const key of propColumns) {
      columns.push({
        id: `prop:${key}`,
        label: key,
        type: inferPropColumnType(rows, key),
        kind: 'property',
        get: row => row.props?.[key] ?? ''
      });
    }
    for (const [id, label] of descriptorColumns) {
      columns.push({
        id: `descriptor:${id}`,
        label,
        type: 'number',
        kind: 'descriptor',
        title: descriptorHelpText(id, label),
        get: row => descriptorDisplayValue(row.descriptors?.[id])
      });
    }
    for (const [id, analysis] of analysisColumns) {
      const valueKind = String(analysis?.valueKind || 'text');
      columns.push({
        id: `analysis:${id}`,
        label: String(analysis?.label || id),
        type: valueKind === 'integer' || valueKind === 'real' ? 'number' : 'text',
        kind: 'analysis',
        title: `Analysis result ${id} · run ${String(analysis?.runId || '')}`,
        get: row => analysisDisplayValue(row.analyses?.[id])
      });
    }
    columns.forEach(column => {
      column.searchText = tableColumnPickerSearchText(column);
    });
    state.tableColumnCatalogCache = { key: cacheKey, columns };
    return columns;
  }

  function invalidateTableColumnCatalog() {
    state.tableColumnCatalogCache = null;
  }

  function tableColumnDiscoveryRows() {
    return state.remoteMode ? state.rows : currentLocalCollectionRows();
  }

  function tableColumnCatalogKey(rows) {
    const first = rows[0];
    const last = rows[rows.length - 1];
    const firstKey = tableColumnCatalogRowKey(first);
    const lastKey = tableColumnCatalogRowKey(last);
    const sourceSize = state.remoteMode ? state.rows.length : state.all.length;
    return [
      state.remoteMode ? 'remote' : 'local',
      sourceSize,
      rows.length,
      state.totalRows,
      state.recordsIndexed,
      state.remoteMode ? (state.remoteDescriptorIds || []).join('\u001f') : '',
      state.remoteMode ? JSON.stringify(state.remoteAnalysisColumns || []) : '',
      firstKey,
      lastKey,
      state.rowPatches.size,
      state.insertedRows.length,
      state.hiddenRows.size
    ].join('|');
  }

  function tableColumnCatalogRowKey(row) {
    if (!row) return 'empty';
    return `${row.rowId ?? ''}:${row.index ?? ''}:${Object.keys(row.descriptors || {}).length}:${Object.keys(row.analyses || {}).length}:${Object.keys(row.props || {}).length}`;
  }

  function tableVisibleColumns(catalog) {
    return catalog.filter(column => column.fixed || !state.tableHiddenColumns.has(column.id));
  }

  function tableColumnWindow(columns) {
    const viewportWidth = tableViewportWidth();
    const scrollLeft = Math.max(0, Number(state.tableScrollLeft) || 0);
    const visibleLeft = Math.max(0, scrollLeft - TABLE_COLUMN_OVERSCAN_PX);
    const visibleRight = scrollLeft + viewportWidth + TABLE_COLUMN_OVERSCAN_PX;
    const widths = columns.map(tableColumnWidth);
    const totalWidth = widths.reduce((sum, width) => sum + width, 0);
    const maxScrollLeft = Math.max(0, totalWidth - viewportWidth);
    if (state.tableScrollLeft > maxScrollLeft) state.tableScrollLeft = maxScrollLeft;
    let offset = 0;
    let start = 0;
    while (start < columns.length && offset + widths[start] < visibleLeft) {
      offset += widths[start];
      start += 1;
    }
    let end = start;
    let rightOffset = offset;
    while (end < columns.length && rightOffset <= visibleRight) {
      rightOffset += widths[end];
      end += 1;
    }
    if (start === end && columns.length) {
      end = Math.min(columns.length, start + 1);
      rightOffset += widths[start] || TABLE_DEFAULT_COLUMN_WIDTH;
    }
    return {
      fixedColumns: [],
      scrollColumns: columns,
      windowColumns: columns.slice(start, end),
      leftSpacerWidth: offset,
      rightSpacerWidth: Math.max(0, totalWidth - rightOffset)
    };
  }

  function tableViewportWidth() {
    const wrapper = document.querySelector('.buret-grid-table-wrap');
    const grid = document.getElementById('grid');
    const width = wrapper?.clientWidth || grid?.clientWidth || window.innerWidth || 960;
    return Math.max(TABLE_DEFAULT_COLUMN_WIDTH, Number(width) || 960);
  }

  function tableRenderedColumns(columnWindow) {
    const columns = [...columnWindow.fixedColumns];
    if (columnWindow.leftSpacerWidth > 0) columns.push(tableSpacerColumn('left', columnWindow.leftSpacerWidth));
    columns.push(...columnWindow.windowColumns);
    if (columnWindow.rightSpacerWidth > 0) columns.push(tableSpacerColumn('right', columnWindow.rightSpacerWidth));
    return columns;
  }

  function tableRenderedColumnSpan(columnWindow) {
    return tableRenderedColumns(columnWindow).length;
  }

  function tableSpacerColumn(side, width) {
    return {
      id: `virtual-spacer:${side}`,
      type: 'none',
      spacer: true,
      width
    };
  }

  function tableColumnWidth(column) {
    if (column.id === 'index') return 64;
    if (column.id === 'molecule') return 74;
    if (column.id === 'name') return 160;
    if (column.id === 'smiles') return 240;
    return TABLE_DEFAULT_COLUMN_WIDTH;
  }

  function tableHeaderCellsHTML(columnWindow, searchColumns = new Set()) {
    return tableRenderedColumns(columnWindow).map(column => {
      if (column.spacer) return tableSpacerCellHTML('th', column);
      const classes = [
        searchColumns.has(column.id) ? 'buret-grid-table-search-column' : '',
        column.type !== 'none' || column.id === 'index' ? 'buret-grid-table-filter-header' : ''
      ].filter(Boolean).join(' ');
      const className = classes ? ` class="${classes}"` : '';
      const filterToggle = column.type !== 'none' || column.id === 'index'
        ? ` data-buret-table-filter-toggle aria-pressed="${state.tableFiltersOpen ? 'true' : 'false'}" title="Show table filters" aria-label="Show table filters for ${escapeAttr(column.label)}"`
        : '';
      if (column.id === 'index') {
        return `<th scope="col" data-column="${escapeHTML(column.id)}"${className}${filterToggle}>${escapeHTML(column.label)}</th>`;
      }
      return `<th scope="col" data-column="${escapeHTML(column.id)}"${className}${filterToggle}${column.title ? ` title="${escapeAttr(column.title)}"` : ''}>${escapeHTML(column.label)}</th>`;
    }).join('');
  }

  function tableFilterCellsHTML(columnWindow, searchColumns = new Set()) {
    return tableRenderedColumns(columnWindow).map(column => column.spacer ? tableSpacerCellHTML('th', column) : tableFilterCellHTML(column, searchColumns)).join('');
  }

  function tableSpacerCellHTML(tagName, column) {
    const width = Math.max(0, Math.round(Number(column.width) || 0));
    return `<${tagName} class="buret-grid-table-column-spacer" data-column="${escapeHTML(column.id)}" style="width:${width}px;min-width:${width}px;max-width:${width}px"></${tagName}>`;
  }

  function tableRowHTML(row, columns, cfg) {
    const index = Number(row.index);
    const selected = state.selected.has(index);
    const className = `buret-grid-table-row${selected ? ' selected' : ''}${state.smartsMatches.has(index) ? ' smarts-match' : ''}`;
    const rowSearchMatch = tableRowMatchesSearch(row, columns);
    const selectionAttributes = capabilities(cfg).selection ? ' tabindex="0"' : '';
    return `
      <tr class="${className}" data-index="${escapeHTML(String(index))}" aria-selected="${selected ? 'true' : 'false'}"${selectionAttributes}>
        ${columns.map(column => {
          if (column.spacer) return tableSpacerCellHTML('td', column);
          const searchMatch = tableColumnMatchesSearch(row, column) || (column.id === 'molecule' && rowSearchMatch);
          const searchClass = searchMatch ? ' class="buret-grid-table-search-match"' : '';
          return `<td data-column="${escapeHTML(column.id)}"${searchClass}>${tableCellHTML(row, column, cfg)}</td>`;
        }).join('')}
      </tr>`;
  }

  function tableCellHTML(row, column, cfg) {
    if (column.html) return column.html(row, cfg);
    return tableHighlightedTextHTML(String(column.get(row) ?? ''));
  }

  function tableHighlightedTextHTML(text) {
    const rawQuery = String(state.query || '').trim();
    if (!rawQuery) return escapeHTML(text);
    const index = text.toLowerCase().indexOf(rawQuery.toLowerCase());
    if (index < 0) return escapeHTML(text);
    const before = text.slice(0, index);
    const match = text.slice(index, index + rawQuery.length);
    const after = text.slice(index + rawQuery.length);
    return `${escapeHTML(before)}<mark class="buret-grid-table-search-mark">${escapeHTML(match)}</mark>${escapeHTML(after)}`;
  }

  function tableFilterCellHTML(column, searchColumns = new Set()) {
    const className = searchColumns.has(column.id) ? ' class="buret-grid-table-search-column"' : '';
    if (column.type === 'none' || column.id === 'index') return `<th data-column="${escapeHTML(column.id)}"${className}></th>`;
    const filter = state.tableColumnFilters[column.id] || {};
    if (column.type === 'number') {
      return `<th data-column="${escapeHTML(column.id)}"${className}>
        <div class="buret-grid-table-number-filter">
          <input type="number" inputmode="decimal" placeholder="min" value="${escapeAttr(filter.min ?? '')}" data-buret-table-filter="${escapeAttr(column.id)}" data-buret-table-filter-part="min" aria-label="Minimum ${escapeAttr(column.label)}">
          <input type="number" inputmode="decimal" placeholder="max" value="${escapeAttr(filter.max ?? '')}" data-buret-table-filter="${escapeAttr(column.id)}" data-buret-table-filter-part="max" aria-label="Maximum ${escapeAttr(column.label)}">
        </div>
      </th>`;
    }
    return `<th data-column="${escapeHTML(column.id)}"${className}>
      <input type="search" value="${escapeAttr(filter.text ?? '')}" placeholder="filter" data-buret-table-filter="${escapeAttr(column.id)}" data-buret-table-filter-part="text" aria-label="Filter ${escapeAttr(column.label)}">
    </th>`;
  }

  function tableSearchMatchColumns(rows, columns) {
    const query = tableSearchQuery();
    if (!query) return new Set();
    const matches = new Set();
    for (const column of columns) {
      if (column.spacer || column.type === 'none') continue;
      if (rows.some(row => tableColumnMatchesSearch(row, column, query))) matches.add(column.id);
    }
    return matches;
  }

  function tableColumnMatchesSearch(row, column, query = tableSearchQuery()) {
    if (!query || !column || column.spacer || column.type === 'none') return false;
    return normalize(tableColumnDisplayValue(row, column.id)).includes(query);
  }

  function tableRowMatchesSearch(row, columns, query = tableSearchQuery()) {
    if (!query) return false;
    return columns.some(column => tableColumnMatchesSearch(row, column, query));
  }

  function tableSearchQuery() {
    return normalize(state.query).trim();
  }

  function tableColumnPanelHTML(catalog, visibleColumns) {
    const manageable = catalog.filter(column => !column.fixed);
    const visible = new Set(visibleColumns.map(column => column.id));
    const query = state.tableColumnQuery;
    const matches = tableColumnPickerMatches(manageable, query);
    const shown = tableColumnPickerShown(matches);
    const visibleManageableCount = manageable.filter(column => visible.has(column.id)).length;
    const allManageableVisible = manageable.length > 0 && visibleManageableCount === manageable.length;
    return `
      <section class="buret-table-column-panel" aria-label="Table columns">
        <button type="button" class="buret-table-column-select-all" data-buret-table-column-action="toggle-all" aria-pressed="${allManageableVisible ? 'true' : 'false'}">
          <span class="buret-table-column-checkbox" aria-hidden="true">${allManageableVisible ? '✓' : ''}</span>
          <span>Select all / none</span>
        </button>
        <input type="search" class="buret-table-column-search" value="${escapeAttr(query)}" placeholder="Search" aria-label="Search columns" data-buret-table-column-search>
        <div class="buret-table-column-summary">${tableColumnPanelSummary(visible.size, catalog.length, shown.length, matches.length, manageable.length)}</div>
        <div class="buret-table-column-list">
          ${tableColumnPickerItemsHTML(shown, visible, matches.length)}
        </div>
      </section>`;
  }

  function tableColumnPickerShown(matches) {
    const limit = Math.max(TABLE_COLUMN_PICKER_LIMIT, Number(state.tableColumnVisibleLimit) || TABLE_COLUMN_PICKER_LIMIT);
    return matches.slice(0, limit);
  }

  function tableColumnPickerMatches(columns, query) {
    const normalized = String(query || '').trim().toLowerCase();
    return normalized
      ? columns.filter(column => tableColumnPickerSearchText(column).includes(normalized))
      : columns;
  }

  function tableColumnPickerSearchText(column) {
    return column.searchText || `${column.label} ${column.id} ${column.kind || ''} ${column.type || ''}`.toLowerCase();
  }

  function tableColumnPanelSummary(visibleCount, totalCount, shownCount, matchCount, manageableCount) {
    const visibleText = `${visibleCount.toLocaleString()} of ${totalCount.toLocaleString()} columns visible`;
    const shownText = matchCount === manageableCount
      ? `showing ${shownCount.toLocaleString()} of ${manageableCount.toLocaleString()} manageable columns`
      : `showing ${shownCount.toLocaleString()} of ${matchCount.toLocaleString()} matches`;
    return `${visibleText} · ${shownText}`;
  }

  function tableColumnPickerItemsHTML(columns, visible, matchCount = columns.length) {
    if (!columns.length) {
      return '<div class="buret-table-column-empty">No matching columns.</div>';
    }
    const items = columns.map(column => `
      <label class="buret-table-column-item" data-column-search="${escapeAttr(tableColumnPickerSearchText(column))}">
        <input type="checkbox" ${visible.has(column.id) ? 'checked' : ''} data-buret-table-column="${escapeAttr(column.id)}">
        <span>${escapeHTML(column.label)}</span>
        <small>${column.kind === 'descriptor' ? 'descriptor' : column.kind === 'analysis' ? 'analysis' : 'property'} / ${column.type}</small>
      </label>
    `).join('');
    const remaining = Math.max(0, matchCount - columns.length);
    if (!remaining) return items;
    return `${items}
      <button type="button" class="buret-table-column-more" data-buret-table-column-show-more>
        Show next ${Math.min(TABLE_COLUMN_PICKER_LIMIT, remaining).toLocaleString()} columns
      </button>`;
  }

  function bindTableColumnPanel(wrapper, cfg, catalog) {
    const panel = wrapper.querySelector('.buret-table-column-panel');
    if (!panel) return;
    state.tableColumnPanelOutsideController?.abort();
    state.tableColumnPanelOutsideController = new AbortController();
    const handleOutsidePointerDown = event => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.buret-table-column-panel, #table-columns')) return;
      closeTableColumnPanel(cfg);
    };
    document.addEventListener('pointerdown', handleOutsidePointerDown, {
      capture: true,
      signal: state.tableColumnPanelOutsideController.signal
    });
    const manageable = catalog.filter(column => !column.fixed);
    const bindColumnToggles = () => {
      panel.querySelectorAll('[data-buret-table-column]').forEach(input => {
        input.addEventListener('change', event => {
          const columnId = event.currentTarget.getAttribute('data-buret-table-column');
          if (!columnId) return;
          if (event.currentTarget.checked) state.tableHiddenColumns.delete(columnId);
          else state.tableHiddenColumns.add(columnId);
          storeStringSet(TABLE_HIDDEN_COLUMNS_STORAGE_KEY, state.tableHiddenColumns);
          void render(cfg);
        });
      });
    };
    const bindShowMore = () => {
      panel.querySelector('[data-buret-table-column-show-more]')?.addEventListener('click', event => {
        event.preventDefault();
        state.tableColumnVisibleLimit += TABLE_COLUMN_PICKER_LIMIT;
        renderColumnList();
      });
    };
    const renderColumnList = () => {
      const list = panel.querySelector('.buret-table-column-list');
      if (!list) return;
      const visible = new Set(tableVisibleColumns(catalog).map(column => column.id));
      const matches = tableColumnPickerMatches(manageable, state.tableColumnQuery);
      const shown = tableColumnPickerShown(matches);
      list.innerHTML = tableColumnPickerItemsHTML(shown, visible, matches.length);
      const summary = panel.querySelector('.buret-table-column-summary');
      if (summary) {
        summary.textContent = tableColumnPanelSummary(visible.size, catalog.length, shown.length, matches.length, manageable.length);
      }
      bindColumnToggles();
      bindShowMore();
    };
    const search = panel.querySelector('[data-buret-table-column-search]');
    if (search) {
      const applySearch = () => {
        const nextQuery = String(search.value || '');
        if (nextQuery !== state.tableColumnQuery) {
          state.tableColumnVisibleLimit = TABLE_COLUMN_PICKER_LIMIT;
        }
        state.tableColumnQuery = nextQuery;
        renderColumnList();
      };
      search.addEventListener('input', applySearch);
      search.addEventListener('keyup', applySearch);
      search.addEventListener('change', applySearch);
      search.addEventListener('search', applySearch);
    }
    bindColumnToggles();
    bindShowMore();
    panel.querySelectorAll('[data-buret-table-column-action]').forEach(button => {
      button.addEventListener('click', event => {
        const action = event.currentTarget.getAttribute('data-buret-table-column-action');
        const descriptorIds = catalog.filter(column => column.kind === 'descriptor').map(column => column.id);
        const matchedIds = tableColumnPickerMatches(manageable, state.tableColumnQuery).map(column => column.id);
        if (action === 'toggle-all') {
          const allVisible = manageable.every(column => !state.tableHiddenColumns.has(column.id));
          manageable.forEach(column => {
            if (allVisible) state.tableHiddenColumns.add(column.id);
            else state.tableHiddenColumns.delete(column.id);
          });
        } else if (action === 'show-all') {
          state.tableHiddenColumns.clear();
        } else if (action === 'show-matches') {
          const matched = new Set(matchedIds);
          manageable.forEach(column => {
            if (matched.has(column.id)) state.tableHiddenColumns.delete(column.id);
            else state.tableHiddenColumns.add(column.id);
          });
        } else if (action === 'hide-matches') {
          matchedIds.forEach(id => state.tableHiddenColumns.add(id));
        } else if (action === 'hide-descriptors') {
          descriptorIds.forEach(id => state.tableHiddenColumns.add(id));
        } else if (action === 'show-descriptors') {
          descriptorIds.forEach(id => state.tableHiddenColumns.delete(id));
        }
        storeStringSet(TABLE_HIDDEN_COLUMNS_STORAGE_KEY, state.tableHiddenColumns);
        void render(cfg);
      });
    });
  }

  function bindTableFilterControls(wrapper, cfg) {
    wrapper.querySelectorAll('[data-buret-table-filter]').forEach(input => {
      input.addEventListener('input', event => {
        const columnId = event.currentTarget.getAttribute('data-buret-table-filter');
        const part = event.currentTarget.getAttribute('data-buret-table-filter-part');
        if (!columnId || !part) return;
        const current = { ...state.tableColumnFilters[columnId] };
        current.type = part === 'text' ? 'text' : 'number';
        current[part] = String(event.currentTarget.value || '');
        if (tableColumnFilterEmpty(current)) delete state.tableColumnFilters[columnId];
        else state.tableColumnFilters[columnId] = current;
        scheduleTableFilterRefresh(cfg);
      });
    });
  }

  function scheduleTableFilterRefresh(cfg) {
    clearTimeout(state.tableFilterTimer);
    state.tableFilterTimer = setTimeout(() => refresh(cfg), 180);
  }

  function tableColumnFilterEmpty(filter) {
    if (!filter) return true;
    if (filter.type === 'number') return !String(filter.min || '').trim() && !String(filter.max || '').trim();
    return !String(filter.text || '').trim();
  }

  function inferPropColumnType(rows, key) {
    let seen = 0;
    for (const row of rows) {
      const value = row.props?.[key];
      if (value === undefined || value === null || String(value).trim() === '') continue;
      seen += 1;
      if (!Number.isFinite(Number(value))) return 'text';
      if (seen >= 50) break;
    }
    return seen > 0 ? 'number' : 'text';
  }

  function tableColumnDisplayValue(row, columnId) {
    if (columnId === 'index') return String(Number(row.index) + 1);
    if (columnId === 'name') return row.name || `Molecule ${Number(row.index) + 1}`;
    if (columnId === 'smiles') return rowSmiles(row);
    if (columnId.startsWith('prop:')) return String(row.props?.[columnId.slice(5)] ?? '');
    if (columnId.startsWith('descriptor:')) return descriptorDisplayValue(row.descriptors?.[columnId.slice('descriptor:'.length)]);
    if (columnId.startsWith('analysis:')) return analysisDisplayValue(row.analyses?.[columnId.slice('analysis:'.length)]);
    return '';
  }

  function tableColumnNumericValue(row, columnId) {
    if (columnId === 'index') return Number(row.index) + 1;
    if (columnId.startsWith('descriptor:')) return descriptorNumericValue(row.descriptors?.[columnId.slice('descriptor:'.length)]);
    if (columnId.startsWith('analysis:')) {
      const value = row.analyses?.[columnId.slice('analysis:'.length)]?.value;
      return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
    }
    const value = Number(tableColumnDisplayValue(row, columnId));
    return Number.isFinite(value) ? value : Number.NaN;
  }

  function installCardDrag(el, row) {
    const record = gridDragRecord(row);
    if (!record) return;
    let cardDragSourceAllowed = true;
    el.draggable = true;
    el.addEventListener('pointerdown', event => {
      cardDragSourceAllowed = isCardDragSource(event.target);
    }, true);
    el.addEventListener('dragstart', event => {
      if (!cardDragSourceAllowed || !isCardDragSource(event.target)) {
        event.preventDefault();
        return;
      }
      const records = gridDragRecordsForRow(row);
      if (!records.length) {
        event.preventDefault();
        return;
      }
      const payload = { paths: [], records };
      try {
        event.dataTransfer?.setData(STRUCTURE_DRAG_MIME, JSON.stringify(payload));
        event.dataTransfer?.setData('text/plain', records.map(item => item.text.trimEnd()).join('\n') + '\n');
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
      } catch (_) {}
    });
    el.addEventListener('dragend', () => {
      cardDragSourceAllowed = true;
    });
  }

  function isCardDragSource(target) {
    if (!(target instanceof Element)) return true;
    return !target.closest('[data-buret-card-resize], button, input, select, textarea, [contenteditable="true"]');
  }

  function installCardDrop(el, row, cfg) {
    el.addEventListener('dragover', event => {
      if (!dataTransferHasStructurePayload(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      el.classList.add('buret-card-drop-target');
    });
    el.addEventListener('dragleave', event => {
      const next = event.relatedTarget;
      if (next instanceof Node && el.contains(next)) return;
      el.classList.remove('buret-card-drop-target');
    });
    el.addEventListener('drop', event => {
      if (!dataTransferHasStructurePayload(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      el.classList.remove('buret-card-drop-target');
      const payload = readStructureDropPayload(event.dataTransfer);
      const sourceCount = payload ? payload.records.length + payload.paths.length + payload.files.length : 0;
      if (!payload || sourceCount !== 1) {
        setStatus('[grid] Drop a single molecule record or file to replace a grid row.', 'error');
        return;
      }
      void replaceGridRowFromDropPayload(row, payload, cfg);
    });
  }

  function dataTransferHasStructurePayload(dataTransfer) {
    const types = dataTransfer?.types;
    if (!types) return false;
    if (typeof types.includes === 'function') return types.includes(STRUCTURE_DRAG_MIME) || types.includes('Files');
    if (typeof types.contains === 'function') return types.contains(STRUCTURE_DRAG_MIME) || types.contains('Files');
    try {
      const values = Array.from(types);
      return values.includes(STRUCTURE_DRAG_MIME) || values.includes('Files');
    } catch (_) {
      return false;
    }
  }

  function readStructureDropPayload(dataTransfer) {
    try {
      const raw = dataTransfer?.getData(STRUCTURE_DRAG_MIME);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          const paths = Array.isArray(parsed?.paths)
            ? [...new Set(parsed.paths.map(path => String(path || '').trim()).filter(Boolean))]
            : [];
          const records = Array.isArray(parsed?.records)
            ? parsed.records.map(normalizeStructureDropRecord).filter(Boolean)
            : [];
          return { paths, records, files: [] };
        } catch (_) {}
      }
      const files = Array.from(dataTransfer?.files || []);
      const paths = [...new Set(files.map(file => String(file?.path || '').trim()).filter(Boolean))];
      const inlineFiles = files.filter(file => !String(file?.path || '').trim());
      if (paths.length > 0 || inlineFiles.length > 0) return { paths, records: [], files: inlineFiles };
    } catch (_) {
      return null;
    }
    return null;
  }

  async function appendGridRecordsFromHost(body, cfg) {
    if (state.remoteMode) {
      setStatus('[grid] Browser append is unavailable for the desktop paged grid.', 'error');
      return;
    }
    const records = Array.isArray(body.records)
      ? body.records.map(normalizeStructureDropRecord).filter(Boolean)
      : [];
    const suppliedRows = Array.isArray(body.rows)
      ? body.rows.map(normalizeGridAppendRow).filter(Boolean)
      : [];
    const errors = [];
    const paths = [...new Set(Array.isArray(body.paths) ? body.paths.map(path => String(path || '').trim()).filter(Boolean) : [])];
    for (const path of paths) {
      try {
        const response = await hostRequest('readStructureText', { path });
        const record = normalizeStructureDropRecord({
          path,
          inputExtension: structureRecordExtension(null, path),
          text: response.text
        });
        if (record) records.push(record);
        else errors.push(`${path}: file is empty`);
      } catch (error) {
        errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const appendedRows = [];
    let nextIndex = nextGridRowIndex();
    for (const row of suppliedRows) {
      appendedRows.push({ ...row, index: nextIndex });
      nextIndex += 1;
    }
    for (const record of records) {
      const result = gridRowsFromStructureRecord(record, cfg, nextIndex);
      if (result.error) errors.push(result.error);
      appendedRows.push(...result.rows);
      nextIndex += result.rows.length;
    }
    if (!appendedRows.length) {
      setStatus(errors[0] || '[grid] No supported molecule records were provided for append.', 'error');
      return;
    }
    pushUndoSnapshot('append molecules');
    state.all.push(...appendedRows);
    window.BurreteGridRecords = state.all;
    state.selected.clear();
    state.selectionAnchorIndex = null;
    state.svgCache.clear();
    state.xyzrenderCardCache.clear();
    invalidateTableColumnCatalog();
    markGridDirty('appended molecules');
    refresh(cfg);
    const message = `[grid] Added ${appendedRows.length.toLocaleString()} molecule${appendedRows.length === 1 ? '' : 's'}.`;
    setStatus(errors.length ? `${message} Skipped ${errors.length.toLocaleString()} unsupported source${errors.length === 1 ? '' : 's'}: ${errors[0]}` : message, errors.length ? 'error' : 'info');
  }

  function gridRowsFromStructureRecord(record, cfg, startIndex) {
    const extension = structureRecordExtension(record, record?.path);
    const targetFormat = String(cfg?.format || '').toLowerCase();
    const sourceFormat = extension === 'sdf' || extension === 'sd'
      ? 'sdf'
      : extension === 'smi' || extension === 'smiles'
      ? 'smiles'
      : '';
    if (!sourceFormat || sourceFormat !== targetFormat) {
      return {
        rows: [],
        error: `${record?.path || 'Molecule record'}: cannot append ${sourceFormat || extension || 'unknown'} records to ${targetFormat || 'this'} grid`
      };
    }
    const recordTexts = sourceFormat === 'sdf'
      ? splitSdfDropRecords(record.text)
      : String(record.text || '').split(/\r?\n/u).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
    const rows = [];
    for (const text of recordTexts) {
      const index = startIndex + rows.length;
      const patch = recordToGridRowPatch({ ...record, text }, { index, name: `Molecule ${index + 1}`, props: {} });
      if (!patch) continue;
      rows.push({
        index,
        name: patch.name,
        molblock: patch.molblock || '',
        smiles: patch.smiles || '',
        props: patch.props || {}
      });
    }
    return {
      rows,
      error: rows.length ? '' : `${record?.path || 'Molecule record'}: no supported molecule records found`
    };
  }

  function normalizeGridAppendRow(row) {
    if (!row || typeof row !== 'object') return null;
    const props = row.props && typeof row.props === 'object'
      ? Object.fromEntries(Object.entries(row.props)
        .filter(([key, value]) => String(key).trim() && String(value ?? '').trim())
        .map(([key, value]) => [String(key), String(value)]))
      : {};
    const descriptors = row.descriptors && typeof row.descriptors === 'object' ? row.descriptors : null;
    return {
      name: String(row.name || '').trim() || 'Molecule',
      molblock: String(row.molblock || '').trimEnd(),
      smiles: String(row.smiles || '').trim(),
      props,
      ...(descriptors ? { descriptors } : {})
    };
  }

  function splitSdfDropRecords(text) {
    const records = [];
    let lines = [];
    const finish = () => {
      const record = lines.join('\n').trim();
      lines = [];
      if (record) records.push(record);
    };
    for (const line of String(text || '').replace(/\r\n?/gu, '\n').split('\n')) {
      if (/^\s*\$\$\$\$\s*$/u.test(line)) finish();
      else lines.push(line);
    }
    finish();
    return records;
  }

  async function replaceGridRowFromDropPayload(row, payload, cfg) {
    let record = payload.records[0] || null;
    if (!record && payload.files.length === 1) {
      const file = payload.files[0];
      if (Number(file?.size || 0) > 25 * 1024 * 1024) {
        setStatus('[grid] Dropped file is larger than the 25 MB row-replacement limit.', 'error');
        return;
      }
      try {
        const text = typeof file?.text === 'function' ? await file.text() : '';
        record = normalizeStructureDropRecord({
          path: String(file?.name || 'dropped-structure'),
          inputExtension: structureRecordExtension(null, file?.name),
          text
        });
      } catch (error) {
        setStatus(`[grid] Could not read dropped file: ${error instanceof Error ? error.message : String(error)}`, 'error');
        return;
      }
    }
    if (!record && payload.paths.length === 1) {
      const path = payload.paths[0];
      try {
        const response = await hostRequest('readStructureText', { path });
        record = normalizeStructureDropRecord({
          path,
          inputExtension: structureRecordExtension(null, path),
          text: response.text
        });
      } catch (error) {
        setStatus(`[grid] Could not read dropped file: ${error instanceof Error ? error.message : String(error)}`, 'error');
        return;
      }
    }
    const recordExtension = structureRecordExtension(record, record?.path);
    if ((recordExtension === 'sdf' || recordExtension === 'sd') && splitSdfDropRecords(record?.text).length !== 1) {
      setStatus('[grid] Drop exactly one SDF molecule to replace a grid row.', 'error');
      return;
    }
    const patch = recordToGridRowPatch(record, row);
    if (!patch) {
      setStatus('[grid] Dropped molecule record is not supported for grid row replacement.', 'error');
      return;
    }
    if (replaceGridRow(row, patch, cfg)) {
      setStatus(`[grid] Replaced ${row.name || `Molecule ${Number(row.index) + 1}`} with ${patch.name}. Unsaved changes.`);
    }
  }

  function normalizeStructureDropRecord(record) {
    const text = String(record?.text || '').trim();
    if (!text) return null;
    const path = String(record?.path || '').trim();
    const inputExtension = structureRecordExtension(record, path);
    return { path, inputExtension, text };
  }

  function structureRecordExtension(record, path) {
    const explicit = String(record?.inputExtension || '').trim().toLowerCase().replace(/^\./u, '');
    if (explicit) return explicit;
    const match = String(path || '').match(/\.([a-z0-9]+)$/iu);
    return match ? match[1].toLowerCase() : '';
  }

  function recordToGridRowPatch(record, row) {
    const extension = structureRecordExtension(record, record?.path);
    const text = String(record?.text || '').trim();
    if (!text) return null;
    const fallbackName = row?.name || `Molecule ${Number(row?.index) + 1 || 1}`;
    if (extension === 'sdf' || extension === 'sd' || extension === 'mol') {
      const parsed = parseSdfRecordPatch(text);
      const molblock = parsed.molblock;
      if (!molblock) return null;
      const title = molblock.split(/\r?\n/u).find(line => line.trim()) || '';
      return {
        name: structureRecordDisplayName(record, title, fallbackName),
        molblock,
        smiles: parsed.smiles,
        props: { ...row?.props, ...parsed.props }
      };
    }
    if (extension === 'smi' || extension === 'smiles') {
      const firstLine = text.split(/\r?\n/u).find(line => line.trim()) || '';
      const parts = firstLine.trim().split(/\s+/u);
      const smiles = parts[0] || '';
      if (!smiles) return null;
      const inlineName = parts.slice(1).join(' ');
      return {
        name: structureRecordDisplayName(record, inlineName, fallbackName),
        molblock: '',
        smiles
      };
    }
    return null;
  }

  function structureRecordDisplayName(record, preferred, fallback) {
    const value = String(preferred || '').trim();
    if (value) return value;
    const path = String(record?.path || '').trim();
    const base = path.split(/[\\/]/u).pop()?.replace(/\.[^.]+$/u, '').trim();
    return base || String(fallback || '').trim() || 'Molecule';
  }

  function parseSdfRecordPatch(text) {
    const record = String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split(/\n\$\$\$\$\s*/u)[0]
      .trimEnd();
    const lines = record.split('\n');
    const propStart = lines.findIndex(line => /^>\s*</u.test(line));
    const molblockLines = propStart >= 0 ? lines.slice(0, propStart) : lines;
    const props = propStart >= 0 ? parseSdfRecordProps(lines.slice(propStart)) : {};
    const smilesKey = Object.keys(props).find(key => key.toLowerCase() === 'smiles');
    const smiles = smilesKey ? String(props[smilesKey] || '').trim() : '';
    if (smilesKey) delete props[smilesKey];
    return {
      molblock: molblockLines.join('\n').trimEnd(),
      smiles,
      props
    };
  }

  function parseSdfRecordProps(lines) {
    const props = {};
    for (let index = 0; index < lines.length; index++) {
      const header = String(lines[index] || '').match(/^>\s*<([^>]+)>/u);
      if (!header) continue;
      const key = header[1].trim();
      if (!key) continue;
      const values = [];
      index++;
      while (index < lines.length) {
        const line = String(lines[index] || '');
        if (/^>\s*</u.test(line)) {
          index--;
          break;
        }
        if (!line.trim()) break;
        values.push(line);
        index++;
      }
      props[key] = values.join('\n').trimEnd();
    }
    return props;
  }

  function replaceGridRow(row, patch, cfg, options = {}) {
    const index = Number(row?.index);
    if (!Number.isFinite(index)) return false;
    if (options.undo !== false) pushUndoSnapshot('replace molecule');
    let replaced = false;
    const replace = candidate => {
      if (Number(candidate?.index) !== index) return candidate;
      replaced = true;
      return {
        ...candidate,
        name: patch.name,
        molblock: patch.molblock,
        smiles: patch.smiles,
        index: candidate.index,
        props: patch.props || candidate.props || {}
      };
    };
    state.rows = state.rows.map(replace);
    if (!replaced) return false;
    if (!state.remoteMode) state.all = state.all.map(replace);
    state.rowPatches.set(index, {
      name: patch.name,
      molblock: patch.molblock,
      smiles: patch.smiles,
      props: patch.props || row.props || {}
    });
    invalidateTableColumnCatalog();
    state.svgCache.clear();
    state.xyzrenderCardCache.clear();
    markGridDirty('row edits');
    void render(cfg);
    return true;
  }

  function duplicateGridRow(row, cfg) {
    const index = Number(row?.index);
    if (!Number.isFinite(index)) return false;
    pushUndoSnapshot('duplicate molecule');
    const duplicate = {
      ...row,
      index: nextGridRowIndex(),
      name: `${row.name || `Molecule ${index + 1}`} copy`,
      props: { ...row.props }
    };
    insertAfterRow(state.rows, index, duplicate);
    if (state.remoteMode) state.insertedRows.push(duplicate);
    else insertAfterRow(state.all, index, duplicate);
    invalidateTableColumnCatalog();
    state.totalRows += 1;
    markGridDirty('row edits');
    void render(cfg);
    return true;
  }

  function insertAfterRow(rows, index, row) {
    const position = rows.findIndex(candidate => Number(candidate.index) === index);
    if (position >= 0) rows.splice(position + 1, 0, row);
    else rows.push(row);
  }

  function nextGridRowIndex() {
    const indexes = [...state.rows, ...state.all, ...state.insertedRows]
      .map(row => Number(row?.index))
      .filter(Number.isFinite);
    return indexes.length ? Math.max(...indexes) + 1 : 0;
  }

  function applyKetcherGridRow(body, cfg) {
    const rowIndex = Number(body.rowIndex);
    if (!Number.isFinite(rowIndex)) {
      setStatus('[grid] Ketcher Apply did not identify a grid row.', 'error');
      return;
    }
    const text = String(body.text || '').trim();
    const extension = String(body.extension || 'sdf').trim().toLowerCase().replace(/^\./u, '') || 'sdf';
    const row = [...state.rows, ...state.all].find(candidate => Number(candidate.index) === rowIndex);
    if (!row) {
      setStatus('[grid] Ketcher Apply target row is no longer visible.', 'error');
      return;
    }
    const patch = recordToGridRowPatch({
      path: body.title || row.name || `molecule-${rowIndex + 1}.${extension}`,
      inputExtension: extension,
      text
    }, row);
    if (!patch) {
      setStatus('[grid] Ketcher Apply returned an unsupported molecule record.', 'error');
      return;
    }
    if (replaceGridRow(row, patch, cfg)) {
      setStatus(`[grid] Applied Ketcher edit to ${row.name || `Molecule ${rowIndex + 1}`}. Unsaved changes.`);
    }
  }

  function gridDragRecordsForRow(row) {
    const rowIndex = Number(row?.index);
    if (!Number.isFinite(rowIndex) || !state.selected.has(rowIndex) || state.selected.size < 2) {
      return [gridDragRecord(row)].filter(Boolean);
    }
    const pool = state.remoteMode ? state.rows : state.all;
    return pool
      .filter(candidate => state.selected.has(Number(candidate.index)))
      .map(candidate => gridDragRecord(candidate))
      .filter(Boolean);
  }

  function gridDragRecord(row) {
    const label = String(row?.name || `Molecule ${Number(row?.index) + 1 || 1}`).trim() || 'Molecule';
    const baseName = safeStructureFileStem(label, Number(row?.index));
    const molblock = String(row?.molblock || '').trimEnd();
    if (molblock.trim()) {
      const text = serializeSdfRows([row]);
      return {
        path: `${baseName}.sdf`,
        inputExtension: 'sdf',
        text
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
    root.querySelectorAll('.buret-card[data-index], .buret-grid-table-row[data-index]').forEach(card => {
      const index = Number(card.getAttribute('data-index'));
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

  function selectPoseReviewRow(activePose, cfg) {
    const index = Math.max(0, Math.trunc(Number(activePose) || 0));
    state.selected.clear();
    state.selected.add(index);
    state.selectionAnchorIndex = index;
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
    if (event.target?.closest?.('button, input, select, textarea, [contenteditable="true"]')) return;
    if (event instanceof MouseEvent && event.button !== 0) return;
    event.preventDefault();
    hideMoleculeContextMenu();
    const index = Number(row.index);
    if (event.shiftKey) selectRangeTo(index, cfg);
    else toggleSelection(index, cfg);
    cardElement?.focus?.({ preventScroll: true });
  }

  function handleTableRowSelection(event, row, cfg, rowElement) {
    if (!capabilities(cfg).selection) return;
    if (event.defaultPrevented || event.target?.closest?.('button, input, select, textarea, [contenteditable="true"]')) return;
    if (event instanceof MouseEvent && event.button !== 0) return;
    event.preventDefault();
    hideMoleculeContextMenu();
    const index = Number(row.index);
    if (event.shiftKey) selectRangeTo(index, cfg);
    else toggleSelection(index, cfg);
    rowElement?.focus?.({ preventScroll: true });
  }

  function handleTableRowOpen(event, row, cfg) {
    if (event.defaultPrevented || event.target?.closest?.('button, input, select, textarea, [contenteditable="true"]')) return;
    if (event instanceof MouseEvent && event.button !== 0) return;
    event.preventDefault();
    hideMoleculeContextMenu();
    showMoleculeDetail(row, cfg);
    setStatus(`[grid] Opened ${row.name || `Molecule ${Number(row.index) + 1}`}.`);
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

  function isMoleculeContextTarget(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest('[data-buret-card-resize], button, input, select, textarea, [contenteditable="true"]')) return false;
    return !!target.closest('[data-buret-molecule-picture], .buret-card');
  }

  function removeGridRow(row, options = {}) {
    const index = Number(row.index);
    if (options.undo !== false) pushUndoSnapshot('delete molecule');
    state.selected.delete(index);
    state.hiddenRows.add(index);
    if (!state.remoteMode) {
      const allIndex = state.all.findIndex(candidate => Number(candidate.index) === index);
      if (allIndex >= 0) state.all.splice(allIndex, 1);
    }
    state.rows = state.rows.filter(candidate => Number(candidate.index) !== index);
    invalidateTableColumnCatalog();
    state.totalRows = Math.max(0, state.totalRows - 1);
    markGridDirty('row edits');
  }

  function markGridDirty(reason) {
    const wasDirty = state.dirty;
    state.dirty = true;
    state.dirtyReason = reason || state.dirtyReason || 'edits';
    if (!wasDirty) notifyGridDirty(true);
    syncGridEditControls();
  }

  function markGridClean() {
    const wasDirty = state.dirty;
    state.dirty = false;
    state.dirtyReason = '';
    state.undoStack = [];
    if (wasDirty) notifyGridDirty(false);
    syncGridEditControls();
  }

  function notifyGridDirty(dirty) {
    const cfg = window.BurreteConfig && typeof window.BurreteConfig === 'object' ? window.BurreteConfig : {};
    post('gridDirtyChanged', dirty ? '[grid] Unsaved changes.' : '[grid] Saved changes.', {
      documentId: cfg.documentId || null,
      dirty,
      dirtyReason: dirty ? state.dirtyReason : ''
    });
  }

  function snapshotGridEditState() {
    return {
      rows: state.rows.slice(),
      all: state.all.slice(),
      totalRows: state.totalRows,
      hiddenRows: new Set(state.hiddenRows),
      selected: new Set(state.selected),
      rowPatches: new Map(state.rowPatches),
      insertedRows: state.insertedRows.slice(),
      dirty: state.dirty,
      dirtyReason: state.dirtyReason
    };
  }

  function restoreGridEditState(snapshot) {
    state.rows = snapshot.rows.slice();
    state.all = snapshot.all.slice();
    state.totalRows = snapshot.totalRows;
    state.hiddenRows = new Set(snapshot.hiddenRows);
    state.selected = new Set(snapshot.selected);
    state.rowPatches = new Map(snapshot.rowPatches);
    state.insertedRows = snapshot.insertedRows.slice();
    state.dirty = snapshot.dirty;
    state.dirtyReason = snapshot.dirtyReason;
    invalidateTableColumnCatalog();
    state.svgCache.clear();
    state.xyzrenderCardCache.clear();
    notifyGridDirty(state.dirty);
    syncGridEditControls();
  }

  function pushUndoSnapshot(label) {
    state.undoStack.push({
      label: String(label || 'edit'),
      snapshot: snapshotGridEditState()
    });
    if (state.undoStack.length > 50) state.undoStack.shift();
    syncGridEditControls();
  }

  function undoLastGridEdit(cfg) {
    const entry = state.undoStack.pop();
    if (!entry) {
      syncGridEditControls();
      return;
    }
    restoreGridEditState(entry.snapshot);
    setStatus(`[grid] Undid ${entry.label}.`);
    void render(cfg);
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

  function showMoleculeDetail(row, cfg) {
    hideMoleculeDetail();
    const index = Number(row.index);
    const overlay = document.createElement('div');
    overlay.className = 'buret-grid-molecule-detail-overlay';
    overlay.dataset.buretDetailRowIndex = Number.isFinite(index) ? String(index) : '';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', row.name || `Molecule ${index + 1}`);
    const props = Object.entries(row.props || {})
      .filter(([, value]) => String(value ?? '').trim().length > 0);
    overlay.innerHTML = `
      <div class="buret-grid-molecule-detail">
        <div class="buret-grid-molecule-detail-image" data-buret-molecule-picture>${draw(row, cfg)}</div>
        <div class="buret-grid-molecule-detail-resizer" role="separator" aria-orientation="vertical" tabindex="0" title="Drag left or right to resize the molecule preview. Double-click to reset." aria-label="Resize molecule preview" data-buret-detail-resize></div>
        <div class="buret-grid-molecule-detail-body">
          <div class="buret-grid-molecule-detail-title-row">
            <div>
              <div class="buret-eyebrow">Molecule ${Number.isFinite(index) ? index + 1 : ''}</div>
              <h2>${escapeHTML(row.name || `Molecule ${index + 1}`)}</h2>
            </div>
            <button type="button" data-buret-detail-close aria-label="Close molecule detail">Close</button>
          </div>
          <div class="buret-grid-molecule-detail-tabs" role="tablist" aria-label="Molecule preview sections">
            <button type="button" role="tab" class="active" aria-selected="true" data-buret-detail-tab="details">Details</button>
            <button type="button" role="tab" aria-selected="false" data-buret-detail-tab="descriptors">Descriptors (${descriptorEntries(row).length.toLocaleString()})</button>
            <button type="button" role="tab" aria-selected="false" data-buret-detail-tab="json">JSON</button>
          </div>
          <div class="buret-grid-molecule-detail-tab-panel" data-buret-detail-panel="details">
            ${row.smiles ? `<div class="buret-grid-molecule-detail-smiles">${escapeHTML(row.smiles)}</div>` : ''}
            ${props.length
              ? `<dl class="buret-grid-molecule-detail-props">${props.map(([key, value]) => `<dt>${escapeHTML(key)}</dt><dd>${escapeHTML(value)}</dd>`).join('')}</dl>`
              : '<div class="buret-no-metadata">No metadata</div>'}
          </div>
          <div class="buret-grid-molecule-detail-tab-panel" data-buret-detail-panel="descriptors" hidden>
            ${moleculeDetailDescriptors(row)}
          </div>
          <div class="buret-grid-molecule-detail-tab-panel" data-buret-detail-panel="json" hidden>
            <pre class="buret-grid-molecule-detail-json">${escapeHTML(moleculeDetailJson(row))}</pre>
          </div>
          <div class="buret-grid-molecule-detail-actions">
            <button type="button" data-buret-detail-action="descriptors">Calculate descriptors</button>
            <button type="button" data-buret-detail-action="molstar">Open in Mol*</button>
            <button type="button" data-buret-detail-action="ketcher">Edit in Ketcher</button>
            <button type="button" data-buret-detail-action="generate3d">Generate 3D</button>
            <button type="button" data-buret-detail-action="copy">Copy structure</button>
            <button type="button" data-buret-detail-action="export">Export molecule...</button>
          </div>
        </div>
      </div>`;
    root.appendChild(overlay);
    overlay.querySelector('[data-buret-detail-close]')?.addEventListener('click', hideMoleculeDetail);
    overlay.addEventListener('pointerdown', event => {
      if (event.target === overlay) hideMoleculeDetail();
    });
    overlay.querySelectorAll('[data-buret-detail-action]').forEach(button => {
      button.addEventListener('click', () => {
        const action = button.getAttribute('data-buret-detail-action') || '';
        if (action === 'descriptors') requestDescriptorCalculationForRow(row, cfg);
        else if (action === 'molstar') void requestSingleMolstarDocument(row, cfg);
        else if (action === 'ketcher') requestOpenInKetcher(row, cfg);
        else if (action === 'generate3d') requestSingle3DGeneration(row, cfg);
        else if (action === 'copy') void copyMoleculeStructure(row);
        else if (action === 'export') exportMolecule(row);
      });
    });
    installMoleculeDetailTabs(overlay);
    installMoleculeDetailDescriptorSearch(overlay);
    installMoleculeDetailResize(overlay);
    const onKey = event => {
      if (event.key === 'Escape') hideMoleculeDetail();
    };
    overlay._buretDetailKeyHandler = onKey;
    document.addEventListener('keydown', onKey);
    scheduleRdkitCard(overlay, row);
    scheduleXyzrenderCard(overlay, row, cfg);
    overlay.querySelector('[data-buret-detail-close]')?.focus?.();
  }

  function refreshOpenMoleculeDetail(cfg) {
    const overlay = root.querySelector('.buret-grid-molecule-detail-overlay');
    if (!overlay) return;
    const index = Number(overlay.dataset.buretDetailRowIndex);
    if (!Number.isFinite(index)) return;
    const row = state.all.find(candidate => Number(candidate.index) === index)
      || state.rows.find(candidate => Number(candidate.index) === index);
    if (!row) return;
    const descriptorTab = overlay.querySelector('[data-buret-detail-tab="descriptors"]');
    if (descriptorTab) descriptorTab.textContent = `Descriptors (${descriptorEntries(row).length.toLocaleString()})`;
    const descriptorPanel = overlay.querySelector('[data-buret-detail-panel="descriptors"]');
    if (descriptorPanel) {
      descriptorPanel.innerHTML = moleculeDetailDescriptors(row);
      installMoleculeDetailDescriptorSearch(overlay);
    }
    const jsonPre = overlay.querySelector('.buret-grid-molecule-detail-json');
    if (jsonPre) jsonPre.textContent = moleculeDetailJson(row);
    scheduleRdkitCard(overlay, row);
    scheduleXyzrenderCard(overlay, row, cfg);
  }

  function installMoleculeDetailResize(overlay) {
    const detail = overlay.querySelector('.buret-grid-molecule-detail');
    const handle = overlay.querySelector('[data-buret-detail-resize]');
    if (!detail || !handle) return;
    const minImage = 320;
    const minBody = 320;
    const clampWidth = width => {
      const rect = detail.getBoundingClientRect();
      const handleWidth = handle.getBoundingClientRect().width || 10;
      const maxImage = Math.max(minImage, rect.width - minBody - handleWidth);
      return Math.max(minImage, Math.min(maxImage, width));
    };
    const setWidth = width => {
      detail.style.setProperty('--buret-detail-image-width', `${Math.round(clampWidth(width))}px`);
    };
    const resetWidth = () => {
      detail.style.removeProperty('--buret-detail-image-width');
    };
    const startResize = event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = detail.getBoundingClientRect();
      const startX = event.clientX;
      const startWidth = detail.querySelector('.buret-grid-molecule-detail-image')?.getBoundingClientRect().width || (rect.width * 0.58);
      detail.classList.add('is-resizing');
      try { handle.setPointerCapture?.(event.pointerId); } catch (_) {}
      const move = moveEvent => {
        moveEvent.preventDefault();
        setWidth(startWidth + (moveEvent.clientX - startX));
      };
      const stop = stopEvent => {
        try { handle.releasePointerCapture?.(stopEvent.pointerId); } catch (_) {}
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', stop);
        handle.removeEventListener('pointercancel', stop);
        detail.classList.remove('is-resizing');
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', stop);
      handle.addEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointerdown', startResize);
    handle.addEventListener('dblclick', event => {
      event.preventDefault();
      resetWidth();
    });
    handle.addEventListener('keydown', event => {
      const imageWidth = detail.querySelector('.buret-grid-molecule-detail-image')?.getBoundingClientRect().width || 0;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setWidth(imageWidth - 32);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setWidth(imageWidth + 32);
      } else if (event.key === 'Home') {
        event.preventDefault();
        setWidth(minImage);
      } else if (event.key === 'End') {
        event.preventDefault();
        setWidth(Number.MAX_SAFE_INTEGER);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        resetWidth();
      }
    });
  }

  function installMoleculeDetailTabs(overlay) {
    const tabs = [...overlay.querySelectorAll('[data-buret-detail-tab]')];
    const panels = [...overlay.querySelectorAll('[data-buret-detail-panel]')];
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const next = tab.getAttribute('data-buret-detail-tab') || 'details';
        tabs.forEach(candidate => {
          const selected = candidate === tab;
          candidate.setAttribute('aria-selected', selected ? 'true' : 'false');
          candidate.classList.toggle('active', selected);
        });
        panels.forEach(panel => {
          panel.hidden = panel.getAttribute('data-buret-detail-panel') !== next;
        });
      });
    });
  }

  function installMoleculeDetailDescriptorSearch(overlay) {
    const input = overlay.querySelector('[data-buret-detail-descriptor-search]');
    const rows = [...overlay.querySelectorAll('[data-buret-detail-descriptor-row]')];
    const count = overlay.querySelector('[data-buret-detail-descriptor-count]');
    if (!input || !rows.length) return;
    const apply = () => {
      const query = String(input.value || '').trim().toLowerCase();
      let visible = 0;
      rows.forEach(row => {
        const matches = !query || String(row.getAttribute('data-buret-descriptor-search') || '').includes(query);
        row.hidden = !matches;
        if (matches) visible += 1;
      });
      if (count) count.textContent = `${visible.toLocaleString()} of ${rows.length.toLocaleString()}`;
    };
    input.addEventListener('input', apply);
    apply();
  }

  function moleculeDetailDescriptors(row) {
    const entries = descriptorEntries(row);
    if (!entries.length) {
      return '<div class="buret-no-metadata">No descriptors calculated for this molecule yet.</div>';
    }
    return `
      <div class="buret-grid-molecule-detail-descriptor-toolbar">
        <input type="search" placeholder="Filter descriptors" aria-label="Filter descriptors" data-buret-detail-descriptor-search>
        <span data-buret-detail-descriptor-count>${entries.length.toLocaleString()} of ${entries.length.toLocaleString()}</span>
      </div>
      <div class="buret-grid-molecule-detail-descriptor-table" role="table" aria-label="Calculated descriptors">
        <div class="buret-grid-molecule-detail-descriptor-head" role="row">
          <span role="columnheader">Descriptor</span>
          <span role="columnheader" aria-label="Info"></span>
          <span role="columnheader">Value</span>
        </div>
        ${entries.map(([id, value]) => descriptorDetailRow(id, value)).join('')}
      </div>`;
  }

  function descriptorEntries(row) {
    return Object.entries(row.descriptors || {})
      .filter(([, value]) => descriptorDisplayValue(value));
  }

  function descriptorDetailRow(id, value) {
    const label = value?.label || id;
    const display = descriptorDisplayValue(value);
    const help = descriptorHelpText(id, label);
    const searchText = `${id} ${label} ${display} ${value?.missingKind || ''} ${value?.errorText || ''}`.toLowerCase();
    return `
      <div class="buret-grid-molecule-detail-descriptor-row" role="row" data-buret-detail-descriptor-row data-buret-descriptor-search="${escapeAttr(searchText)}">
        <span class="buret-grid-molecule-detail-descriptor-name" role="cell">
          <strong>${escapeHTML(label)}</strong>
        </span>
        <span class="buret-grid-molecule-detail-descriptor-info-cell" role="cell">
          <button type="button" class="buret-grid-molecule-detail-descriptor-info" title="${escapeAttr(help)}" aria-label="${escapeAttr(help)}">i</button>
        </span>
        <span class="buret-grid-molecule-detail-descriptor-value" role="cell">${escapeHTML(display)}</span>
      </div>`;
  }

  function moleculeDetailJson(row) {
    const payload = {
      mode: 'auto',
      messages: [],
      descriptors: {}
    };
    for (const [id, value] of Object.entries(row.descriptors || {})) {
      const normalized = descriptorJsonValue(id, value);
      if (normalized.kind === 'value') {
        payload.descriptors[id] = normalized.value;
      } else if (normalized.message) {
        payload.messages.push(normalized.message);
      }
    }
    return JSON.stringify(payload, null, 2);
  }

  function descriptorJsonValue(id, value) {
    if (!value) return { kind: 'missing', message: null };
    if (value.errorText) {
      return { kind: 'missing', message: `${id}: ${value.errorText}` };
    }
    if (value.missingKind) {
      return { kind: 'missing', message: `${id}: ${value.missingKind}` };
    }
    if (typeof value !== 'object') return { kind: 'value', value };
    if (value.value === null || value.value === undefined) return { kind: 'missing', message: null };
    return { kind: 'value', value: value.value };
  }

  function hideMoleculeDetail() {
    const overlay = root.querySelector('.buret-grid-molecule-detail-overlay');
    const handler = overlay?._buretDetailKeyHandler;
    if (handler) document.removeEventListener('keydown', handler);
    overlay?.remove();
  }

  async function copyMoleculeStructure(row) {
    const record = gridDragRecord(row);
    const label = row?.name || `Molecule ${Number(row?.index) + 1 || 1}`;
    if (!record) {
      setStatus(`[grid] ${label} has no structure data to copy.`, 'error');
      return;
    }
    const text = record.inputExtension === 'sdf'
      ? record.text.replace(/\n?\$\$\$\$\s*$/u, '').trimEnd() + '\n$$$$\n'
      : record.text;
    if (await writeClipboardText(text, `[grid] Copied ${label}.`)) return;
    if (canUseNativeBridge()) {
      post('copyText', `[grid] Copy ${label}.`, { text });
      setStatus(`[grid] Copy requested for ${label}.`);
      return;
    }
    setStatus('Clipboard is unavailable in this WebView.', 'error');
  }

  function exportMolecule(row) {
    const record = gridDragRecord(row);
    const label = row?.name || `Molecule ${Number(row?.index) + 1 || 1}`;
    if (!record) {
      setStatus(`[grid] ${label} has no structure data to export.`, 'error');
      return;
    }
    const mimeType = record.inputExtension === 'sdf'
      ? 'chemical/x-mdl-sdfile'
      : 'chemical/x-daylight-smiles';
    if (canUseNativeBridge()) {
      post('exportGridMolecule', `[grid] Export ${label}.`, {
        text: record.text,
        name: record.path,
        mimeType
      });
      setStatus(`[grid] Export requested: ${record.path}.`);
      return;
    }
    download(record.text, record.path, mimeType);
  }

  function moleculeContextMenuAction(action, row) {
    const cfg = config();
    const label = row.name || `Molecule ${Number(row.index) + 1}`;
    if (action === 'open') {
      showMoleculeDetail(row, cfg);
      setStatus(`[grid] Opened ${label}.`);
    } else if (action === 'remove') {
      removeGridRow(row);
      void render(cfg);
      setStatus(`[grid] Deleted ${label}. Unsaved changes.`);
    } else if (action === 'molstar') {
      void requestSingleMolstarDocument(row, cfg);
    } else if (action === 'ketcher') {
      requestOpenInKetcher(row, cfg);
      setStatus(`[grid] Opening ${label} in Ketcher.`);
    } else if (action === 'duplicate') {
      duplicateGridRow(row, cfg);
      setStatus(`[grid] Duplicated ${label}. Unsaved changes.`);
    } else if (action === 'copy') {
      void copyMoleculeStructure(row);
    } else if (action === 'export') {
      exportMolecule(row);
    } else if (action === 'pubchem-identity' || action === 'pubchem-similarity') {
      void openGridPubChemSearch(row, action === 'pubchem-identity' ? 'identity' : 'similarity');
    } else {
      setStatus(`[grid] Molecule action is unavailable for ${label}.`);
    }
    hideMoleculeContextMenu();
  }

  function showMoleculeContextMenu(event, row) {
    if (event.target?.closest?.('[data-buret-card-resize]')) return;
    if (!isMoleculeContextTarget(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      hideMoleculeContextMenu();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
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
      ['open', 'Preview molecule'],
      ['molstar', 'Open in Mol*'],
      ['ketcher', 'Edit in Ketcher'],
      ['duplicate', 'Duplicate'],
      ['remove', 'Delete from collection'],
      ['copy', 'Copy structure'],
      ['export', 'Export molecule...']
    ];
    if (cfg.appViewer === true && cfg.pubChemSearch === true && (String(row?.smiles || '').trim() || String(row?.molblock || '').trim())) {
      actions.push(['pubchem-identity', 'Search PubChem — Identical']);
      actions.push(['pubchem-similarity', 'Search PubChem — Similar (90%)']);
    }
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

  function installTableMoleculeHover(rowEl, row, cfg) {
    const picture = rowEl.querySelector('.buret-grid-table-molecule');
    if (!picture) return;
    picture.addEventListener('pointerenter', event => {
      if (event.pointerType === 'touch') return;
      showTableMoleculePreview(event, row, cfg);
    });
    picture.addEventListener('pointermove', event => {
      if (event.pointerType === 'touch') return;
      if (!state.tableMoleculePreview) showTableMoleculePreview(event, row, cfg);
      positionTableMoleculePreview(event);
    });
    picture.addEventListener('pointerleave', hideTableMoleculePreview);
    picture.addEventListener('contextmenu', hideTableMoleculePreview);
  }

  function showTableMoleculePreview(event, row, cfg) {
    hideTableMoleculePreview();
    const label = row.name || `Molecule ${Number(row.index) + 1}`;
    const popover = document.createElement('div');
    popover.className = 'buret-grid-table-molecule-popover';
    popover.setAttribute('role', 'tooltip');
    popover.innerHTML = `
      <div class="buret-grid-table-molecule-popover-image" data-buret-molecule-picture>${draw(row, cfg)}</div>
      <div class="buret-grid-table-molecule-popover-title">${escapeHTML(label)}</div>`;
    document.body.appendChild(popover);
    state.tableMoleculePreview = popover;
    scheduleRdkitCard(popover, row);
    scheduleXyzrenderCard(popover, row, cfg);
    window.addEventListener('scroll', hideTableMoleculePreview, true);
    window.addEventListener('resize', hideTableMoleculePreview, true);
    positionTableMoleculePreview(event);
  }

  function positionTableMoleculePreview(event) {
    const popover = state.tableMoleculePreview;
    if (!popover) return;
    const margin = 12;
    const offset = 16;
    const rect = popover.getBoundingClientRect();
    let left = event.clientX + offset;
    let top = event.clientY + offset;
    if (left + rect.width + margin > window.innerWidth) left = event.clientX - rect.width - offset;
    if (top + rect.height + margin > window.innerHeight) top = window.innerHeight - rect.height - margin;
    left = Math.max(margin, left);
    top = Math.max(margin, top);
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  }

  function hideTableMoleculePreview() {
    if (!state.tableMoleculePreview) return;
    state.tableMoleculePreview.remove();
    state.tableMoleculePreview = null;
    window.removeEventListener('scroll', hideTableMoleculePreview, true);
    window.removeEventListener('resize', hideTableMoleculePreview, true);
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
    return `<div class="buret-molecule-loading" data-buret-rdkit-card-key="${escapeAttr(key)}" aria-label="Rendering molecule"></div>`;
  }

  function drawRdkit(row) {
    if (!state.rdkit) {
      const label = row.smiles || row.name || 'Molecule';
      const message = state.rdkitError || 'RDKit renderer is unavailable.';
      return moleculeErrorHTML(label, message);
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
      html = padSVGViewBox(html, 8);
      if (!html.includes('<svg')) throw new Error('empty drawing');
      if (isDegenerateMoleculeSVG(html)) throw new Error('invalid molecule drawing');
    } catch (error) {
      const label = row.smiles || row.name || 'Molecule';
      html = moleculeErrorHTML(label, error.message || String(error));
    } finally {
      try { mol?.delete?.(); } catch {}
    }
    state.svgCache.set(key, html);
    while (state.svgCache.size > RDKIT_SVG_CACHE_LIMIT) state.svgCache.delete(state.svgCache.keys().next().value);
    return html;
  }

  function fillMissingSmilesFromMolblocks() {
    if (!state.rdkit) return false;
    let changed = false;
    for (const row of state.all) {
      if (String(row?.smiles || '').trim() || !String(row?.molblock || '').trim()) continue;
      const smiles = smilesFromMolblock(row.molblock);
      if (!smiles) continue;
      row.smiles = smiles;
      changed = true;
    }
    if (changed) {
      invalidateTableColumnCatalog();
    }
    return changed;
  }

  function rowSmiles(row) {
    const current = String(row?.smiles || '').trim();
    if (current) return current;
    if (!state.rdkit || !String(row?.molblock || '').trim()) return '';
    const smiles = smilesFromMolblock(row.molblock);
    if (!smiles) return '';
    row.smiles = smiles;
    invalidateTableColumnCatalog();
    return smiles;
  }

  function smilesFromMolblock(molblock) {
    let mol = null;
    try {
      mol = state.rdkit.get_mol(String(molblock || ''));
      if (!mol || (typeof mol.is_valid === 'function' && !mol.is_valid())) return '';
      if (typeof mol.get_smiles === 'function') return String(mol.get_smiles() || '').trim();
    } catch (_) {
      return '';
    } finally {
      try { mol?.delete?.(); } catch {}
    }
    return '';
  }

  async function openGridPubChemSearch(row, searchType) {
    try {
      if (searchType !== 'identity' && searchType !== 'similarity') throw new Error('Unsupported PubChem search type.');
      const smiles = await canonicalPubChemSmiles(row);
      if (!validPubChemSmiles(smiles)) throw new Error('The molecule does not have a complete PubChem-searchable SMILES.');
      post('openPubChemSearch', `[grid] Opening PubChem ${searchType === 'identity' ? 'identity' : '90% similarity'} search.`, {
        searchType,
        smiles
      });
    } catch (error) {
      setStatus(`[grid] PubChem search failed.\n\n${error?.message || String(error)}`, 'error');
    }
  }

  async function canonicalPubChemSmiles(row) {
    const molblock = String(row?.molblock || '').trim();
    const sourceSmiles = String(row?.smiles || '').trim();
    if (!molblock && !sourceSmiles) return '';
    const rdkit = state.rdkit || await initRDKit();
    let molecule = null;
    try {
      molecule = rdkit.get_mol(molblock || sourceSmiles);
      if (!molecule || (typeof molecule.is_valid === 'function' && !molecule.is_valid())) return '';
      return typeof molecule.get_smiles === 'function' ? String(molecule.get_smiles() || '').trim() : '';
    } catch (_) {
      return '';
    } finally {
      try { molecule?.delete?.(); } catch {}
    }
  }

  function validPubChemSmiles(smiles) {
    const value = String(smiles || '').trim();
    return value.length > 0
      && value.length <= 4096
      && !value.includes('*')
      && !/[\u0000-\u001F\u007F]/u.test(value);
  }

  function scheduleRdkitCard(card, row) {
    const target = card.querySelector('[data-buret-rdkit-card-key]');
    if (!target) return;
    const key = target.getAttribute('data-buret-rdkit-card-key');
    if (!key) return;
    const start = () => enqueueRdkitCard(row, key, target);
    state.rdkitCardLazyJobs.set(target, start);
    state.rdkitCardLazyTargets.push(target);
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
    }, { root: null, rootMargin: `${RDKIT_CARD_ROOT_MARGIN}px 0px` });
    return state.rdkitCardObserver;
  }

  function startLazyRdkitCard(target) {
    state.rdkitCardObserver?.unobserve?.(target);
    const start = state.rdkitCardLazyJobs.get(target);
    if (!start) return;
    state.rdkitCardLazyJobs.delete(target);
    start();
  }

  function startVisibleRdkitCards() {
    const targets = [...state.rdkitCardLazyTargets];
    for (const target of targets) {
      if (!isElementNearViewport(target, RDKIT_CARD_ROOT_MARGIN)) continue;
      startLazyRdkitCard(target);
    }
  }

  function isElementNearViewport(target, margin) {
    if (!target || typeof target.getBoundingClientRect !== 'function') return false;
    const rect = target.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    return rect.bottom >= -margin
      && rect.top <= viewportHeight + margin
      && rect.right >= -margin
      && rect.left <= viewportWidth + margin;
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
    if (!state.rdkit && !state.rdkitError) return;
    state.rdkitCardQueue.sort(compareCardRenderJobs);
    state.rdkitCardRendering = true;
    requestAnimationFrame(() => {
      const startedAt = nowMs();
      let processed = 0;
      try {
        while (state.rdkitCardQueue.length && processed < RDKIT_CARD_FRAME_BATCH) {
          const job = state.rdkitCardQueue.shift();
          updateRdkitCard(job.key, drawRdkit(job.row));
          state.rdkitCardPending.delete(job.key);
          processed++;
          const now = nowMs();
          if (processed >= 2 && now - startedAt >= RDKIT_CARD_FRAME_BUDGET_MS) break;
        }
      } finally {
        try {
          emitGridPerfMetric(config(), 'rdkit-batch', startedAt, { processed });
          if (processed > 0) postGridReady(config(), { phase: 'rdkit-batch', rdkitRenderedInBatch: processed });
        } catch (_) {}
        state.rdkitCardRendering = false;
        if (state.rdkitCardQueue.length) window.setTimeout(pumpRdkitCardQueue, 0);
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
      const card = target.closest('.buret-card');
      if (card) fitCardSVGs(card);
    });
  }

  function resetRdkitCardObserver() {
    state.rdkitCardObserver?.disconnect?.();
    state.rdkitCardObserver = null;
    state.rdkitCardLazyJobs = new WeakMap();
    state.rdkitCardLazyTargets = [];
  }

  function drawXyzrenderCard(row, cfg) {
    const record = gridDragRecord(row);
    if (!record) return '<div class="buret-molecule-error"><strong>Molecule</strong><span>No structure data</span></div>';
    const key = xyzrenderCardKey(row, record);
    const cached = state.xyzrenderCardCache.get(key);
    if (cached?.html) return cached.html;
    if (cached?.error) return `<div class="buret-molecule-error"><strong>${escapeHTML(row.name || `Molecule ${Number(row.index) + 1}`)}</strong><span>${escapeHTML(cached.error)}</span></div>`;
    const preview = '<div class="buret-molecule-loading" aria-label="Rendering molecule with xyzrender"></div>';
    return `<div class="buret-molecule-picture buret-xyzrender-preview" data-buret-xyzrender-card-key="${escapeAttr(key)}">${preview}</div>`;
  }

  function xyzrenderCardKey(row, record) {
    return `${row.index}|${record.inputExtension}|${currentXyzrenderPreset(config())}|${hash(xyzrenderCardInputText(row, record))}|${state.smarts}`;
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
    state.xyzrenderCardLazyTargets.push(target);
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
    state.xyzrenderCardLazyTargets = [];
  }

  function resetCardRenderQueues() {
    state.rdkitCardQueue = [];
    state.rdkitCardPending.clear();
    state.xyzrenderCardQueue = [];
    state.xyzrenderBatchesRunning = 0;
    if (state.xyzrenderBatchTimer) {
      window.clearTimeout(state.xyzrenderBatchTimer);
      state.xyzrenderBatchTimer = 0;
    }
    state.xyzrenderCardCache.forEach((value, key) => {
      if (value?.pending) state.xyzrenderCardCache.delete(key);
    });
  }

  function resetDocumentRuntimeState() {
    cancelVirtualWindowRender();
    state.query = '';
    state.smarts = '';
    state.smartsError = '';
    state.smartsMatches = new Map();
    state.rows = [];
    state.all = Array.isArray(window.BurreteGridRecords) ? window.BurreteGridRecords : [];
    state.remoteAnalysisColumns = [];
    state.selected = new Set();
    state.findingSimilar = false;
    state.hiddenRows = new Set();
    state.exportingClusterRepresentatives = false;
    state.dirty = false;
    state.dirtyReason = '';
    state.undoStack = [];
    state.rowPatches = new Map();
    state.insertedRows = [];
    state.xyzrenderPreset = null;
    state.selectionAnchorIndex = null;
    state.visibleCount = 0;
    state.renderedCount = 0;
    state.totalRows = 0;
    state.pendingLoad = false;
    state.pendingGridScrollIndex = null;
    state.pendingGridRailPosition = null;
    state.windowStart = 0;
    state.windowEnd = 0;
    invalidateTableColumnCatalog();
    resetRdkitCardObserver();
    resetXyzrenderCardObserver();
    resetCardRenderQueues();
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
    const startedAt = nowMs();
    try {
      const request = {
        path: record.path,
        preset: currentXyzrenderPreset(cfg),
        inputDataBase64: textToBase64(xyzrenderCardInputText(row, record)),
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
      const svg = prepareXyzrenderCardSVG(payload.svg);
      if (!svg.includes('<svg')) throw new Error('empty xyzrender drawing');
      const html = svgDataImageHTML(svg, 'buret-xyzrender-card-image', row.name || `Molecule ${Number(row.index) + 1}`);
      state.xyzrenderCardCache.set(key, { html });
      evictXyzrenderCardCache();
      updateXyzrenderCard(key, html);
      emitGridPerfMetric(cfg, 'xyzrender-card', startedAt, {
        rowIndex: Number(row.index),
        xyzrenderElapsedMs: Number(payload?.elapsedMs) || null,
        cacheHit: payload?.cacheHit === true
      });
    } catch (error) {
      const message = error?.message || String(error);
      state.xyzrenderCardCache.set(key, { error: message });
      updateXyzrenderCard(key, `<div class="buret-molecule-error"><strong>${escapeHTML(row.name || `Molecule ${Number(row.index) + 1}`)}</strong><span>${escapeHTML(message)}</span></div>`);
      emitGridPerfMetric(cfg, 'xyzrender-card-error', startedAt, {
        rowIndex: Number(row.index),
        error: message
      });
    }
  }

  async function requestXyzrenderCardBatch(jobs) {
    if (!jobs.length) return;
    const cfg = jobs[0].cfg;
    const startedAt = nowMs();
    try {
      const payload = await hostRequest('renderXyzrenderCards', {
        items: jobs.map(job => ({
          id: job.key,
          path: job.record.path,
          preset: currentXyzrenderPreset(job.cfg),
          inputDataBase64: textToBase64(xyzrenderCardInputText(job.row, job.record)),
          inputExtension: job.record.inputExtension
        }))
      });
      const results = Array.isArray(payload?.items) ? payload.items : [];
      const byId = new Map(results.map(item => [String(item?.id || ''), item]));
      for (const job of jobs) {
        const item = byId.get(job.key);
        if (!item) {
          markXyzrenderCardError(job, 'xyzrender batch returned no result');
          continue;
        }
        if (item.error) {
          markXyzrenderCardError(job, String(item.error));
          continue;
        }
        if (typeof item.svg !== 'string' || !item.svg.trim()) {
          markXyzrenderCardError(job, 'xyzrender batch returned no SVG payload');
          continue;
        }
        const svg = prepareXyzrenderCardSVG(item.svg);
        if (!svg.includes('<svg')) {
          markXyzrenderCardError(job, 'empty xyzrender drawing');
          continue;
        }
        const html = svgDataImageHTML(svg, 'buret-xyzrender-card-image', job.row.name || `Molecule ${Number(job.row.index) + 1}`);
        state.xyzrenderCardCache.set(job.key, { html });
        evictXyzrenderCardCache();
        updateXyzrenderCard(job.key, html);
        emitGridPerfMetric(cfg, 'xyzrender-card', startedAt, {
          rowIndex: Number(job.row.index),
          xyzrenderElapsedMs: Number(item.elapsedMs) || null,
          cacheHit: item.cacheHit === true,
          batchSize: jobs.length,
          batchConcurrency: xyzrenderCardBatchConcurrency()
        });
      }
    } catch (error) {
      const message = error?.message || String(error);
      for (const job of jobs) markXyzrenderCardError(job, message);
    }
  }

  function markXyzrenderCardError(job, message) {
    state.xyzrenderCardCache.set(job.key, { error: message });
    updateXyzrenderCard(job.key, `<div class="buret-molecule-error"><strong>${escapeHTML(job.row.name || `Molecule ${Number(job.row.index) + 1}`)}</strong><span>${escapeHTML(message)}</span></div>`);
    emitGridPerfMetric(job.cfg, 'xyzrender-card-error', nowMs(), {
      rowIndex: Number(job.row.index),
      error: message
    });
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

  function evictXyzrenderCardCache() {
    while (state.xyzrenderCardCache.size > XYZRENDER_CARD_CACHE_LIMIT) {
      state.xyzrenderCardCache.delete(state.xyzrenderCardCache.keys().next().value);
    }
  }

  function moleculeErrorHTML(label, message) {
    const denseClass = String(label).length > 36 ? ' buret-molecule-error-dense' : '';
    return `<div class="buret-molecule-error${denseClass}"><strong>${escapeHTML(label)}</strong><span>${escapeHTML(message)}</span></div>`;
  }

  function isDegenerateMoleculeSVG(svg) {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return false;
    const atomsAndBonds = doc.querySelectorAll('path, line, polygon, polyline, circle, ellipse').length;
    const labels = [...doc.querySelectorAll('text')]
      .map(node => String(node.textContent || '').trim())
      .filter(Boolean);
    if (atomsAndBonds > 0) return false;
    return labels.length > 0;
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
        return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
          && (Math.abs(x) > 1e-6 || Math.abs(y) > 1e-6 || Math.abs(z) > 1e-6);
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
      return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
        && (Math.abs(x) > 1e-6 || Math.abs(y) > 1e-6 || Math.abs(z) > 1e-6);
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
      if (!/\sclass=/i.test(attrs)) {
        next = next.replace('<svg', '<svg class="buret-rdkit-card-image"');
      } else if (!/\bclass="[^"]*\bburet-rdkit-card-image\b/i.test(attrs)) {
        next = next.replace(/\sclass="([^"]*)"/i, ' class="$1 buret-rdkit-card-image"');
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

  function svgDataImageHTML(svg, className, label) {
    const encoded = encodeURIComponent(String(svg || ''));
    return `<img class="${escapeAttr(className)}" alt="${escapeAttr(label || 'Molecule')}" src="data:image/svg+xml;charset=utf-8,${encoded}" />`;
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
    const analyses = Object.entries(row.analyses || {})
      .filter(([, value]) => analysisDisplayValue(value))
      .slice(0, 6);
    const descriptors = Object.entries(row.descriptors || {})
      .filter(([, value]) => descriptorDisplayValue(value))
      .slice(0, 6);
    if (!entries.length && !descriptors.length && !analyses.length) return '<div class="buret-no-metadata">No metadata</div>';
    const propItems = entries.map(([key, value]) => `<dt>${escapeHTML(key)}</dt><dd>${escapeHTML(value)}</dd>`);
    const analysisItems = analyses.map(([key, value]) => (
      `<dt>${escapeHTML((state.remoteAnalysisColumns || []).find(column => column.valueId === key)?.label || key)}</dt><dd>${escapeHTML(analysisDisplayValue(value))}</dd>`
    ));
    const descriptorItems = descriptors.map(([key, value]) => (
      `<dt>${escapeHTML(value.label || key)}</dt><dd>${escapeHTML(descriptorDisplayValue(value))}</dd>`
    ));
    return `<dl class="buret-metadata">${[...analysisItems, ...descriptorItems, ...propItems].join('')}</dl>`;
  }

  function analysisDisplayValue(cell) {
    if (!cell || cell.value === null || cell.value === undefined) return '';
    if (cell.valueKind === 'boolean') return cell.value === true ? 'true' : 'false';
    if (cell.valueKind === 'integer') return String(Math.trunc(Number(cell.value)));
    if (cell.valueKind === 'real' && typeof cell.value === 'number') return String(Number(cell.value.toPrecision(8)));
    return String(cell.value);
  }

  function descriptorDisplayValue(value) {
    if (!value) return '';
    if (value.errorText) return value.errorText;
    if (value.missingKind) return value.missingKind;
    if (typeof value.value === 'number') return value.value.toFixed(1);
    if (typeof value.value === 'boolean') return value.value ? 'true' : 'false';
    if (value.value === null || value.value === undefined) return '';
    return String(value.value);
  }

  function descriptorHelpText(id, label) {
    const definitions = {
      MW: 'Molecular weight calculated from the atoms in the parsed molecule.',
      AMW: 'Average atomic weight for the molecule.',
      nAtom: 'Total number of atoms in the parsed molecular graph.',
      nHeavyAtom: 'Number of non-hydrogen atoms.',
      nHetero: 'Number of atoms that are neither carbon nor hydrogen.',
      nBonds: 'Total number of bonds in the parsed molecular graph.',
      nBondsO: 'Mordred bond-count descriptor that accounts for bond order.',
      nBondsS: 'Number of single bonds.',
      nRot: 'Number of rotatable bonds according to Mordred/RDKit perception.',
      nRing: 'Number of rings perceived in the molecular graph.',
      nAromAtom: 'Number of atoms marked aromatic after molecule sanitization.',
      nAromBond: 'Number of bonds marked aromatic after molecule sanitization.',
      TopoPSA: 'Topological estimate of polar surface area from polar fragments.',
      SLogP: 'Wildman-Crippen style estimate of octanol/water partition coefficient.'
    };
    return `${label || id}: ${definitions[id] || 'Mordred descriptor calculated from the parsed molecule.'}`;
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
    if (await writeClipboardText(text, '[grid] Copied molecules.')) return;
    if (canUseNativeBridge()) {
      post('copyText', '[grid] Copy selected molecules.', { text });
      setStatus('[grid] Copy requested.');
      return;
    }
    setStatus('Clipboard is unavailable in this WebView.', 'error');
  }

  async function writeClipboardText(text, successMessage) {
    if (!navigator.clipboard?.writeText) return false;
    try {
      await navigator.clipboard.writeText(text);
      setStatus(successMessage);
      return true;
    } catch (_) {
      return false;
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

  async function saveGridAs(cfg) {
    const rows = await collectCurrentCollectionRows(cfg);
    if (!rows.length) {
      setStatus('[grid] There are no molecules to save.', 'error');
      return;
    }
    const snapshot = gridSaveAsSnapshot(rows, cfg);
    if (canUseNativeBridge()) {
      post('saveGridAs', `[grid] Save As ${snapshot.name}.`, snapshot);
      setStatus(`[grid] Save As requested: ${snapshot.name}.`);
      return;
    }
    download(snapshot.text, snapshot.name, snapshot.mimeType);
    markGridClean();
    setStatus(`[grid] Saved as ${snapshot.name}.`);
    updateChrome(cfg);
  }

  async function saveGrid(cfg) {
    const rows = await collectCurrentCollectionRows(cfg);
    if (!rows.length) {
      setStatus('[grid] There are no molecules to save.', 'error');
      return;
    }
    const snapshot = gridSaveAsSnapshot(rows, cfg);
    if (canUseNativeBridge()) {
      post('saveGrid', `[grid] Save ${snapshot.name}.`, snapshot);
      setStatus(`[grid] Save requested: ${snapshot.name}.`);
      return;
    }
    download(snapshot.text, snapshot.name, snapshot.mimeType);
    markGridClean();
    setStatus(`[grid] Saved ${snapshot.name}.`);
    updateChrome(cfg);
  }

  async function collectCurrentCollectionRows(cfg) {
    if (state.remoteMode) {
      const rows = await collectAllRemoteRows(cfg, '', 'index');
      return rows.concat(state.insertedRows);
    }
    return currentLocalCollectionRows();
  }

  function gridSaveAsSnapshot(rows, cfg) {
    const label = baseName(cfg.label);
    if (cfg.format === 'sdf' && rows.every(row => String(row.molblock || '').trim())) {
      return {
        text: serializeSdfRows(rows),
        name: `${label}.sdf`,
        mimeType: 'chemical/x-mdl-sdfile'
      };
    }
    if (cfg.format === 'smiles' && rows.every(row => String(row.smiles || '').trim())) {
      return {
        text: serializeSmilesRows(rows),
        name: `${label}.smi`,
        mimeType: 'chemical/x-daylight-smiles'
      };
    }
    const separator = cfg.format === 'tsv' ? '\t' : ',';
    const extension = cfg.format === 'tsv' ? 'tsv' : 'csv';
    return {
      text: serializeDelimitedRows(rows, separator),
      name: `${label}.${extension}`,
      mimeType: extension === 'tsv' ? 'text/tab-separated-values' : 'text/csv'
    };
  }

  function serializeSmilesRows(rows) {
    return rows
      .map(row => `${row.smiles || ''}\t${row.name || `mol_${Number(row.index) + 1}`}`.trim())
      .filter(Boolean)
      .join('\n') + '\n';
  }

  function serializeSdfRows(rows) {
    return rows.map(row => {
      const molblock = String(row.molblock || '').replace(/\n?\$\$\$\$\s*$/u, '').trimEnd();
      const props = {
        Name: row.name || `Molecule ${Number(row.index) + 1}`,
        ...(row.smiles ? { SMILES: row.smiles } : {}),
        ...row.props
      };
      const propText = Object.entries(props)
        .filter(([, value]) => String(value ?? '').trim().length > 0)
        .map(([key, value]) => `> <${String(key).replace(/[<>]/g, '')}>\n${String(value)}\n`)
        .join('\n');
      return `${molblock}${propText ? `\n\n${propText}\n` : '\n'}$$$$`;
    }).join('\n') + '\n';
  }

  function serializeDelimitedRows(rows, separator) {
    const props = [...new Set(rows.flatMap(row => Object.keys(row.props || {})))];
    const data = [
      ['index', 'name', 'smiles', 'molblock', ...props],
      ...rows.map(row => [
        row.index,
        row.name || '',
        row.smiles || '',
        row.molblock || '',
        ...props.map(prop => (row.props || {})[prop] || '')
      ])
    ];
    return data.map(row => row.map(value => separator === '\t' ? tsv(value) : csv(value)).join(separator)).join('\n') + '\n';
  }

  function download(text, name, type) {
    if (canUseNativeBridge()) {
      post('exportText', `[grid] Export ${name}.`, { text, name, mimeType: type });
      setStatus(state.dirty ? `[grid] Export requested: ${name}. Source file is unchanged.` : `[grid] Export requested: ${name}`);
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

  function tsv(value) {
    return String(value ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, '\\n');
  }

  function baseName(value) {
    return String(value || 'molecules').replace(/\.[^.]+$/, '').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 80) || 'molecules';
  }

  async function collectAllRemoteRows(cfg, query = state.query || '', sort = state.sort || 'index') {
    if (!state.remoteMode) return state.rows;
    if (query === (state.query || '') && sort === (state.sort || 'index') && state.rows.length >= state.totalRows && state.totalRows > 0) {
      return state.rows.slice();
    }
    const rows = [];
    let offset = 0;
    let total = null;
    const limit = Math.max(120, loadBatchSize(cfg));
    setStatus('[grid] Preparing export...');
    while (total === null || offset < total) {
      const result = await hostRequest('gridFetchPage', gridFetchPayload({
        query,
        sort,
        offset,
        limit
      }));
      const pageRows = applyVirtualGridEdits(await hydrateDataWarriorRows(Array.isArray(result.rows) ? result.rows : [], cfg));
      applyGridPageState(result);
      total = Number(result.totalRows || 0);
      rows.push(...pageRows);
      offset += Math.max(pageRows.length, Number(result.rows?.length || 0));
      if (!Array.isArray(result.rows) || result.rows.length === 0) break;
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
    const cfg = window.BurreteConfig && typeof window.BurreteConfig === 'object' ? window.BurreteConfig : {};
    return cfg.appViewer === true || !!window.webkit?.messageHandlers?.burrete;
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

  async function hydrateDataWarriorRows(rows, cfg) {
    if (!Array.isArray(rows) || !rows.some(row => String(row?.idcode || '').trim())) return rows;
    const openChemLib = window.BurreteOpenChemLib;
    if (!openChemLib?.Molecule?.fromIDCode) throw new Error('OpenChemLib IDCode decoder is unavailable.');
    return rows.map(row => {
      const idcode = String(row?.idcode || '').trim();
      if (!idcode || row.molblock) return row;
      try {
        const coordinates = String(row?.idcoordinates || '').trim();
        const molecule = coordinates
          ? openChemLib.Molecule.fromIDCode(idcode, coordinates)
          : openChemLib.Molecule.fromIDCode(idcode, true);
        return {
          ...row,
          molblock: molecule.toMolfile(),
          smiles: molecule.toIsomericSmiles(),
        };
      } catch (error) {
        return {
          ...row,
          props: {
            ...(row.props || {}),
            'DataWarrior decode error': error?.message || String(error),
          },
        };
      }
    });
  }

  async function main() {
    try {
      const cfg = config();
      resetDocumentRuntimeState();
      state.remoteMode = isRemoteMode(cfg);
      if (!state.remoteMode) state.all = await hydrateDataWarriorRows(state.all, cfg);
      state.totalRows = state.remoteMode ? 0 : state.all.length;
      applyTheme(cfg);
      installThemeListener(cfg);
      installHostMessageListener();
      normalizeCardRenderer(cfg);
      normalizeGridViewMode(cfg);
      buildUI(cfg);
      refresh(cfg);
      try {
        await initRDKit();
        state.rdkitError = '';
        pumpRdkitCardQueue();
        const filledSmiles = !state.remoteMode && fillMissingSmilesFromMolblocks();
        if (state.cardRenderer === 'rdkit') {
          if (state.remoteMode) {
            if (state.rows.length) void renderVirtualWindow(cfg, state.token, { force: true });
          } else {
            render(cfg);
          }
        } else if (filledSmiles) {
          refresh(cfg);
        }
      } catch (rdkitError) {
        state.rdkitError = rdkitError?.message || String(rdkitError);
        pumpRdkitCardQueue();
        setStatus(`RDKit renderer unavailable: ${state.rdkitError}`, 'error');
      }
    } catch (error) {
      const message = error && error.stack ? error.stack : String(error);
      setStatus(message, 'error');
    }
  }

  window.addEventListener('beforeunload', event => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main, { once: true });
  else main();
})();
