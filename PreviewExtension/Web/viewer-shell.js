(() => {
  'use strict';

  function mountToolbar() {
    if (document.getElementById('buret-toolbar')) return;
    const app = document.getElementById('app');
    if (!app) return;
    app.insertAdjacentHTML('afterend', `
      <div id="buret-toolbar" role="toolbar" aria-label="Burrete preview controls">
        <div class="buret-toolbar-content" data-buret-toolbar-content>
          <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="left" aria-label="Toggle left panel" title="Toggle left panel">L</button>
          <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="right" aria-label="Toggle right panel" title="Toggle right panel">R</button>
          <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="sequence" aria-label="Toggle sequence panel" title="Toggle sequence panel">Seq</button>
          <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="log" aria-label="Toggle log panel" title="Toggle log panel">Log</button>
          <button class="buret-button" type="button" data-buret-action="theme" aria-label="Switch to light theme" title="Switch to light theme">Light</button>
          <button class="buret-button" type="button" data-buret-action="open-burrete" aria-label="Open in Burrete" title="Open in Burrete">Open</button>
          <div class="buret-xyzrender-preset-slot" data-buret-xyzrender-preset-slot>
            <select class="buret-select" data-buret-xyzrender-preset aria-label="External xyzrender preset" title="External xyzrender preset"></select>
          </div>
          <div class="buret-renderer-control" data-buret-renderer-control>
            <button class="buret-button buret-renderer-choice" type="button" data-buret-renderer="xyz-fast" aria-label="Use Fast XYZ SVG" title="Use Fast XYZ SVG">Fast</button>
            <button class="buret-button buret-renderer-choice" type="button" data-buret-renderer="molstar" aria-label="Use Mol* Interactive" title="Use Mol* Interactive">Mol*</button>
            <button class="buret-button buret-renderer-choice" type="button" data-buret-renderer="xyzrender-external" aria-label="Use external xyzrender" title="Use external xyzrender">xyzr</button>
          </div>
        </div>
        <button class="buret-button buret-grip" type="button" data-drag-handle aria-label="Collapse controls" aria-expanded="true" title="Collapse controls">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h2v2H8V5Zm6 0h2v2h-2V5ZM8 11h2v2H8v-2Zm6 0h2v2h-2v-2ZM8 17h2v2H8v-2Zm6 0h2v2h-2v-2Z" fill="currentColor"/></svg>
        </button>
      </div>
    `);
  }

  window.BurreteViewerShell = { mountToolbar };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountToolbar, { once: true });
  } else {
    mountToolbar();
  }
})();
