(() => {
  'use strict';

  const readJson = (id) => {
    const element = document.getElementById(id);
    if (!element) return null;
    try { return JSON.parse(element.textContent || 'null'); } catch (_) { return null; }
  };
  const postToParent = (body) => {
    if (window.BuretteConfig && window.BuretteConfig.documentId) {
      body.documentId = String(window.BuretteConfig.documentId);
    }
    if (window.parent && window.parent !== window) {
      try { window.parent.postMessage({ source: 'burette-viewer', body }, '*'); } catch (_) {}
    }
  };
  const nativeHandler = window.webkit?.messageHandlers?.burette;
  const buretteHandler = nativeHandler && typeof nativeHandler.postMessage === 'function'
    ? nativeHandler
    : { postMessage: postToParent };
  window.__mqlPost = (type, message, payload) => postToParent({ type, message: message || '', ...(payload || {}) });
  window.__mqlAction = (name) => buretteHandler.postMessage({ type: 'action', message: name });
  window.__mqlDebug = () => {};
  window.BuretteInlineMode = true;
  window.BuretteDebug = false;
  window.BurettePanelControlsVisible = false;
  window.BuretteCacheBuster = String(Date.now());
  window.BuretteConfig = readJson('burette-runtime-config') || {};
  window.BuretteDataBase64 = readJson('burette-runtime-data') || '';
})();
