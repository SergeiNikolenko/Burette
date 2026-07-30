(function (root) {
  'use strict';

  const DEFAULT_IDLE_DISPOSE_MS = 4000;

  function computePreviewPlacement(options) {
    const value = options || {};
    const viewportWidth = Math.max(1, Number(value.viewportWidth) || 1);
    const viewportHeight = Math.max(1, Number(value.viewportHeight) || 1);
    const margin = Math.max(0, Number(value.margin) || 0);
    const gap = Math.max(0, Number(value.gap) || 0);
    const minimumMenuHeight = Math.max(0, Number(value.minimumMenuHeight) || 0);
    const menuRect = value.menuRect || {};
    const itemRect = value.itemRect || {};
    const previewWidth = Math.min(Math.max(1, Number(value.previewWidth) || 1), Math.max(1, viewportWidth - margin * 2));
    const previewHeight = Math.min(Math.max(1, Number(value.previewHeight) || 1), Math.max(1, viewportHeight - margin * 2));
    const leftCandidate = Number(menuRect.left || 0) - gap - previewWidth;
    const rightCandidate = Number(menuRect.right || 0) + gap;
    const alignedTop = Math.max(margin, Math.min(Number(itemRect.top || 0) - 28, viewportHeight - margin - previewHeight));
    if (leftCandidate >= margin) {
      return { placement: 'left', left: leftCandidate, top: alignedTop };
    }
    if (rightCandidate + previewWidth <= viewportWidth - margin) {
      return { placement: 'right', left: rightCandidate, top: alignedTop };
    }
    const menuTop = margin + previewHeight + gap;
    const menuMaxHeight = viewportHeight - margin - menuTop;
    if (menuMaxHeight < minimumMenuHeight) return { placement: 'hidden' };
    return {
      placement: 'stacked',
      left: Math.max(margin, Math.min(viewportWidth - margin - previewWidth, Number(menuRect.left || 0))),
      top: margin,
      menuTop,
      menuMaxHeight,
    };
  }

  function computePreviewCanvasLayout(options) {
    const value = options || {};
    const margin = 12;
    const headerHeight = 28;
    const viewportWidth = Math.max(1, Number(value.viewportWidth) || 1);
    const viewportHeight = Math.max(1, Number(value.viewportHeight) || 1);
    const cropWidth = Math.max(1, Number(value.cropWidth) || 1);
    const cropHeight = Math.max(1, Number(value.cropHeight) || 1);
    const cardWidth = Math.min(240, Math.max(1, viewportWidth - margin * 2));
    const bodyHeight = Math.min(174, Math.max(120, viewportHeight - headerHeight - margin * 2));
    const padding = Math.min(10, cardWidth / 4, bodyHeight / 4);
    const availableWidth = Math.max(1, cardWidth - padding * 2);
    const availableHeight = Math.max(1, bodyHeight - padding * 2);
    const scale = Math.min(availableWidth / cropWidth, availableHeight / cropHeight);
    const drawWidth = cropWidth * scale;
    const drawHeight = cropHeight * scale;
    const backingScale = Math.min(
      2,
      Math.max(1, Number(value.devicePixelRatio) || 1),
      640 / Math.max(cardWidth, bodyHeight),
    );
    return {
      cardWidth,
      cardHeight: headerHeight + bodyHeight,
      bodyHeight,
      backingScale,
      drawX: (cardWidth - drawWidth) / 2,
      drawY: (bodyHeight - drawHeight) / 2,
      drawWidth,
      drawHeight,
    };
  }

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
    let pendingPreview = null;
    let previewDrain = null;
    let idleDisposeTimer = 0;
    const disposedViewers = new WeakSet();
    let pendingApply = null;
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

    function settle(request, method, value) {
      if (!request || request.settled) return;
      request.settled = true;
      request[method](value);
    }

    async function ensureViewer() {
      if (viewer) return viewer;
      if (creation) return creation;
      creation = Promise.resolve()
        .then(() => createViewer())
        .then((candidate) => {
          if (disposed || !candidate) {
            disposeViewerOnce(candidate);
            return null;
          }
          viewer = candidate;
          if (!visible) {
            safely(stopViewer, candidate);
            scheduleIdleDisposal();
          }
          return candidate;
        })
        .finally(() => {
          creation = null;
        });
      return creation;
    }

    async function drainPreviews() {
      while (!disposed && pendingPreview) {
        const request = pendingPreview;
        pendingPreview = null;
        let retainedViewer;
        try {
          retainedViewer = await ensureViewer();
          if (disposed || !retainedViewer) {
            settle(request, 'resolve', undefined);
            continue;
          }
          if (!visible) {
            scheduleIdleDisposal();
            settle(request, 'resolve', undefined);
            continue;
          }
          if (request.epoch !== previewEpoch) {
            settle(request, 'resolve', undefined);
            continue;
          }
          startRetainedViewer();
          const result = await renderPreview(retainedViewer, request.payload);
          if (disposed || request.epoch !== previewEpoch || viewer !== retainedViewer) {
            settle(request, 'resolve', undefined);
          } else {
            settle(request, 'resolve', result);
          }
        } catch (error) {
          if (disposed || request.epoch !== previewEpoch) settle(request, 'resolve', undefined);
          else settle(request, 'reject', error);
        } finally {
          if (stopAfterRender && viewer === retainedViewer) stopRetainedViewer();
        }
      }
      if (pendingPreview && disposed) {
        settle(pendingPreview, 'resolve', undefined);
        pendingPreview = null;
      }
      previewDrain = null;
    }

    function requestPreview(payload) {
      if (disposed) return Promise.resolve(undefined);
      const epoch = ++previewEpoch;
      clearIdleDisposal();
      if (pendingPreview) settle(pendingPreview, 'resolve', undefined);
      let resolveRequest;
      let rejectRequest;
      const promise = new Promise((resolve, reject) => {
        resolveRequest = resolve;
        rejectRequest = reject;
      });
      pendingPreview = {
        epoch,
        payload,
        promise,
        resolve: resolveRequest,
        reject: rejectRequest,
        settled: false,
      };
      if (!previewDrain) previewDrain = drainPreviews();
      return promise;
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
      while (!disposed && pendingApply) {
        const request = pendingApply;
        pendingApply = null;
        activeApply = request;
        try {
          const result = await applyPreset(request.payload);
          if (disposed || request.cancelled) settle(request, 'resolve', undefined);
          else settle(request, 'resolve', result);
        } catch (error) {
          if (disposed || request.cancelled) settle(request, 'resolve', undefined);
          else settle(request, 'reject', error);
        } finally {
          activeApply = null;
        }
      }
      if (pendingApply && disposed) {
        settle(pendingApply, 'resolve', undefined);
        pendingApply = null;
      }
      applyDrain = null;
    }

    function requestApply(payload) {
      if (disposed) return Promise.resolve(undefined);
      const key = applyKey(payload);
      if (pendingApply?.key === key) return pendingApply.promise;
      if (!pendingApply && activeApply?.key === key) return activeApply.promise;
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
        settled: false,
        cancelled: false,
      };
      if (pendingApply) settle(pendingApply, 'resolve', undefined);
      pendingApply = request;
      if (!applyDrain) applyDrain = drainApplies();
      return promise;
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      visible = false;
      previewEpoch += 1;
      clearIdleDisposal();
      if (pendingPreview) settle(pendingPreview, 'resolve', undefined);
      pendingPreview = null;
      disposeViewerOnce(viewer);
      if (activeApply) {
        activeApply.cancelled = true;
        settle(activeApply, 'resolve', undefined);
      }
      if (pendingApply) settle(pendingApply, 'resolve', undefined);
      pendingApply = null;
    }

    return {
      requestPreview,
      requestApply,
      show,
      hide,
      dispose,
    };
  }

  root.BuretteMolstarPresetPreviewController = {
    create,
    computePreviewPlacement,
    computePreviewCanvasLayout,
  };
})(globalThis);
