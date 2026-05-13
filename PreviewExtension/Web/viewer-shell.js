(() => {
  'use strict';

  function mountToolbar() {
    if (document.getElementById('buret-toolbar')) return;
    const app = document.getElementById('app');
    if (!app) return;
    app.insertAdjacentHTML('afterend', `
      <div id="buret-toolbar" role="toolbar" aria-label="Burrete preview controls">
        <button class="buret-button buret-grip" type="button" data-drag-handle aria-label="Expand controls" aria-expanded="false" title="Expand controls"><span aria-hidden="true">⋯</span></button>
        <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="left" aria-label="Toggle left panel" title="Toggle left panel"><span aria-hidden="true">◧</span></button>
        <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="right" aria-label="Toggle right panel" title="Toggle right panel"><span aria-hidden="true">◨</span></button>
        <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="sequence" aria-label="Toggle sequence panel" title="Toggle sequence panel"><span aria-hidden="true">≡</span></button>
        <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="log" aria-label="Toggle log panel" title="Toggle log panel"><span aria-hidden="true">⌘</span></button>
        <button class="buret-button" type="button" data-buret-action="theme" aria-label="Switch to light theme" title="Switch to light theme"><span aria-hidden="true">☀</span></button>
        <button class="buret-button hidden" type="button" data-buret-action="open-vesta" aria-label="Open in VESTA" title="Open in VESTA"><span aria-hidden="true">↗</span></button>
        <div class="buret-renderer-control" data-buret-renderer-control>
          <button class="buret-button buret-renderer-choice" type="button" data-buret-renderer="xyz-fast" aria-label="Use Fast XYZ SVG" title="Use Fast XYZ SVG">Fast</button>
          <button class="buret-button buret-renderer-choice" type="button" data-buret-renderer="molstar" aria-label="Use Mol* Interactive" title="Use Mol* Interactive">Mol*</button>
          <button class="buret-button buret-renderer-choice" type="button" data-buret-renderer="xyzrender-external" aria-label="Use external xyzrender" title="Use external xyzrender">xyzr</button>
          <select class="buret-select" data-buret-xyzrender-preset aria-label="External xyzrender preset" title="External xyzrender preset"></select>
        </div>
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
