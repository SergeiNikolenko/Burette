(function (root) {
  'use strict';

  const DEFAULT_IDLE_DISPOSE_MS = 4000;

  function create(dependencies, options) {
    const deps = dependencies || {};
    const config = options || {};
    const createViewer = typeof deps.createViewer === 'function'
      ? deps.createViewer
      : async () => null;
    const disposeViewer = typeof deps.disposeViewer === 'function'
      ? deps.disposeViewer
      : () => {};
    const startViewer = typeof deps.startViewer === 'function'
      ? deps.startViewer
      : () => {};
    const stopViewer = typeof deps.stopViewer === 'function'
      ? deps.stopViewer
      : () => {};
    const renderPreview = typeof deps.renderPreview === 'function'
      ? deps.renderPreview
      : async () => {};
    const applyPreset = typeof deps.applyPreset === 'function'
      ? deps.applyPreset
      : async () => {};
    const scheduleTimeout = typeof deps.setTimeout === 'function'
      ? deps.setTimeout
      : typeof root.setTimeout === 'function' ? root.setTimeout.bind(root) : () => 0;
    const cancelTimeout = typeof deps.clearTimeout === 'function'
      ? deps.clearTimeout
      : typeof root.clearTimeout === 'function' ? root.clearTimeout.bind(root) : () => {};
    const idleDisposeMs = Number.isFinite(Number(config.idleDisposeMs))
      ? Math.max(0, Number(config.idleDisposeMs))
      : DEFAULT_IDLE_DISPOSE_MS;
    const stopAfterRender = config.stopAfterRender === true;

    let disposed = false;
    let visible = true;
    let previewEpoch = 0;
    let viewer = null;
    let viewerRunning = false;
    let creation = null;
    let activeRender = null;
    let idleDisposeTimer = 0;
    const disposedViewers = new Set();
    const pendingApplies = [];
    const appliesByKey = new Map();
    let activeApply = null;
    let applyDrain = null;

    function safely(action, value) {
      try {
        return action(value);
      } catch (_) {
        return undefined;
      }
    }

    function disposeViewerOnce(value) {
      if (!value || disposedViewers.has(value)) return;
      disposedViewers.add(value);
      if (viewer === value) {
        viewer = null;
        viewerRunning = false;
      }
      safely(stopViewer, value);
      safely(disposeViewer, value);
    }

    function startRetainedViewer() {
      if (!viewer || viewerRunning || !visible || disposed) return;
      viewerRunning = true;
      safely(startViewer, viewer);
    }

    function stopRetainedViewer() {
      if (!viewer || !viewerRunning) return;
      viewerRunning = false;
      safely(stopViewer, viewer);
    }

    function clearIdleDisposal() {
      if (!idleDisposeTimer) return;
      cancelTimeout(idleDisposeTimer);
      idleDisposeTimer = 0;
    }

    function scheduleIdleDisposal() {
      clearIdleDisposal();
      const retainedViewer = viewer;
      if (!retainedViewer || disposed) return;
      idleDisposeTimer = scheduleTimeout(() => {
        idleDisposeTimer = 0;
        if (disposed || visible || viewer !== retainedViewer) return;
        disposeViewerOnce(retainedViewer);
      }, idleDisposeMs);
    }

    async function runPreview(payload, epoch) {
      let retainedViewer = viewer;
      if (!retainedViewer) {
        const candidate = { epoch, cancelled: false };
        creation = candidate;
        try {
          retainedViewer = await createViewer();
        } catch (error) {
          if (creation === candidate) creation = null;
          if (disposed || candidate.cancelled || epoch !== previewEpoch) return undefined;
          throw error;
        }
        if (creation === candidate) creation = null;
        if (disposed || candidate.cancelled || epoch !== previewEpoch || !retainedViewer) {
          disposeViewerOnce(retainedViewer);
          return undefined;
        }
        viewer = retainedViewer;
      }

      if (disposed || epoch !== previewEpoch || viewer !== retainedViewer) return undefined;
      startRetainedViewer();
      const render = { epoch, viewer: retainedViewer };
      activeRender = render;
      try {
        const result = await renderPreview(retainedViewer, payload);
        if (disposed || epoch !== previewEpoch || viewer !== retainedViewer) return undefined;
        return result;
      } finally {
        if (activeRender === render) activeRender = null;
        if (stopAfterRender && viewer === retainedViewer) stopRetainedViewer();
      }
    }

    function requestPreview(payload) {
      if (disposed) return Promise.resolve(undefined);
      const epoch = ++previewEpoch;
      clearIdleDisposal();

      if (creation) {
        creation.cancelled = true;
        creation = null;
      }
      if (activeRender) {
        const staleViewer = activeRender.viewer;
        activeRender = null;
        disposeViewerOnce(staleViewer);
      }

      return runPreview(payload, epoch);
    }

    function show() {
      if (disposed) return;
      visible = true;
      clearIdleDisposal();
      startRetainedViewer();
    }

    function hide() {
      if (disposed) return;
      visible = false;
      stopRetainedViewer();
      scheduleIdleDisposal();
    }

    function applyKey(payload) {
      if (payload && typeof payload === 'object' && payload.id != null) return `id:${payload.id}`;
      try {
        return JSON.stringify(payload);
      } catch (_) {
        return String(payload);
      }
    }

    async function drainApplies() {
      while (!disposed && pendingApplies.length) {
        const request = pendingApplies.shift();
        activeApply = request;
        try {
          const result = await applyPreset(request.payload);
          request.resolve(result);
        } catch (error) {
          if (disposed) request.resolve(undefined);
          else request.reject(error);
        } finally {
          appliesByKey.delete(request.key);
          activeApply = null;
        }
      }
      if (disposed) {
        while (pendingApplies.length) {
          const request = pendingApplies.shift();
          appliesByKey.delete(request.key);
          request.resolve(undefined);
        }
      }
      applyDrain = null;
    }

    function requestApply(payload) {
      if (disposed) return Promise.resolve(undefined);
      const key = applyKey(payload);
      const duplicate = appliesByKey.get(key);
      if (duplicate) return duplicate.promise;
      let resolveRequest;
      let rejectRequest;
      const promise = new Promise((resolve, reject) => {
        resolveRequest = resolve;
        rejectRequest = reject;
      });
      const request = {
        key,
        payload,
        promise,
        resolve: resolveRequest,
        reject: rejectRequest,
      };
      appliesByKey.set(key, request);
      pendingApplies.push(request);
      if (!applyDrain) applyDrain = drainApplies();
      return promise;
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      visible = false;
      previewEpoch += 1;
      clearIdleDisposal();
      if (creation) creation.cancelled = true;
      creation = null;
      activeRender = null;
      disposeViewerOnce(viewer);
      while (pendingApplies.length) {
        const request = pendingApplies.shift();
        appliesByKey.delete(request.key);
        request.resolve(undefined);
      }
    }

    return {
      requestPreview,
      requestApply,
      show,
      hide,
      dispose,
    };
  }

  root.BuretteMolstarPresetPreviewController = { create };
})(globalThis);
