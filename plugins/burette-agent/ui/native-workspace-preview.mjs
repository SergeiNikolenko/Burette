import { installWorkspaceTooltipLayout } from './native-workspace-tooltip-layout.mjs';

// Keep Burette's existing iframe runtime and script order. Resource resolution
// is provided by the owning MCP component, not by a loopback web server.
function startPreview(installTooltipLayout) {
  const bridge = window.parent.BuretteMcpWorkspace;
  window.__BURETTE_HOSTED_MCP_WIDGET__ = true;
  document.body.dataset.buretteNativeUi = 'true';
  window.fetch = bridge.fetch;
  window.Worker = bridge.Worker;
  window.BuretteNativeFirstFrame = async viewer => {
    const canvas = viewer.plugin.canvas3d;
    await new Promise((resolve, reject) => {
      let subscription;
      let armed = false;
      const previous = canvas.notifyDidDraw;
      const finish = error => {
        clearTimeout(timeout);
        subscription?.unsubscribe();
        canvas.notifyDidDraw = previous;
        error ? reject(error) : resolve();
      };
      const timeout = setTimeout(() => finish(new Error('The molecular scene did not finish rendering.')), 45000);
      canvas.notifyDidDraw = true;
      subscription = canvas.didDraw.subscribe(() => {
        if (armed && !canvas.commitQueueSize.value && !canvas.camera.transition.inTransition) finish();
      });
      armed = true;
      canvas.requestDraw();
    });
  };
  window.BuretteNativeSceneReady = () => bridge.firstFrame(window.BuretteConfig?.documentId);
  // Lazy scripts (not just initial HTML tags) must use the offline transport.
  window.BuretteResolveRuntimeAsset = path => bridge.asset(bridge.resolve(path, 'runtime/viewer.js'));
  window.BuretteRDKitWasmURL = '/__burette/rdkit-wasm';
  const themeStyle = document.createElement('style');
  // Only host behavior belongs here. Icons, hints, shadows and menu tokens are
  // supplied by the shared viewer source selected by the build's --app-root.
  themeStyle.textContent = '[data-buret-action="theme"] { display: none !important; }';
  document.head.appendChild(themeStyle);
  const disposeTooltipLayout = installTooltipLayout();
  const syncTheme = () => {
    if (window.BuretteConfig) window.BuretteConfig.theme = bridge.theme;
    window.postMessage({ source: 'burette-host', body: { type: 'setViewerTheme', value: bridge.theme } }, '*');
  };
  window.parent.addEventListener('burette-host-theme', syncTheme);
  const scripts = [...document.querySelectorAll('script[data-burette-script]')];
  const links = [...document.querySelectorAll('link[data-burette-style]')];
  // Fetch independent resources together, but execute classic scripts in their
  // original order. The shared asset transport bounds native chunk reads to 4.
  const paths = new Set([...links.map(link => link.dataset.buretteStyle), ...scripts.map(script => script.dataset.buretteScript)].filter(Boolean));
  const resources = new Map([...paths].map(path => [path,
    bridge.asset(bridge.resolve(path, 'runtime/viewer.js')).then(url => ({ url }), error => ({ error })),
  ]));
  const resource = async path => {
    const result = await resources.get(path);
    if (result.error) throw result.error;
    return result.url;
  };
  const load = element => new Promise((resolve, reject) => {
    element.onload = resolve;
    element.onerror = () => reject(new Error(`Could not load ${element.dataset.asset || 'preview runtime'}`));
    document.head.appendChild(element);
  });
  void (async () => {
    for (const old of links) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `${await resource(old.dataset.buretteStyle)}#${old.dataset.buretteStyle.split('/').pop()}`;
      await load(link);
      old.remove();
    }
    syncTheme();
    for (const old of scripts) {
      if (bridge.closed) return;
      const script = document.createElement('script');
      const path = old.dataset.buretteScript;
      let temporary;
      script.dataset.asset = path;
      if (path) script.src = await resource(path);
      else script.src = temporary = URL.createObjectURL(new Blob([old.textContent], { type: 'text/javascript' }));
      try { await load(script); } finally { if (temporary) URL.revokeObjectURL(temporary); }
      old.remove();
    }
    syncTheme();
  })().catch(error => {
    const status = document.getElementById('status');
    if (status) { status.hidden = false; status.classList.remove('hidden'); status.textContent = error.message; }
    window.parent.postMessage({ source: 'burette-viewer', body: { type: 'error', message: error.message, documentId: window.BuretteConfig?.documentId } }, '*');
  });
  window.addEventListener('pagehide', () => {
    disposeTooltipLayout();
    window.parent.removeEventListener('burette-host-theme', syncTheme);
    void window.BuretteViewerActions?.run({ type: 'dispose_viewer' });
  });
}

export function prepareWorkspacePreview(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const config = doc.getElementById('burette-runtime-config');
  if (config) {
    config.textContent = JSON.stringify({ ...JSON.parse(config.textContent), autoFocusStructure: true, defaultToolbarCollapsed: true, hostedMcpWidgetBootstrap: true }).replaceAll('<', '\\u003c');
  }
  doc.querySelectorAll('base').forEach(element => element.remove());
  for (const script of doc.querySelectorAll('script')) {
    // JSON data islands must remain available to viewer-bootstrap.js.
    if (script.type && !['text/javascript', 'application/javascript', 'module'].includes(script.type)) continue;
    script.dataset.buretteScript = script.getAttribute('src') || '';
    script.removeAttribute('src');
    script.type = 'application/burette-pending';
  }
  for (const link of doc.querySelectorAll('link[rel="stylesheet"]')) {
    link.dataset.buretteStyle = link.getAttribute('href');
    link.removeAttribute('href');
  }
  const bootstrap = doc.createElement('script');
  bootstrap.textContent = `(${startPreview.toString()})(${installWorkspaceTooltipLayout.toString()});`;
  doc.body.appendChild(bootstrap);
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
