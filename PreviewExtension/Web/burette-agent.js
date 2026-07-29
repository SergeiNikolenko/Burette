(() => {
  'use strict';

  const API_VERSION = 'burette-agent/v1';
  const AGENT_VERSION = '0.1.0';
  const DEFAULT_READY_TIMEOUT_MS = 30000;
  const DEFAULT_CONTACT_RADIUS_A = 4.0;
  const MAX_SCHEMA_RESIDUES = 256;
  const MAX_CONTACT_SOURCE_ATOMS = 5000;
  const MAX_CONTACT_TARGET_ATOMS = 250000;
  const MAX_INLINE_SESSION_BYTES = 2 * 1024 * 1024;

  const STANDARD_AA = new Set([
    'ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'GLN', 'GLU', 'GLY', 'HIS', 'ILE',
    'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER', 'THR', 'TRP', 'TYR', 'VAL',
    'SEC', 'PYL', 'ASX', 'GLX', 'UNK'
  ]);
  const NUCLEIC = new Set([
    'A', 'C', 'G', 'T', 'U', 'DA', 'DC', 'DG', 'DT', 'DU', 'I', 'DI',
    'PSU', '5MC', 'OMC', 'OMG', '1MA', '2MG', 'M2G', '7MG'
  ]);
  const WATER = new Set(['HOH', 'WAT', 'H2O', 'DOD', 'TIP', 'TIP3', 'TIP3P', 'TIP4', 'TIP4P', 'TP3', 'TP4', 'SPC', 'SPCE', 'SOL']);
  const COMMON_IONS = new Set([
    'NA', 'K', 'CL', 'CA', 'MG', 'ZN', 'FE', 'MN', 'CU', 'CO', 'NI', 'CD',
    'HG', 'BR', 'IOD', 'I', 'F', 'LI', 'CS', 'RB', 'SR', 'BA', 'AL', 'AG',
    'AU', 'PT', 'PB', 'SE', 'SO4', 'PO4', 'NO3'
  ]);

  const SCHEMA_FIELDS = [
    'label_entity_id', 'label_asym_id', 'auth_asym_id', 'label_seq_id', 'auth_seq_id',
    'pdbx_PDB_ins_code', 'beg_label_seq_id', 'end_label_seq_id', 'beg_auth_seq_id',
    'end_auth_seq_id', 'label_comp_id', 'auth_comp_id', 'label_atom_id', 'auth_atom_id',
    'type_symbol', 'atom_id', 'atom_index', 'instance_id'
  ];

  const state = {
    viewer: null,
    plugin: null,
    config: null,
    prepared: null,
    structureReady: false,
    sceneVersion: 0,
    selectionCounter: 0,
    lastSelectionId: null,
    selections: new Map(),
    commandLog: [],
    readyResolve: null,
    readyReject: null,
    readyPromise: null
  };

  resetReadyPromise();

  function resetReadyPromise() {
    state.readyPromise = new Promise((resolve, reject) => {
      state.readyResolve = resolve;
      state.readyReject = reject;
    });
  }

  function now() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
    return Date.now();
  }

  function cloneJson(value) {
    if (value == null) return value;
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  }

  function base64ToBytes(base64) {
    const raw = atob(String(base64 || ''));
    const bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
    return bytes;
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  function mvsCommandPayload(args = {}) {
    const format = args.format || (args.dataBase64 ? 'mvsx' : 'mvsj');
    if (args.dataBase64) {
      return { format, data: format === 'mvsx' ? base64ToBytes(args.dataBase64) : new TextDecoder('utf-8', { fatal: false }).decode(base64ToBytes(args.dataBase64)) };
    }
    if (args.json !== undefined) return { format: 'mvsj', data: JSON.stringify(args.json) };
    if (args.data !== undefined) {
      const data = typeof args.data === 'string' || args.data instanceof Uint8Array ? args.data : JSON.stringify(args.data);
      return { format: args.format || (typeof data === 'string' && data.trim().startsWith('{') ? 'mvsj' : 'mvsx'), data };
    }
    throw coded('INVALID_ARGS', 'loadMVS requires args.data, args.json, or args.dataBase64.');
  }

  function durationSince(start) {
    return Math.max(0, Math.round(now() - start));
  }

  function success(command, result, start, warnings = [], requestId) {
    return {
      ok: true,
      requestId,
      command,
      result,
      warnings: warnings.length ? warnings : undefined,
      sceneVersion: state.sceneVersion,
      molstarVersion: getMolstarVersion(),
      durationMs: durationSince(start)
    };
  }

  function failure(command, code, message, start, details, warnings = [], requestId) {
    return {
      ok: false,
      requestId,
      command,
      error: { code, message, details },
      warnings: warnings.length ? warnings : undefined,
      sceneVersion: state.sceneVersion,
      durationMs: durationSince(start)
    };
  }

  function normalizeRequest(input, args) {
    if (typeof input === 'string') return { command: input, args: args || {} };
    const req = input && typeof input === 'object' ? input : {};
    return {
      apiVersion: req.apiVersion,
      requestId: req.requestId,
      command: req.command,
      args: req.args || {}
    };
  }

  function attach({ viewer, plugin, config } = {}) {
    const nextViewer = viewer || state.viewer || window.BuretteViewer || window.BuretteViewer || null;
    const nextPlugin = plugin || nextViewer?.plugin || state.plugin || null;
    const nextConfig = config || state.config || window.BuretteConfig || null;
    const changed = nextViewer !== state.viewer || nextPlugin !== state.plugin || nextConfig !== state.config;
    state.viewer = nextViewer;
    state.plugin = nextPlugin;
    state.config = nextConfig;
    if (changed) state.sceneVersion++;
    return state.viewer && state.plugin;
  }

  function notifyStructureLoaded({ viewer, plugin, prepared, config } = {}) {
    attach({ viewer, plugin, config });
    state.prepared = prepared || state.prepared || null;
    state.config = config || state.config || window.BuretteConfig || null;
    state.structureReady = true;
    state.sceneVersion++;
    try { state.readyResolve?.({ viewer: state.viewer, plugin: state.plugin }); } catch (_) {}
    dispatchAgentEvent('burette-agent-ready', { sceneVersion: state.sceneVersion });
  }

  function dispatchAgentEvent(name, detail) {
    try {
      if (typeof window.CustomEvent === 'function') {
        window.dispatchEvent(new window.CustomEvent(name, { detail }));
      }
    } catch (_) {}
  }

  function getMolstarVersion() {
    return window.molstar?.version || window.molstar?.Viewer?.version || undefined;
  }

  function commands() {
    return [
      'capabilities', 'summary', 'select', 'selectResidues', 'focusSelection', 'colorSelection',
      'labelSelection', 'showLigands', 'focusLigand', 'contacts', 'resetCamera', 'screenshot',
      'showAssemblySymmetry', 'showWaterBridges', 'applyMesoscalePreset', 'colorScalarField',
      'loadMVS', 'observeStory', 'controlStory',
      'exportSession', 'exportMVS'
    ];
  }

  function capabilities() {
    attach();
    const plugin = state.plugin;
    const viewer = state.viewer;
    return {
      apiVersion: API_VERSION,
      version: AGENT_VERSION,
      molstarVersion: getMolstarVersion(),
      commands: commands(),
      aliases: ['window.BuretteAgent', 'window.BuretteAgent'],
      ready: state.structureReady,
      hasViewer: !!viewer,
      hasPlugin: !!plugin,
      hasStructureInteractivity: typeof viewer?.structureInteractivity === 'function',
      hasViewportScreenshot: typeof plugin?.helpers?.viewportScreenshot?.getImageDataUri === 'function',
      hasLoadMvsData: typeof viewer?.loadMvsData === 'function',
      hasAssemblySymmetry: findApplicableStateAction('Assembly Symmetry') != null,
      hasAssemblySymmetryRepresentation: hasAssemblySymmetryRepresentation(),
      hasStoryManager: !!plugin?.managers?.snapshot,
      hasSessionExport: typeof plugin?.managers?.snapshot?.serialize === 'function',
      hasCameraManager: !!plugin?.managers?.camera,
      hasHierarchy: !!plugin?.managers?.structure?.hierarchy,
      notes: [
        'Selections use Mol* Viewer.structureInteractivity with StructureElement.Schema when available.',
        'colorScalarField applies persistent Mol* overpaint with a signed, colorblind-safe diverging scale.',
        'contacts is a lightweight distance-neighborhood calculation, not full interaction chemistry.'
      ]
    };
  }

  function ensureViewer() {
    attach();
    if (!state.viewer || !state.plugin) {
      const error = new Error('Burette Mol* viewer is not attached yet.');
      error.code = 'NO_VIEWER';
      throw error;
    }
  }

  async function waitUntilReady(timeoutMs = DEFAULT_READY_TIMEOUT_MS) {
    ensureViewer();
    if (state.structureReady) return;
    await withTimeout(state.readyPromise, timeoutMs, 'Timed out waiting for Burette structure load.');
  }

  function withTimeout(promise, timeoutMs, message) {
    if (!timeoutMs || timeoutMs <= 0) return promise;
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(message), { code: 'NO_STRUCTURE' })), timeoutMs);
      })
    ]).finally(() => clearTimeout(timer));
  }

  async function run(input, maybeArgs) {
    const req = normalizeRequest(input, maybeArgs);
    const command = req.command;
    const start = now();
    const warnings = [];

    if (!command || typeof command !== 'string') {
      return failure('unknown', 'INVALID_ARGS', 'Request is missing a string command.', start, req, warnings, req.requestId);
    }

    if (req.apiVersion && req.apiVersion !== API_VERSION) {
      warnings.push(`Requested apiVersion ${req.apiVersion}; responding with ${API_VERSION}.`);
    }

    try {
      let result;
      if (command === 'capabilities') {
        result = capabilities();
      } else {
        await waitUntilReady(Number(req.args?.readyTimeoutMs) || DEFAULT_READY_TIMEOUT_MS);
        result = await executeCommand(command, req.args || {}, warnings);
        logCommand(command, req.args || {}, result, warnings);
      }
      return success(command, result, start, warnings, req.requestId);
    } catch (error) {
      const code = error?.code || inferErrorCode(error);
      const message = error?.message || String(error);
      return failure(command, code, message, start, error?.details, warnings, req.requestId);
    }
  }

  async function batch(requests, opts = {}) {
    if (!Array.isArray(requests)) {
      return [await run({ command: 'capabilities', args: {} })];
    }
    const out = [];
    for (const req of requests) {
      const res = await run(req);
      out.push(res);
      if (opts.stopOnError && !res.ok) break;
    }
    return out;
  }

  function inferErrorCode(error) {
    const msg = String(error?.message || error || '');
    if (msg.includes('empty') || msg.includes('matched no atoms')) return 'SELECTION_EMPTY';
    if (msg.includes('not attached')) return 'NO_VIEWER';
    if (msg.includes('No structure')) return 'NO_STRUCTURE';
    if (msg.includes('Unsupported') || msg.includes('not implemented')) return 'NOT_IMPLEMENTED';
    return 'MOLSTAR_ERROR';
  }

  async function executeCommand(command, args, warnings) {
    if (command === 'summary') return commandSummary(args);
    if (command === 'select' || command === 'selectResidues') return commandSelect(args, command, warnings);
    if (command === 'focusSelection') return commandFocus(args, warnings);
    if (command === 'colorSelection') return commandColor(args, warnings);
    if (command === 'labelSelection') return commandLabelSelection(args, warnings);
    if (command === 'showLigands') return commandShowLigands(args, warnings);
    if (command === 'focusLigand') return commandFocusLigand(args, warnings);
    if (command === 'contacts') return commandContacts(args, warnings);
    if (command === 'resetCamera') return commandResetCamera(args, warnings);
    if (command === 'screenshot') return commandScreenshot(args, warnings);
    if (command === 'showAssemblySymmetry') return commandShowAssemblySymmetry(args, warnings);
    if (command === 'showWaterBridges') return commandShowWaterBridges(args, warnings);
    if (command === 'applyMesoscalePreset') return commandApplyMesoscalePreset(args);
    if (command === 'colorScalarField') return commandColorScalarField(args, warnings);
    if (command === 'loadMVS') return commandLoadMVS(args, warnings);
    if (command === 'observeStory') return commandObserveStory();
    if (command === 'controlStory') return commandControlStory(args);
    if (command === 'exportSession') return commandExportSession(args);
    if (command === 'exportMVS') return commandExportMVS(args, warnings);
    const error = new Error(`Unsupported BuretteAgent command: ${command}`);
    error.code = 'NOT_IMPLEMENTED';
    throw error;
  }

  function logCommand(command, args, result, warnings) {
    state.commandLog.push({
      at: new Date().toISOString(),
      command,
      args: cloneJson(args),
      resultSummary: summarizeResultForLog(result),
      warnings: warnings.length ? [...warnings] : undefined,
      sceneVersion: state.sceneVersion
    });
    if (state.commandLog.length > 250) state.commandLog.splice(0, state.commandLog.length - 250);
  }

  function summarizeResultForLog(result) {
    if (!result || typeof result !== 'object') return result;
    if (result.selectionId) return { selectionId: result.selectionId, counts: result.counts };
    if (result.structures) return { structureCount: result.structures.length, format: result.format };
    if (result.dataUri) return { dataUri: '[png data uri]', width: result.width, height: result.height };
    return cloneJson(result);
  }

  function commandSummary(args = {}) {
    const structures = getStructures();
    if (!structures.length) throw coded('NO_STRUCTURE', 'No Mol* structure objects are available yet.');
    const summaries = structures.map((entry, index) => summarizeStructure(entry, index, args));
    const atomCount = summaries.reduce((sum, s) => sum + s.atomCount, 0);
    const residueCount = summaries.reduce((sum, s) => sum + s.residueCount, 0);
    const ligandCount = summaries.reduce((sum, s) => sum + s.ligands.length, 0);
    return {
      format: state.prepared?.format || state.config?.format || undefined,
      label: state.prepared?.label || state.config?.label || undefined,
      structures: summaries,
      counts: {
        structures: summaries.length,
        models: summaries.reduce((sum, s) => sum + s.models, 0),
        chains: summaries.reduce((sum, s) => sum + s.chains.length, 0),
        atoms: atomCount,
        residues: residueCount,
        ligands: ligandCount
      }
    };
  }

  function commandSelect(args = {}, command, warnings) {
    const selector = normalizeSelector(args.selector || args, command === 'selectResidues');
    const counts = countSelectorMatches(selector, Number(args.maxPreviewResidues) || 24);
    if (!counts.atoms) throw coded('SELECTION_EMPTY', 'Selector matched no atoms.', { selector });
    const selectionId = rememberSelection(selector, counts, args.label);
    if (args.applyToViewer !== false) {
      applyMolstarInteractivity(selector, 'select', {
        mode: args.mode || 'replace',
        granularity: args.granularity || 'residue',
        warnings
      });
      state.sceneVersion++;
    }
    return {
      selectionId,
      selectorEcho: selector,
      counts: counts.counts,
      residuesPreview: counts.residuesPreview
    };
  }

  function commandFocus(args = {}, warnings) {
    const selection = resolveSelection(args.selection || args.selector || 'last');
    const counts = countSelectorMatches(selection.selector, Number(args.maxPreviewResidues) || 24);
    if (!counts.atoms) throw coded('SELECTION_EMPTY', 'Focus selector matched no atoms.', { selector: selection.selector });
    applyMolstarInteractivity(selection.selector, 'focus', {
      durationMs: args.durationMs,
      extraRadius: args.extraRadius,
      warnings
    });
    state.sceneVersion++;
    return {
      selectionId: selection.id,
      selectorEcho: selection.selector,
      counts: counts.counts,
      residuesPreview: counts.residuesPreview
    };
  }

  function commandColor(args = {}, warnings) {
    const selection = resolveSelection(args.selection || args.selector || 'last');
    const color = normalizeColor(args.color || args.hex || '#ffcc00');
    const counts = countSelectorMatches(selection.selector, Number(args.maxPreviewResidues) || 24);
    if (!counts.atoms) throw coded('SELECTION_EMPTY', 'Color selector matched no atoms.', { selector: selection.selector });
    applyMolstarInteractivity(selection.selector, args.highlight === false ? 'select' : 'highlight', {
      mode: args.mode || 'replace',
      granularity: args.granularity || 'residue',
      warnings
    });
    warnings.push('Persistent Mol* overpaint is not wired in this no-build MVP; colorSelection records the requested color and applies a viewer highlight/select fallback. Add a bundled overpaint bridge for durable representation coloring.');
    state.sceneVersion++;
    return {
      selectionId: selection.id,
      color,
      persistent: false,
      fallback: args.highlight === false ? 'select' : 'highlight',
      selectorEcho: selection.selector,
      counts: counts.counts,
      residuesPreview: counts.residuesPreview
    };
  }

  async function commandLabelSelection(args = {}, warnings) {
    const selection = resolveSelection(args.selection || args.selector || 'last');
    const counts = countSelectorMatches(selection.selector, Number(args.maxPreviewResidues) || 24);
    if (!counts.atoms) throw coded('SELECTION_EMPTY', 'Label selector matched no atoms.', { selector: selection.selector });
    applyMolstarInteractivity(selection.selector, 'select', {
      mode: args.mode || 'replace',
      granularity: args.granularity || 'residue',
      warnings
    });
    const labels = await addMeasurementLabels(args, warnings);
    if (!labels.length) throw coded('NOT_IMPLEMENTED', 'Mol* measurement label API did not create a label for the current selection.');
    state.sceneVersion++;
    return {
      selectionId: selection.id,
      label: labelSelectionText(args, selection, counts),
      labels,
      selectorEcho: selection.selector,
      counts: counts.counts,
      residuesPreview: counts.residuesPreview
    };
  }

  async function addMeasurementLabels(args = {}, warnings = []) {
    const manager = state.plugin?.managers?.structure?.measurement;
    const selectionManager = state.plugin?.managers?.structure?.selection;
    if (typeof manager?.addLabel !== 'function' || !selectionManager?.entries) {
      throw coded('NOT_IMPLEMENTED', 'Mol* structure measurement labels are unavailable in this runtime.');
    }
    const text = String(args.text || args.label || '').trim();
    const labelParams = {
      customText: text,
      textSize: Number(args.textSize) || 0.32,
      background: args.background !== false,
      backgroundOpacity: Number.isFinite(Number(args.backgroundOpacity)) ? Number(args.backgroundOpacity) : 0.72,
      backgroundMargin: Number.isFinite(Number(args.backgroundMargin)) ? Number(args.backgroundMargin) : 0.22,
      tether: args.tether !== false,
      tetherLength: Number.isFinite(Number(args.tetherLength)) ? Number(args.tetherLength) : 1.6,
      borderWidth: Number.isFinite(Number(args.borderWidth)) ? Number(args.borderWidth) : 0.08,
      offsetY: Number.isFinite(Number(args.offsetY)) ? Number(args.offsetY) : 0.4,
      ...(args.labelParams && typeof args.labelParams === 'object' ? args.labelParams : {})
    };
    const result = [];
    for (const [ref, entry] of selectionManager.entries) {
      const loci = entry?.selection;
      if (!loci || isEmptySelectionLoci(loci)) continue;
      const created = await manager.addLabel(loci, {
        labelParams,
        selectionTags: ['burette-agent-label-selection'],
        reprTags: ['burette-agent-label']
      });
      if (created) {
        result.push({
          structureRef: String(ref),
          selectionRef: created.selection?.ref,
          representationRef: created.representation?.ref
        });
      }
    }
    if (!text) warnings.push('labelSelection used the Mol* default selection label because no custom text was provided.');
    return result;
  }

  function isEmptySelectionLoci(loci) {
    if (!loci) return true;
    if (Array.isArray(loci.elements)) {
      return loci.elements.every(entry => {
        const indices = entry?.indices;
        if (!indices) return true;
        if (Number.isInteger(indices.size)) return indices.size <= 0;
        if (typeof indices.length === 'number') return indices.length <= 0;
        if (typeof indices.end === 'number' && typeof indices.start === 'number') return indices.end <= indices.start;
        return false;
      });
    }
    return false;
  }

  function labelSelectionText(args, selection, counts) {
    const explicit = String(args.text || args.label || '').trim();
    if (explicit) return explicit;
    const saved = String(selection?.label || '').trim();
    if (saved && saved !== 'ligand:undefined') return saved;
    const residue = counts.residuesPreview?.[0];
    if (residue) {
      const comp = residue.auth_comp_id || residue.label_comp_id || residue.kind || 'Selection';
      const chain = residue.auth_asym_id || residue.label_asym_id;
      const seq = residue.auth_seq_id ?? residue.label_seq_id;
      return [comp, chain, seq].filter(value => value != null && value !== '').join(' ');
    }
    return 'Selection';
  }

  function commandShowLigands(args = {}, warnings) {
    const ligands = listLigands();
    if (!ligands.length) throw coded('SELECTION_EMPTY', 'No ligands were detected by the MVP ligand policy.');
    const selector = { kind: 'ligand' };
    const counts = countSelectorMatches(selector, Number(args.maxPreviewResidues) || 48);
    const selectionId = rememberSelection(selector, counts, args.label || 'ligands');
    if (args.applyToViewer !== false) {
      applyMolstarInteractivity(selector, args.highlight ? 'highlight' : 'select', {
        mode: args.mode || 'replace',
        granularity: 'residue',
        warnings
      });
      state.sceneVersion++;
    }
    return { selectionId, ligands, counts: counts.counts, residuesPreview: counts.residuesPreview };
  }

  function commandFocusLigand(args = {}, warnings) {
    const ligands = listLigands();
    if (!ligands.length) throw coded('SELECTION_EMPTY', 'No ligands were detected by the MVP ligand policy.');
    const selector = normalizeSelector(args.selector || args, false);
    const matches = ligands.filter(ligand => matchesLigand(ligand, selector));
    if (!matches.length) throw coded('SELECTION_EMPTY', 'Ligand selector matched no ligands.', { selector, available: ligands });
    const index = Number.isInteger(args.index) ? args.index : 0;
    if (matches.length > 1 && !args.allowAmbiguous && args.index == null) {
      throw coded('INVALID_ARGS', 'Ligand selector is ambiguous; pass chain/residue/index or allowAmbiguous: true.', { selector, matches });
    }
    const ligand = matches[Math.max(0, Math.min(index, matches.length - 1))];
    const ligandSelector = ligandToSelector(ligand);
    const counts = countSelectorMatches(ligandSelector, Number(args.maxPreviewResidues) || 24);
    const selectionId = rememberSelection(ligandSelector, counts, args.label || `ligand:${ligand.label_comp_id}`);
    const focusExtraRadius = Number(args.extraRadius ?? args.radiusA ?? DEFAULT_CONTACT_RADIUS_A);
    applyMolstarInteractivity(ligandSelector, 'select', { mode: 'replace', granularity: 'residue', warnings });
    applyMolstarInteractivity(ligandSelector, 'focus', {
      durationMs: args.durationMs,
      extraRadius: Number.isFinite(focusExtraRadius) && focusExtraRadius > 0 ? focusExtraRadius : DEFAULT_CONTACT_RADIUS_A,
      warnings
    });
    state.sceneVersion++;
    const result = { selectionId, ligand, counts: counts.counts, residuesPreview: counts.residuesPreview };
    if (args.showNeighborhood || args.contacts) {
      try {
        result.neighborhood = computeContacts({
          source: ligandSelector,
          target: args.target || { kind: 'polymer' },
          radiusA: Number(args.radiusA) || DEFAULT_CONTACT_RADIUS_A,
          maxSourceAtoms: args.maxSourceAtoms,
          maxTargetAtoms: args.maxTargetAtoms
        }, warnings);
      } catch (error) {
        const partial = {
          ok: false,
          error: {
            code: error?.code || inferErrorCode(error),
            message: error?.message || String(error),
            details: error?.details
          }
        };
        result.neighborhood = partial;
        warnings.push(`Ligand focus completed, but neighborhood failed: ${partial.error.code}.`);
      }
    }
    return result;
  }

  function commandContacts(args = {}, warnings) {
    return computeContacts(args, warnings);
  }

  function commandResetCamera(args = {}, warnings) {
    const camera = state.plugin?.managers?.camera;
    let handled = false;
    try {
      if (typeof camera?.reset === 'function') {
        camera.reset(Number(args.durationMs) || 250);
        handled = true;
      }
    } catch (error) {
      warnings.push(`camera.reset failed: ${error?.message || String(error)}`);
    }
    try {
      if (!handled && typeof state.plugin?.canvas3d?.requestCameraReset === 'function') {
        state.plugin.canvas3d.requestCameraReset();
        handled = true;
      }
    } catch (error) {
      warnings.push(`canvas3d.requestCameraReset failed: ${error?.message || String(error)}`);
    }
    if (!handled) warnings.push('No Mol* camera reset API was found on this runtime.');
    state.sceneVersion++;
    return { handled };
  }

  async function commandScreenshot(args = {}, warnings) {
    const helper = state.plugin?.helpers?.viewportScreenshot;
    let dataUri = null;
    let size = null;
    if (typeof helper?.getImageDataUri === 'function') {
      const previousValues = helper.behaviors?.values?.value;
      const previousCropParams = helper.behaviors?.cropParams?.value;
      const previousCrop = helper.behaviors?.relativeCrop?.value;
      try {
        const width = Number(args.width);
        const height = Number(args.height);
        const format = ['png', 'jpeg', 'webp'].includes(args.format) ? args.format : 'png';
        const nextValues = {
          ...previousValues,
          resolution: Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
            ? { name: 'custom', params: { width: Math.round(width), height: Math.round(height) } }
            : previousValues?.resolution,
          format: {
            name: format,
            params: format === 'png' ? {} : { quality: Math.max(0, Math.min(1, Number(args.quality) || 0.9)) }
          },
          transparent: args.transparent == null ? previousValues?.transparent : args.transparent === true,
          axes: screenshotAxes(args.axes, previousValues?.axes),
          illumination: args.illumination || previousValues?.illumination
        };
        helper.behaviors?.values?.next(nextValues);
        if (args.crop && typeof args.crop === 'object') {
          helper.behaviors?.cropParams?.next({ ...previousCropParams, auto: false });
          helper.behaviors?.relativeCrop?.next({
            x: Math.max(0, Math.min(1, Number(args.crop.x) || 0)),
            y: Math.max(0, Math.min(1, Number(args.crop.y) || 0)),
            width: Math.max(0, Math.min(1, Number(args.crop.width) || 1)),
            height: Math.max(0, Math.min(1, Number(args.crop.height) || 1))
          });
        } else if (args.autoCrop != null) {
          helper.behaviors?.cropParams?.next({ ...previousCropParams, auto: args.autoCrop === true });
        }
        dataUri = await helper.getImageDataUri();
        size = typeof helper.getSizeAndViewport === 'function' ? helper.getSizeAndViewport().viewport : null;
      } finally {
        if (previousValues) helper.behaviors?.values?.next(previousValues);
        if (previousCropParams) helper.behaviors?.cropParams?.next(previousCropParams);
        if (previousCrop) helper.behaviors?.relativeCrop?.next(previousCrop);
      }
    }
    if (!dataUri) {
      try {
        const canvas = document.querySelector('#app canvas, canvas');
        if (canvas && typeof canvas.toDataURL === 'function') dataUri = canvas.toDataURL('image/png');
      } catch (error) {
        warnings.push(`canvas.toDataURL fallback failed: ${error?.message || String(error)}`);
      }
    }
    if (!dataUri) throw coded('NOT_IMPLEMENTED', 'No screenshot API is available in this runtime.');
    const mimeType = /^data:([^;,]+)/.exec(dataUri)?.[1] || 'image/png';
    return {
      dataUri,
      mimeType,
      width: size?.width || undefined,
      height: size?.height || undefined,
      transparent: args.transparent === true,
      cropped: !!args.crop || args.autoCrop === true,
      note: 'Native/MCP bridge should decode this data URI and write it to an allowlisted local path when a file path is required.'
    };
  }

  const SCREENSHOT_AXES_DEFAULTS = {
    alpha: 0.51,
    colorX: 0xff0000,
    colorY: 0x008000,
    colorZ: 0x0000ff,
    scale: 0.33,
    location: 'bottom-left',
    locationOffsetX: 0,
    locationOffsetY: 0,
    originColor: 0x808080,
    radiusScale: 0.075,
    showPlanes: true,
    planeColorXY: 0x808080,
    planeColorXZ: 0x808080,
    planeColorYZ: 0x808080,
    showLabels: false,
    labelX: 'X',
    labelY: 'Y',
    labelZ: 'Z',
    labelColorX: 0x808080,
    labelColorY: 0x808080,
    labelColorZ: 0x808080,
    labelOpacity: 1,
    labelScale: 0.25
  };

  function screenshotAxes(value, previous) {
    if (value == null) return previous;
    if (value === false || value === 'off' || value?.name === 'off') return { name: 'off', params: {} };
    if (value === true || value === 'on') return { name: 'on', params: { ...SCREENSHOT_AXES_DEFAULTS } };
    if (value?.name === 'on') {
      return { name: 'on', params: { ...SCREENSHOT_AXES_DEFAULTS, ...(value.params || {}) } };
    }
    return previous;
  }

  function stateActionDefaults(action, cell) {
    const params = typeof action?.definition?.params === 'function'
      ? action.definition.params(cell?.obj, state.plugin)
      : action?.definition?.params;
    const values = {};
    for (const [key, entry] of Object.entries(params || {})) values[key] = entry?.defaultValue;
    return values;
  }

  function findApplicableStateAction(name) {
    const data = state.plugin?.state?.data;
    if (typeof data?.actions?.fromCell !== 'function') return null;
    for (const structure of data.cells?.values?.() || []) {
      if (!structure?.obj) continue;
      const action = data.actions.fromCell(structure, state.plugin)
        .find(item => item?.definition?.display?.name === name);
      if (action) return { action, cell: structure, ref: structure.transform?.ref || structure.ref };
    }
    return null;
  }

  function hasAssemblySymmetryRepresentation() {
    const cells = state.plugin?.state?.data?.cells?.values?.() || [];
    for (const cell of cells) {
      if (cell?.obj?.label === 'Global Symmetry') return true;
    }
    return false;
  }

  async function commandShowAssemblySymmetry(args = {}, warnings) {
    const found = findApplicableStateAction('Assembly Symmetry');
    if (!found) {
      throw coded('NOT_APPLICABLE', 'Assembly Symmetry is unavailable for the current structure. Load an assembly with PDB metadata, such as 1RB8 assembly 1.');
    }
    const data = state.plugin.state.data;
    const params = { ...stateActionDefaults(found.action, found.cell), ...(args.params || {}) };
    if (args.serverUrl) params.serverUrl = String(args.serverUrl);
    await state.plugin.runTask(data.applyAction(found.action, params, found.ref));
    const created = Array.from(data.cells?.values?.() || [])
      .filter(cell => cell?.obj?.label === 'Global Symmetry' || cell?.obj?.description?.includes?.('Symmetry'))
      .map(cell => ({
        ref: cell.transform?.ref || cell.ref,
        label: cell.obj?.label,
        description: cell.obj?.description
      }));
    if (!created.length) warnings.push('Mol* completed the action but did not expose a non-C1 symmetry representation; inspect provider logs and assembly metadata.');
    state.sceneVersion++;
    return { applied: true, provider: params.serverUrl || 'Mol* configured provider', objects: created };
  }

  async function commandShowWaterBridges(args = {}, warnings) {
    const plugin = state.plugin;
    const structures = plugin?.managers?.structure?.hierarchy?.current?.structures || [];
    if (!structures.length) throw coded('NO_STRUCTURE', 'No structure is available for water-bridge analysis.');
    let representationCount = 0;
    for (const structure of structures) {
      const ref = structure?.cell || structure;
      const component = await plugin.builders.structure.tryCreateComponentStatic(ref, 'all', {
        label: String(args.label || 'Water-bridge candidates')
      });
      if (!component) continue;
      await plugin.builders.structure.representation.addRepresentation(component.cell || component, {
        type: 'interactions',
        typeParams: {
          bridges: { 'water-bridges': { name: 'on', params: {} } }
        },
        color: 'interaction-type'
      }, { tag: 'burette-water-bridge-candidates' });
      representationCount += 1;
    }
    if (!representationCount) throw coded('NOT_APPLICABLE', 'Mol* could not create an interaction component for this structure.');
    warnings.push('Water bridges are geometry-derived candidates. Confirm explicit waters, altloc/occupancy, donor/acceptor assignments, and cutoffs before scientific interpretation.');
    state.sceneVersion++;
    return {
      representationCount,
      label: 'Water-bridge candidates',
      validationRequired: true,
      provider: 'Mol* interactions water-bridges'
    };
  }

  async function commandApplyMesoscalePreset(args = {}) {
    const plugin = state.plugin;
    const structures = plugin?.managers?.structure?.hierarchy?.current?.structures || [];
    if (!structures.length) throw coded('NO_STRUCTURE', 'No structure is available for the mesoscale preset.');
    const graphics = ['quality', 'balanced', 'performance', 'ultra'].includes(args.graphics) ? args.graphics : 'performance';
    let applied = 0;
    for (const structure of structures) {
      const ref = structure?.cell || structure;
      const result = await plugin.builders.structure.representation.applyPreset(ref, 'mesoscale', { graphics });
      if (result) applied += 1;
    }
    state.sceneVersion++;
    return {
      applied,
      graphics,
      preset: 'preset-structure-representation-mesoscale',
      properties: ['spacefill', 'instance-granularity', 'level-of-detail']
    };
  }

  const SCALAR_COLORS = [
    0x0072B2, 0x2C86BD, 0x58A0C9, 0x85BBD5, 0xB3D6E2,
    0xF2F2F2,
    0xF2D2B2, 0xEDB97E, 0xEAA04D, 0xE78625, 0xE69F00
  ];

  async function commandColorScalarField(args = {}, warnings) {
    const values = Array.from(args.values || [], Number);
    const atoms = collectAtoms(null, { includePositions: false, maxAtoms: 250000 });
    if (!values.length) throw coded('INVALID_ARGS', 'colorScalarField requires a non-empty numeric values array.');
    if (values.some(value => !Number.isFinite(value))) throw coded('INVALID_ARGS', 'colorScalarField values must all be finite numbers.');
    if (values.length !== atoms.length) {
      throw coded('ATOM_MAPPING_MISMATCH', `Scalar field contains ${values.length} values for ${atoms.length} displayed atoms.`, {
        values: values.length,
        atoms: atoms.length,
        mapping: 'Mol* atomic unit traversal order'
      });
    }
    const query = (state.plugin?.query?.structure?.registry?.list || [])
      .find(item => item?.referencesCurrent && item?.label === 'Current Selection');
    const component = state.plugin?.managers?.structure?.component;
    if (!query || typeof component?.applyTheme !== 'function') {
      throw coded('NOT_IMPLEMENTED', 'Mol* current-selection overpaint API is unavailable.');
    }
    let maxAbs = Number.EPSILON;
    for (const value of values) maxAbs = Math.max(maxAbs, Math.abs(value));
    const bins = SCALAR_COLORS.map((color, index) => ({ color, index, atomIndices: [] }));
    for (let index = 0; index < values.length; index += 1) {
      const normalized = Math.max(-1, Math.min(1, values[index] / maxAbs));
      const binIndex = Math.max(0, Math.min(bins.length - 1, Math.round(((normalized + 1) / 2) * (bins.length - 1))));
      bins[binIndex].atomIndices.push(atoms[index].atom_index);
    }
    for (const bin of bins) {
      if (!bin.atomIndices.length) continue;
      applyMolstarInteractivity({ atom_index: bin.atomIndices }, 'select', { mode: 'replace', granularity: 'atom', warnings });
      await component.applyTheme({ action: { name: 'color', params: { color: bin.color } }, selection: query });
    }
    try { state.plugin?.managers?.structure?.selection?.clear?.(); } catch (_) {}
    state.sceneVersion++;
    return {
      applied: true,
      mode: String(args.mode || 'scalar'),
      atomCount: atoms.length,
      mapping: 'Mol* atomic unit traversal order',
      scale: { kind: 'diverging', min: -maxAbs, center: 0, max: maxAbs, colors: SCALAR_COLORS.map(color => `#${color.toString(16).padStart(6, '0')}`) },
      provenance: cloneJson(args.provenance || {})
    };
  }

  async function commandLoadMVS(args = {}, warnings) {
    if (typeof state.viewer?.loadMvsData !== 'function') {
      throw coded('NOT_IMPLEMENTED', 'viewer.loadMvsData is not available in this Mol* viewer build.');
    }
    const { data, format } = mvsCommandPayload(args);
    await state.viewer.loadMvsData(data, format, args.options || {});
    state.sceneVersion++;
    warnings.push('MVS loading is delegated directly to Mol* viewer.loadMvsData.');
    return { format, loaded: true };
  }

  function storySummary() {
    const manager = state.plugin?.managers?.snapshot;
    if (!manager) throw coded('NOT_IMPLEMENTED', 'Mol* snapshot/story manager is unavailable.');
    const entries = Array.from(manager.state?.entries || []).map((entry, index) => ({
      index,
      id: entry.snapshot?.id,
      key: entry.key,
      name: entry.name,
      description: entry.description,
      current: entry.snapshot?.id === manager.state?.current
    }));
    return {
      count: entries.length,
      currentId: manager.state?.current || null,
      currentIndex: entries.findIndex(entry => entry.current),
      isPlaying: manager.state?.isPlaying === true,
      nextSnapshotDelayInMs: manager.state?.nextSnapshotDelayInMs,
      entries
    };
  }

  function commandObserveStory() {
    return storySummary();
  }

  async function commandControlStory(args = {}) {
    const manager = state.plugin?.managers?.snapshot;
    if (!manager) throw coded('NOT_IMPLEMENTED', 'Mol* snapshot/story manager is unavailable.');
    const action = String(args.action || 'next');
    if (action === 'next') await manager.applyNext(1);
    else if (action === 'previous') await manager.applyNext(-1);
    else if (action === 'play') await manager.play({ restart: args.restart === true });
    else if (action === 'pause' || action === 'stop') await manager.stop();
    else if (action === 'goto') {
      const entries = Array.from(manager.state?.entries || []);
      const entry = args.id
        ? entries.find(item => item.snapshot?.id === args.id || item.key === args.id)
        : entries[Number(args.index)];
      if (!entry) throw coded('INVALID_ARGS', 'controlStory goto requires a valid index or snapshot id/key.');
      const snapshot = manager.setCurrent(entry.snapshot.id);
      if (snapshot) await state.plugin.state.setSnapshot(snapshot);
    } else {
      throw coded('INVALID_ARGS', `Unsupported story action: ${action}.`);
    }
    state.sceneVersion++;
    return { action, ...storySummary() };
  }

  async function commandExportSession(args = {}) {
    const manager = state.plugin?.managers?.snapshot;
    if (typeof manager?.serialize !== 'function') throw coded('NOT_IMPLEMENTED', 'Mol* session serialization is unavailable.');
    const type = ['molx', 'molj', 'json'].includes(args.type) ? args.type : 'molx';
    const blob = await manager.serialize({ type, params: args.params });
    const requestedMaxBytes = Number(args.maxBytes);
    const maxBytes = Number.isFinite(requestedMaxBytes) && requestedMaxBytes > 0
      ? Math.min(MAX_INLINE_SESSION_BYTES, Math.floor(requestedMaxBytes))
      : MAX_INLINE_SESSION_BYTES;
    if (blob.size > maxBytes) {
      throw coded('PAYLOAD_TOO_LARGE', `Mol* session is ${blob.size} bytes; inline export is limited to ${maxBytes} bytes.`, {
        byteLength: blob.size,
        maxByteLength: maxBytes,
        type
      });
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return {
      type,
      mimeType: blob.type || (type === 'molx' ? 'application/zip' : 'application/json'),
      byteLength: bytes.byteLength,
      maxByteLength: maxBytes,
      dataBase64: bytesToBase64(bytes),
      story: storySummary()
    };
  }

  function commandExportMVS(args = {}, warnings) {
    warnings.push('This MVP exports the BuretteAgent command log, not an arbitrary Mol* state-tree-to-MVS conversion.');
    return {
      kind: 'burette-agent-command-log',
      apiVersion: API_VERSION,
      version: AGENT_VERSION,
      label: state.prepared?.label || state.config?.label || undefined,
      format: state.prepared?.format || state.config?.format || undefined,
      sceneVersion: state.sceneVersion,
      commands: cloneJson(state.commandLog),
      asJson: args.pretty === false ? undefined : JSON.stringify({
        kind: 'burette-agent-command-log',
        apiVersion: API_VERSION,
        version: AGENT_VERSION,
        commands: state.commandLog
      }, null, 2)
    };
  }

  function coded(code, message, details) {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    return error;
  }

  function getStructures() {
    attach();
    const out = [];
    const seen = new Set();
    const hierarchyStructures = state.plugin?.managers?.structure?.hierarchy?.current?.structures || [];
    for (let i = 0; i < hierarchyStructures.length; i++) {
      const entry = hierarchyStructures[i];
      const data = entry?.cell?.obj?.data || entry?.obj?.data || entry?.data;
      if (!data || seen.has(data)) continue;
      seen.add(data);
      out.push({ data, entry, ref: entry?.cell?.transform?.ref || entry?.cell?.ref || entry?.ref || `structure-${i}` });
    }
    // Very small fallback for test stubs or alternate Mol* state shapes.
    const roots = state.plugin?.state?.data?.tree?.children || state.plugin?.state?.data?.cells;
    if (!out.length && roots && typeof roots.forEach === 'function') {
      roots.forEach((cell, key) => {
        const data = cell?.obj?.data;
        if (data?.units && !seen.has(data)) {
          seen.add(data);
          out.push({ data, entry: cell, ref: cell?.transform?.ref || cell?.ref || key });
        }
      });
    }
    return out;
  }

  function summarizeStructure(entry, index, args = {}) {
    const atoms = collectAtoms(null, { includePositions: false, maxAtoms: Infinity, structureEntry: entry });
    const chainMap = new Map();
    const residueMap = new Map();
    const ligandMap = new Map();
    const modelSet = new Set();

    for (const atom of atoms) {
      modelSet.add(atom.modelIndex ?? 0);
      const chainKey = [atom.label_entity_id, atom.label_asym_id, atom.auth_asym_id].join('|');
      let chain = chainMap.get(chainKey);
      if (!chain) {
        chain = {
          label_entity_id: atom.label_entity_id,
          label_asym_id: atom.label_asym_id,
          auth_asym_id: atom.auth_asym_id,
          entityType: atom.entityType || atom.kind,
          atomCount: 0,
          residueCount: 0,
          authSeqRange: [null, null],
          labelSeqRange: [null, null],
          _residues: new Set()
        };
        chainMap.set(chainKey, chain);
      }
      chain.atomCount++;
      const residueKey = residueIdentity(atom);
      if (!chain._residues.has(residueKey)) {
        chain._residues.add(residueKey);
        chain.residueCount++;
        updateRange(chain.authSeqRange, atom.auth_seq_id);
        updateRange(chain.labelSeqRange, atom.label_seq_id);
      }
      if (!residueMap.has(residueKey)) {
        residueMap.set(residueKey, residueSummary(atom));
      }
      if (atom.kind === 'ligand') {
        let ligand = ligandMap.get(residueKey);
        if (!ligand) {
          ligand = { ...residueSummary(atom), atomCount: 0 };
          ligandMap.set(residueKey, ligand);
        }
        ligand.atomCount++;
      }
    }

    const chains = Array.from(chainMap.values()).map(chain => {
      const clean = { ...chain };
      delete clean._residues;
      clean.authSeqRange = clean.authSeqRange[0] == null ? undefined : clean.authSeqRange;
      clean.labelSeqRange = clean.labelSeqRange[0] == null ? undefined : clean.labelSeqRange;
      return clean;
    }).sort(sortChain);

    const ligands = Array.from(ligandMap.values())
      .map(ligand => ({ ...ligand, category: ligandCategory(ligand) }))
      .sort(sortResidueLike);
    const summary = {
      id: String(entry.ref || `structure-${index}`),
      label: entry.entry?.cell?.obj?.label || state.prepared?.label || state.config?.label || undefined,
      models: Math.max(1, modelSet.size),
      atomCount: atoms.length,
      residueCount: residueMap.size,
      chains,
      ligands
    };
    if (args.includeResidues) {
      summary.residues = Array.from(residueMap.values()).sort(sortResidueLike);
    }
    return summary;
  }

  function updateRange(range, value) {
    if (!Number.isFinite(value)) return;
    if (range[0] == null || value < range[0]) range[0] = value;
    if (range[1] == null || value > range[1]) range[1] = value;
  }

  function sortChain(a, b) {
    return String(a.auth_asym_id || a.label_asym_id || '').localeCompare(String(b.auth_asym_id || b.label_asym_id || ''), undefined, { numeric: true });
  }

  function sortResidueLike(a, b) {
    const c = String(a.auth_asym_id || a.label_asym_id || '').localeCompare(String(b.auth_asym_id || b.label_asym_id || ''), undefined, { numeric: true });
    if (c) return c;
    return (a.auth_seq_id ?? a.label_seq_id ?? 0) - (b.auth_seq_id ?? b.label_seq_id ?? 0);
  }

  function residueSummary(atom) {
    return {
      label_entity_id: atom.label_entity_id,
      label_asym_id: atom.label_asym_id,
      auth_asym_id: atom.auth_asym_id,
      label_seq_id: atom.label_seq_id,
      auth_seq_id: atom.auth_seq_id,
      pdbx_PDB_ins_code: atom.pdbx_PDB_ins_code,
      label_comp_id: atom.label_comp_id,
      auth_comp_id: atom.auth_comp_id,
      kind: atom.kind
    };
  }

  function collectAtoms(selector, options = {}) {
    const structures = options.structureEntry ? [options.structureEntry] : getStructures();
    const atoms = [];
    const includePositions = options.includePositions !== false;
    const maxAtoms = options.maxAtoms == null ? Infinity : Number(options.maxAtoms);
    for (let structureIndex = 0; structureIndex < structures.length; structureIndex++) {
      const entry = structures[structureIndex];
      const structure = entry.data || entry;
      const units = Array.isArray(structure?.units) ? structure.units : [];
      for (let unitIndex = 0; unitIndex < units.length; unitIndex++) {
        const unit = units[unitIndex];
        const elements = unit?.elements || [];
        for (let i = 0; i < elements.length; i++) {
          const atomIndex = elements[i];
          const atom = atomRecord(entry, structureIndex, unit, unitIndex, atomIndex, includePositions);
          if (!atom) continue;
          if (selector && !matchesSelector(atom, selector)) continue;
          atoms.push(atom);
          if (atoms.length >= maxAtoms) return atoms;
        }
      }
    }
    return atoms;
  }

  function atomRecord(entry, structureIndex, unit, unitIndex, atomIndex, includePosition) {
    const model = unit?.model;
    const ah = model?.atomicHierarchy;
    if (!ah) return null;
    const residueIndex = segmentIndex(ah.residueAtomSegments, atomIndex);
    const chainIndex = segmentIndex(ah.chainAtomSegments, atomIndex);
    const atoms = ah.atoms || {};
    const residues = ah.residues || {};
    const chains = ah.chains || {};
    const labelEntity = valueAt(chains.label_entity_id, chainIndex);
    // The component name lives on the atom table, not the residue one: Mol*'s
    // residues table carries only group_PDB, the seq ids and the insertion code.
    // Read from residues it was always undefined, so every atom reached
    // classify() with an empty component - which made ions indistinguishable
    // from ligands and left kind:"ion" and every comp-id selector matching
    // nothing at all.
    // Prefer the atom table and fall back to the residue one, since which table
    // carries the name depends on the Mol* build.
    const labelComp = valueAt(atoms.label_comp_id, atomIndex) ?? valueAt(residues.label_comp_id, residueIndex);
    const authComp = valueAt(atoms.auth_comp_id, atomIndex) ?? valueAt(residues.auth_comp_id, residueIndex) ?? labelComp;
    const entityType = entityTypeFor(model, labelEntity);
    const rec = {
      structureId: String(entry.ref || `structure-${structureIndex}`),
      structureIndex,
      modelIndex: Number(model?.modelNum || model?.trajectoryInfo?.index || 0),
      unitIndex,
      unitId: unit?.id,
      atom_index: atomIndex,
      atom_id: numberOrUndefined(valueAt(atoms.id, atomIndex)),
      label_atom_id: valueAt(atoms.label_atom_id, atomIndex),
      auth_atom_id: valueAt(atoms.auth_atom_id, atomIndex),
      type_symbol: valueAt(atoms.type_symbol, atomIndex),
      label_entity_id: labelEntity,
      label_asym_id: valueAt(chains.label_asym_id, chainIndex),
      auth_asym_id: valueAt(chains.auth_asym_id, chainIndex),
      label_seq_id: numberOrUndefined(valueAt(residues.label_seq_id, residueIndex)),
      auth_seq_id: numberOrUndefined(valueAt(residues.auth_seq_id, residueIndex)),
      pdbx_PDB_ins_code: normalizeMissing(valueAt(residues.pdbx_PDB_ins_code, residueIndex)),
      label_comp_id: labelComp,
      auth_comp_id: authComp,
      entityType,
      residueIndex,
      chainIndex
    };
    rec.kind = classify(rec);
    if (includePosition) rec.position = atomPosition(unit, atomIndex);
    return rec;
  }

  function valueAt(column, index) {
    if (index == null || index < 0 || !column) return undefined;
    try {
      if (typeof column.value === 'function') return normalizeMissing(column.value(index));
      if (Array.isArray(column)) return normalizeMissing(column[index]);
      if (column.array) return normalizeMissing(column.array[index]);
      if (column.data) return normalizeMissing(column.data[index]);
      return normalizeMissing(column[index]);
    } catch (_) {
      return undefined;
    }
  }

  function normalizeMissing(value) {
    if (value == null || value === '?' || value === '.') return undefined;
    return value;
  }

  function numberOrUndefined(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }

  function segmentIndex(segment, atomIndex) {
    const idx = segment?.index;
    const value = valueAt(idx, atomIndex);
    return Number.isInteger(value) ? value : numberOrUndefined(value);
  }

  function entityTypeFor(model, labelEntityId) {
    if (!model || labelEntityId == null) return undefined;
    try {
      const entities = model.entities;
      let index = undefined;
      if (typeof entities?.getEntityIndex === 'function') index = entities.getEntityIndex(labelEntityId);
      if (index == null && entities?.data?.id) {
        const rowCount = entities.data._rowCount || entities.data.rowCount || 0;
        for (let i = 0; i < rowCount; i++) {
          if (String(valueAt(entities.data.id, i)) === String(labelEntityId)) { index = i; break; }
        }
      }
      return valueAt(entities?.data?.type, index);
    } catch (_) {
      return undefined;
    }
  }

  function atomPosition(unit, atomIndex) {
    const c = unit?.conformation;
    try {
      if (typeof c?.position === 'function') {
        const v = [0, 0, 0];
        c.position(atomIndex, v);
        return [Number(v[0]), Number(v[1]), Number(v[2])];
      }
    } catch (_) {}
    try {
      const x = typeof c?.x === 'function' ? c.x(atomIndex) : valueAt(c?.x, atomIndex);
      const y = typeof c?.y === 'function' ? c.y(atomIndex) : valueAt(c?.y, atomIndex);
      const z = typeof c?.z === 'function' ? c.z(atomIndex) : valueAt(c?.z, atomIndex);
      if ([x, y, z].every(Number.isFinite)) return [Number(x), Number(y), Number(z)];
    } catch (_) {}
    return [NaN, NaN, NaN];
  }

  function classify(atom) {
    const comp = String(atom.label_comp_id || atom.auth_comp_id || '').toUpperCase();
    const entityType = String(atom.entityType || '').toLowerCase();
    if (WATER.has(comp) || entityType === 'water') return 'water';
    if (STANDARD_AA.has(comp)) return 'protein';
    if (NUCLEIC.has(comp)) return 'nucleic';
    if (entityType === 'polymer') return 'polymer';
    if (COMMON_IONS.has(comp)) return 'ion';
    return 'ligand';
  }

  function normalizeSelector(input, residueDefaults) {
    if (input === 'last') return resolveSelection('last').selector;
    if (typeof input === 'string') return { kind: input };
    const selector = { ...input };
    delete selector.readyTimeoutMs;
    delete selector.applyToViewer;
    delete selector.mode;
    delete selector.granularity;
    delete selector.maxPreviewResidues;
    delete selector.label;
    if (selector.comp_id && !selector.label_comp_id && !selector.auth_comp_id) {
      selector.label_comp_id = selector.comp_id;
      delete selector.comp_id;
    }
    if (selector.chain && !selector.auth_asym_id && !selector.label_asym_id) {
      selector.auth_asym_id = selector.chain;
      delete selector.chain;
    }
    if (selector.start != null && selector.end != null && !selector.beg_auth_seq_id && !selector.beg_label_seq_id) {
      selector.beg_auth_seq_id = Number(selector.start);
      selector.end_auth_seq_id = Number(selector.end);
      delete selector.start;
      delete selector.end;
    }
    if (selector.range && Array.isArray(selector.range) && !selector.beg_auth_seq_id && !selector.beg_label_seq_id) {
      selector.beg_auth_seq_id = Number(selector.range[0]);
      selector.end_auth_seq_id = Number(selector.range[1]);
      delete selector.range;
    }
    if (residueDefaults && selector.auth_seq_id == null && selector.label_seq_id == null && selector.beg_auth_seq_id == null && selector.beg_label_seq_id == null) {
      // Nothing to add; selecting a whole chain is allowed.
    }
    for (const key of ['label_seq_id', 'auth_seq_id', 'beg_label_seq_id', 'end_label_seq_id', 'beg_auth_seq_id', 'end_auth_seq_id', 'atom_id', 'atom_index']) {
      if (selector[key] != null && !Array.isArray(selector[key])) selector[key] = Number(selector[key]);
    }
    return selector;
  }

  function matchesSelector(atom, selector = {}) {
    if (!selector || selector.kind === 'all') return true;
    if (Array.isArray(selector.residues) && selector.residues.length > 0) {
      const baseSelector = { ...selector };
      delete baseSelector.residues;
      return selector.residues.some(residue => matchesSelector(atom, { ...baseSelector, ...normalizeSelector(residue, false) }));
    }
    if (selector.structure && selector.structure !== 'primary' && selector.structure !== atom.structureId && Number(selector.structure) !== atom.structureIndex) return false;
    if (selector.modelIndex != null && Number(selector.modelIndex) !== atom.modelIndex) return false;
    if (selector.kind && !matchesKind(atom, selector.kind)) return false;
    for (const key of ['label_entity_id', 'label_asym_id', 'auth_asym_id', 'pdbx_PDB_ins_code', 'label_comp_id', 'auth_comp_id', 'label_atom_id', 'auth_atom_id', 'type_symbol', 'atom_id', 'atom_index', 'instance_id']) {
      if (selector[key] != null && !selectorFieldMatches(atom, key, selector[key])) return false;
    }
    for (const key of ['label_seq_id', 'auth_seq_id']) {
      if (selector[key] != null && !selectorFieldMatches(atom, key, selector[key])) return false;
    }
    if (!rangeSelectorMatches(atom, 'label_seq_id', selector.beg_label_seq_id, selector.end_label_seq_id)) return false;
    if (!rangeSelectorMatches(atom, 'auth_seq_id', selector.beg_auth_seq_id, selector.end_auth_seq_id)) return false;
    return true;
  }

  function matchesKind(atom, kind) {
    const k = String(kind || '').toLowerCase();
    if (k === 'all') return true;
    if (k === 'polymer') return atom.kind === 'protein' || atom.kind === 'nucleic' || atom.kind === 'polymer';
    if (k === 'protein') return atom.kind === 'protein';
    if (k === 'nucleic') return atom.kind === 'nucleic';
    if (k === 'ligand') return atom.kind === 'ligand';
    if (k === 'ion') return atom.kind === 'ion';
    if (k === 'water') return atom.kind === 'water';
    return atom.kind === k;
  }

  function fieldMatches(value, expected) {
    if (Array.isArray(expected)) return expected.some(x => fieldMatches(value, x));
    if (expected == null) return true;
    if (value == null) return false;
    return String(value) === String(expected);
  }

  function selectorFieldMatches(atom, key, expected) {
    return selectorFieldValues(atom, key).some(value => fieldMatches(value, expected));
  }

  function selectorFieldValues(atom, key) {
    const value = atom[key];
    const values = value == null ? [] : [value];
    const fallback = {
      auth_asym_id: 'label_asym_id',
      label_asym_id: 'auth_asym_id',
      auth_seq_id: 'label_seq_id',
      label_seq_id: 'auth_seq_id',
      auth_comp_id: 'label_comp_id',
      label_comp_id: 'auth_comp_id',
      auth_atom_id: 'label_atom_id',
      label_atom_id: 'auth_atom_id'
    }[key];
    const fallbackValue = fallback ? atom[fallback] : null;
    if (fallbackValue != null && !values.some(item => String(item) === String(fallbackValue))) values.push(fallbackValue);
    return values;
  }

  function rangeSelectorMatches(atom, key, beg, end) {
    if (beg == null && end == null) return true;
    return selectorFieldValues(atom, key).some(value => rangeMatches(value, beg, end));
  }

  function rangeMatches(value, beg, end) {
    if (beg == null && end == null) return true;
    const n = Number(value);
    if (!Number.isFinite(n)) return false;
    if (beg != null && n < Number(beg)) return false;
    if (end != null && n > Number(end)) return false;
    return true;
  }

  function countSelectorMatches(selector, maxPreviewResidues = 24) {
    const atoms = collectAtoms(selector, { includePositions: false });
    const residueMap = new Map();
    const chainSet = new Set();
    for (const atom of atoms) {
      residueMap.set(residueIdentity(atom), residueSummary(atom));
      chainSet.add([atom.label_entity_id, atom.label_asym_id, atom.auth_asym_id].join('|'));
    }
    return {
      atoms: atoms.length,
      residues: residueMap.size,
      counts: { atoms: atoms.length, residues: residueMap.size, chains: chainSet.size },
      residuesPreview: Array.from(residueMap.values()).sort(sortResidueLike).slice(0, maxPreviewResidues)
    };
  }

  function residueIdentity(atom) {
    return [
      atom.structureId,
      atom.modelIndex,
      atom.label_entity_id,
      atom.label_asym_id,
      atom.auth_asym_id,
      atom.label_seq_id,
      atom.auth_seq_id,
      atom.pdbx_PDB_ins_code || '',
      atom.label_comp_id
    ].join('|');
  }

  function rememberSelection(selector, counts, label) {
    state.selectionCounter++;
    const id = `sel-${String(state.selectionCounter).padStart(6, '0')}`;
    state.selections.set(id, {
      id,
      label,
      selector: cloneJson(selector),
      counts: counts.counts,
      createdAt: new Date().toISOString()
    });
    state.lastSelectionId = id;
    return id;
  }

  function resolveSelection(selection) {
    if (!selection || selection === 'last') {
      if (!state.lastSelectionId) throw coded('INVALID_ARGS', 'No previous selection exists.');
      return state.selections.get(state.lastSelectionId);
    }
    if (typeof selection === 'string') {
      const saved = state.selections.get(selection);
      if (!saved) throw coded('INVALID_ARGS', `Unknown selection id: ${selection}`);
      return saved;
    }
    const selector = normalizeSelector(selection, false);
    const counts = countSelectorMatches(selector, 0);
    const id = rememberSelection(selector, counts, selection.label);
    return state.selections.get(id);
  }

  function applyMolstarInteractivity(selector, action, options = {}) {
    const viewer = state.viewer;
    if (typeof viewer?.structureInteractivity !== 'function') {
      options.warnings?.push('viewer.structureInteractivity is not available; JSON result was computed without visual Mol* selection/focus.');
      return;
    }
    const atoms = collectAtoms(selector, { includePositions: false, maxAtoms: 200000 });
    const schemas = schemasForSelector(selector, atoms, options.warnings);
    if (action === 'select' && options.mode !== 'add') {
      try { viewer.structureInteractivity({ action: 'select' }); } catch (_) {}
    }
    if (action === 'highlight' && options.mode !== 'add') {
      try { viewer.structureInteractivity({ action: 'highlight' }); } catch (_) {}
    }
    const focusOptions = {
      durationMs: Number(options.durationMs) || 250,
      extraRadius: Number(options.extraRadius) || undefined,
      optimizeDirection: options.optimizeDirection !== false,
      zoomOut: options.zoomOut !== false
    };
    for (const schema of schemas) {
      try {
        viewer.structureInteractivity({
          elements: schema,
          action,
          applyGranularity: options.granularity !== 'atom',
          focusOptions: action === 'focus' ? focusOptions : undefined
        });
        if (action === 'focus') break;
      } catch (error) {
        options.warnings?.push(`viewer.structureInteractivity(${action}) failed: ${error?.message || String(error)}`);
      }
    }
  }

  function schemasForSelector(selector, atoms, warnings) {
    const direct = directSchema(selector);
    if (direct) return expandSchemaArrays(direct);
    const residueMap = new Map();
    for (const atom of atoms) {
      residueMap.set(residueIdentity(atom), ligandToSelector(residueSummary(atom)));
      if (residueMap.size > MAX_SCHEMA_RESIDUES) break;
    }
    if (residueMap.size > MAX_SCHEMA_RESIDUES) {
      warnings?.push(`Selector expands to more than ${MAX_SCHEMA_RESIDUES} residues; Mol* visual application is capped.`);
    }
    return Array.from(residueMap.values()).slice(0, MAX_SCHEMA_RESIDUES).map(directSchema).filter(Boolean);
  }

  function expandSchemaArrays(schema) {
    const arrayEntries = Object.entries(schema).filter(([, value]) => Array.isArray(value));
    if (arrayEntries.length === 0) return [schema];
    if (arrayEntries.length > 1) {
      return [schema];
    }
    const [[field, values]] = arrayEntries;
    return values.map(value => ({ ...schema, [field]: value }));
  }

  function directSchema(selector = {}) {
    if (selector.kind && !hasAnySchemaField(selector)) return null;
    const schema = {};
    for (const field of SCHEMA_FIELDS) {
      if (selector[field] != null) schema[field] = selector[field];
    }
    return Object.keys(schema).length ? schema : null;
  }

  function hasAnySchemaField(selector) {
    return SCHEMA_FIELDS.some(field => selector[field] != null);
  }

  function listLigands() {
    const ligands = new Map();
    for (const atom of collectAtoms({ kind: 'ligand' }, { includePositions: false })) {
      const key = residueIdentity(atom);
      let ligand = ligands.get(key);
      if (!ligand) {
        ligand = { ...residueSummary(atom), atomCount: 0 };
        ligands.set(key, ligand);
      }
      ligand.atomCount++;
    }
    return Array.from(ligands.values())
      .map(ligand => ({ ...ligand, category: ligandCategory(ligand) }))
      .sort(sortResidueLike);
  }

  function ligandCategory(ligand) {
    const comp = String(ligand.label_comp_id || ligand.auth_comp_id || '').toUpperCase();
    if (COMMON_IONS.has(comp) || ligand.kind === 'ion') return 'ion';
    if (Number(ligand.atomCount) === 1) return 'single_atom';
    return 'small_molecule';
  }

  function matchesLigand(ligand, selector) {
    const cleaned = { ...selector };
    delete cleaned.kind;
    if ((cleaned.label_comp_id != null || cleaned.auth_comp_id != null) && ligand.label_comp_id == null && ligand.auth_comp_id == null && hasResidueAddress(cleaned)) {
      delete cleaned.label_comp_id;
      delete cleaned.auth_comp_id;
    }
    if (!Object.keys(cleaned).length) return true;
    return matchesSelector({ ...ligand, kind: 'ligand' }, cleaned);
  }

  function hasResidueAddress(selector) {
    const hasChain = selector.label_asym_id != null || selector.auth_asym_id != null;
    const hasSeq = selector.label_seq_id != null || selector.auth_seq_id != null || selector.beg_label_seq_id != null || selector.beg_auth_seq_id != null;
    return hasChain && hasSeq;
  }

  function ligandToSelector(ligand) {
    const selector = { kind: 'ligand' };
    for (const key of ['label_entity_id', 'label_asym_id', 'auth_asym_id', 'label_seq_id', 'auth_seq_id', 'pdbx_PDB_ins_code', 'label_comp_id', 'auth_comp_id']) {
      if (ligand[key] != null) selector[key] = ligand[key];
    }
    return selector;
  }

  function normalizeColor(value) {
    const text = String(value || '').trim();
    if (/^#[0-9a-f]{6}$/iu.test(text)) return text.toLowerCase();
    if (/^0x[0-9a-f]{6}$/iu.test(text)) return `#${text.slice(2).toLowerCase()}`;
    if (/^[0-9a-f]{6}$/iu.test(text)) return `#${text.toLowerCase()}`;
    return '#ffcc00';
  }

  function computeContacts(args = {}, warnings = []) {
    const radiusA = Number(args.radiusA || args.radius || DEFAULT_CONTACT_RADIUS_A);
    if (!Number.isFinite(radiusA) || radiusA <= 0 || radiusA > 20) {
      throw coded('INVALID_ARGS', 'contacts radiusA must be in (0, 20].', { radiusA });
    }
    const sourceInput = args.source || args.selection || args.selector || 'last';
    const sourceSelector = normalizeSelector(
      typeof sourceInput === 'string' && (sourceInput === 'last' || state.selections.has(sourceInput))
        ? resolveSelection(sourceInput).selector
        : sourceInput,
      false
    );
    const targetSelector = normalizeSelector(args.target || { kind: 'protein' }, false);
    const maxSourceAtoms = Number(args.maxSourceAtoms) || MAX_CONTACT_SOURCE_ATOMS;
    const maxTargetAtoms = Number(args.maxTargetAtoms) || MAX_CONTACT_TARGET_ATOMS;
    const sourceAtoms = collectAtoms(sourceSelector, { includePositions: true, maxAtoms: maxSourceAtoms + 1 });
    const targetAtoms = collectAtoms(targetSelector, { includePositions: true, maxAtoms: maxTargetAtoms + 1 });
    if (!sourceAtoms.length) throw coded('SELECTION_EMPTY', 'contacts source selector matched no atoms.', { sourceSelector });
    if (!targetAtoms.length) throw coded('SELECTION_EMPTY', 'contacts target selector matched no atoms.', { targetSelector });
    if (sourceAtoms.length > maxSourceAtoms) warnings.push(`contacts source atoms capped at ${maxSourceAtoms}.`);
    if (targetAtoms.length > maxTargetAtoms) warnings.push(`contacts target atoms capped at ${maxTargetAtoms}.`);

    const grid = buildSpatialGrid(targetAtoms.slice(0, maxTargetAtoms), radiusA);
    const residues = new Map();
    const radius2 = radiusA * radiusA;
    let pairCount = 0;
    for (const sourceAtom of sourceAtoms.slice(0, maxSourceAtoms)) {
      if (!finitePosition(sourceAtom.position)) continue;
      for (const targetAtom of nearbyAtoms(grid, sourceAtom.position, radiusA)) {
        if (!finitePosition(targetAtom.position)) continue;
        if (residueIdentity(sourceAtom) === residueIdentity(targetAtom)) continue;
        const d2 = squaredDistance(sourceAtom.position, targetAtom.position);
        if (d2 > radius2) continue;
        pairCount++;
        const key = residueIdentity(targetAtom);
        let residue = residues.get(key);
        const distance = Math.sqrt(d2);
        if (!residue) {
          residue = { ...residueSummary(targetAtom), minDistanceA: distance, contactAtomCount: 0, examples: [] };
          residues.set(key, residue);
        }
        residue.minDistanceA = Math.min(residue.minDistanceA, distance);
        residue.contactAtomCount++;
        if (residue.examples.length < 3) {
          residue.examples.push({
            source: atomLabel(sourceAtom),
            target: atomLabel(targetAtom),
            distanceA: Number(distance.toFixed(3))
          });
        }
      }
    }
    const residueList = Array.from(residues.values())
      .map(r => ({ ...r, minDistanceA: Number(r.minDistanceA.toFixed(3)) }))
      .sort((a, b) => a.minDistanceA - b.minDistanceA || sortResidueLike(a, b));
    return {
      method: 'distance-neighborhood',
      classified: false,
      radiusA,
      sourceSelector,
      targetSelector,
      sourceAtomCount: Math.min(sourceAtoms.length, maxSourceAtoms),
      targetAtomCount: Math.min(targetAtoms.length, maxTargetAtoms),
      pairCount,
      residues: residueList
    };
  }

  function atomLabel(atom) {
    return {
      auth_asym_id: atom.auth_asym_id,
      auth_seq_id: atom.auth_seq_id,
      label_comp_id: atom.label_comp_id,
      atom: atom.auth_atom_id || atom.label_atom_id,
      type_symbol: atom.type_symbol
    };
  }

  function finitePosition(pos) {
    return Array.isArray(pos) && pos.length >= 3 && pos.every(Number.isFinite);
  }

  function buildSpatialGrid(atoms, cellSize) {
    const cells = new Map();
    for (const atom of atoms) {
      if (!finitePosition(atom.position)) continue;
      const key = gridKey(atom.position, cellSize);
      let bucket = cells.get(key);
      if (!bucket) cells.set(key, bucket = []);
      bucket.push(atom);
    }
    return { cells, cellSize };
  }

  function gridKey(pos, cellSize) {
    return `${Math.floor(pos[0] / cellSize)},${Math.floor(pos[1] / cellSize)},${Math.floor(pos[2] / cellSize)}`;
  }

  function nearbyAtoms(grid, pos) {
    const ix = Math.floor(pos[0] / grid.cellSize);
    const iy = Math.floor(pos[1] / grid.cellSize);
    const iz = Math.floor(pos[2] / grid.cellSize);
    const out = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.cells.get(`${ix + dx},${iy + dy},${iz + dz}`);
          if (bucket) out.push(...bucket);
        }
      }
    }
    return out;
  }

  function squaredDistance(a, b) {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const dz = a[2] - b[2];
    return dx * dx + dy * dy + dz * dz;
  }

  const agent = {
    version: AGENT_VERSION,
    apiVersion: API_VERSION,
    get ready() { return state.readyPromise; },
    attach,
    notifyStructureLoaded,
    capabilities: () => run({ command: 'capabilities' }),
    run,
    batch,
    _state: state
  };

  window.BuretteAgent = agent;
  window.BuretteAgent = agent;

  if (window.BuretteViewer || window.BuretteViewer) {
    attach({ viewer: window.BuretteViewer || window.BuretteViewer });
  }
})();
