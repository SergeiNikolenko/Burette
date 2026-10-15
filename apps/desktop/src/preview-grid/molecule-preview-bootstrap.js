// External bootstrap: srcdoc inherits the application's strict script CSP.
(() => {
  const input = JSON.parse(document.getElementById('burette-inspector-input').textContent);
  window.BuretteConfig = input.config;
  window.BuretteDataBase64 = input.data;
  let errors = 0;
  const report = message => {
    if (errors++ < 10) window.parent.postMessage({ source: 'burette-inspector-error', message: String(message).slice(0, 1024) }, '*');
  };
  const originalError = console.error.bind(console);
  console.error = (...parts) => {
    originalError(...parts);
    report(parts.map(part => part?.message || String(part)).join(' '));
  };
  window.addEventListener('error', event => report(event.message || 'Preview asset could not load'), true);
  window.addEventListener('unhandledrejection', event => report(event.reason?.message || event.reason));
  let start;
  document.addEventListener('pointerdown', event => {
    start = event.target instanceof HTMLCanvasElement && event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
  }, true);
  document.addEventListener('pointerup', event => {
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4) window.parent.postMessage({ source: 'burette-inspector-open' }, '*');
    start = null;
  }, true);
  document.addEventListener('pointercancel', () => { start = null; });
})();
