(() => {
  'use strict';

  const readJson = (id) => {
    const element = document.getElementById(id);
    if (!element) return null;
    try { return JSON.parse(element.textContent || 'null'); } catch (_) { return null; }
  };
  const postToParent = (body) => {
    if (window.BurreteConfig && window.BurreteConfig.documentId) {
      body.documentId = String(window.BurreteConfig.documentId);
    }
    if (window.parent && window.parent !== window) {
      try { window.parent.postMessage({ source: 'burrete-viewer', body }, '*'); } catch (_) {}
    }
  };
  const webkit = window.webkit || {};
  const messageHandlers = webkit.messageHandlers || {};
  if (!messageHandlers.burrete) {
    messageHandlers.burrete = { postMessage: postToParent };
  }
  webkit.messageHandlers = messageHandlers;
  window.webkit = webkit;
  window.__mqlPost = (type, message, payload) => postToParent({ type, message: message || '', ...(payload || {}) });
  window.__mqlAction = (name) => messageHandlers.burrete.postMessage({ type: 'action', message: name });
  window.__mqlDebug = () => {};
  window.BurreteInlineMode = true;
  window.BurreteDebug = false;
  window.BurretePanelControlsVisible = false;
  window.BurreteCacheBuster = String(Date.now());
  window.BurreteConfig = readJson('burrete-runtime-config') || {};
  window.BurreteDataBase64 = readJson('burrete-runtime-data') || '';
})();
