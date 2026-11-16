// Runs from <head>, before the first paint. A file rather than inline code, so
// the app's CSP (no inline scripts) admits the page in the desktop app.

// A host page shows the diagram alone. Hide the editor chrome and take the
// host's theme now, not after the scripts below have run.
(() => {
  const query = new URLSearchParams(location.search);
  const root = document.documentElement;
  const embedded = query.get('embed') === '1';
  root.classList.toggle('embed', embedded);
  root.classList.toggle('preview', embedded || query.get('preview') === '1');
  const theme = query.get('theme');
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
})();

// InteractionDrawer looks for SmilesDrawer at load; the diagrams never draw SMILES.
window.SmilesDrawer = { Drawer: function () {}, parse: function () {} };
