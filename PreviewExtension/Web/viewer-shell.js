(() => {
  'use strict';

  function mountToolbar() {
    if (document.getElementById('buret-toolbar')) return;
    const app = document.getElementById('app');
    if (!app) return;
    app.insertAdjacentHTML('afterend', `
      <div id="buret-toolbar" role="toolbar" aria-label="Burrete preview controls">
        <div class="buret-toolbar-content" data-buret-toolbar-content>
          <button class="buret-button buret-preview-dock-toggle" type="button" data-buret-dock-toggle="bottom" aria-label="Show bottom dock" title="Show bottom dock">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-13Zm2 0v10h12v-10a.5.5 0 0 0-.5-.5h-11a.5.5 0 0 0-.5.5Zm0 13a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5V17H6v1.5Z" fill="currentColor"/></svg>
            <span class="buret-tooltip" role="tooltip">Show bottom dock</span>
          </button>
          <button class="buret-button buret-preview-dock-toggle" type="button" data-buret-dock-toggle="right" aria-label="Show right dock" title="Show right dock">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 4A2.5 2.5 0 0 0 3 6.5v11A2.5 2.5 0 0 0 5.5 20h13a2.5 2.5 0 0 0 2.5-2.5v-11A2.5 2.5 0 0 0 18.5 4h-13ZM5 6.5a.5.5 0 0 1 .5-.5H15v12H5.5a.5.5 0 0 1-.5-.5v-11Zm12 11.5V6h1.5a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-.5.5H17Z" fill="currentColor"/></svg>
            <span class="buret-tooltip" role="tooltip">Show right dock</span>
          </button>
          <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="left" aria-label="Toggle left panel" title="Toggle left panel">L<span class="buret-tooltip" role="tooltip">Toggle Mol* left object tree</span></button>
          <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="right" aria-label="Toggle right panel" title="Toggle right panel">R<span class="buret-tooltip" role="tooltip">Toggle Mol* right properties panel</span></button>
          <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="sequence" aria-label="Toggle sequence panel" title="Toggle sequence panel">Seq<span class="buret-tooltip" role="tooltip">Toggle sequence panel</span></button>
          <div class="buret-molstar-style-slot" data-buret-molstar-style-slot>
            <select class="buret-select" data-buret-molstar-style aria-label="Mol* preview style" title="Mol* preview style"></select>
            <span class="buret-tooltip" role="tooltip">Choose Mol* representation style</span>
          </div>
          <button class="buret-button buret-molstar-lasso" type="button" data-buret-action="molstar-lasso" aria-label="Lasso select" aria-pressed="false" title="Lasso select">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.2 5.6c2.3-2 6.6-2.4 10.2-.8 3.5 1.6 5.4 4.6 4.5 7.3-.8 2.5-3.7 4.2-7.3 4.2-1.5 0-3-.3-4.3-.9l-2.6 3.2c-.4.5-1.2.2-1.2-.4l.2-4.1C2.5 12 2.6 7.8 5.2 5.6Zm1.3 1.5c-1.8 1.5-1.7 4.4.2 5.8.2.1.3.4.3.7l-.1 1.8 1.6-1.9c.3-.3.7-.4 1-.2 1 .6 2 .9 3.1.9 2.8 0 4.9-1.2 5.4-2.7.5-1.6-.8-3.6-3.5-4.8-2.9-1.3-6.4-1.1-8 .4Z" fill="currentColor"/></svg>
            <span class="buret-tooltip" role="tooltip">Lasso select visible atoms</span>
          </button>
          <button class="buret-button" type="button" data-buret-action="theme" aria-label="Switch to light theme" title="Switch to light theme">Light<span class="buret-tooltip" role="tooltip">Switch to light theme</span></button>
          <button class="buret-button buret-save-modified hidden" type="button" data-buret-action="save-modified-structure" aria-label="Save modified structure" title="Save modified structure">Save<span class="buret-tooltip" role="tooltip">Save modified Mol* structure</span></button>
          <button class="buret-button hidden" type="button" data-buret-action="ketcher" aria-label="Open in Ketcher" title="Open in Ketcher">Ketcher<span class="buret-tooltip" role="tooltip">Open this structure in Ketcher</span></button>
          <div class="buret-xyzrender-preset-slot" data-buret-xyzrender-preset-slot>
            <select class="buret-select" data-buret-xyzrender-preset aria-label="External xyzrender preset" title="External xyzrender preset"></select>
            <span class="buret-tooltip" role="tooltip">Choose xyzrender preset</span>
          </div>
          <button class="buret-button buret-xyzrender-tune hidden" type="button" data-buret-action="xyzrender-tune" aria-label="Tune xyzrender" title="Tune xyzrender">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H4v2h6V5Zm10 0h-6v2h6V5ZM14 11H4v2h10v-2Zm6 0h-2v2h2v-2ZM8 17H4v2h4v-2Zm12 0h-8v2h8v-2Z" fill="currentColor"/></svg>
            <span class="buret-tooltip" role="tooltip">Open xyzrender controls</span>
          </button>
          <button class="buret-button hidden" type="button" data-buret-action="sdf-grid" aria-label="Show SDF grid" title="Show SDF grid">Grid<span class="buret-tooltip" role="tooltip">Return to the SDF grid</span></button>
          <button class="buret-button buret-pose-toggle hidden" type="button" data-buret-action="sdf-poses" aria-label="Show all SDF poses together" aria-pressed="false" title="Show all SDF poses together">All<span class="buret-tooltip" role="tooltip">Show all SDF poses together</span></button>
          <div class="buret-renderer-control" data-buret-renderer-control>
            <button class="buret-button buret-renderer-choice" type="button" data-buret-renderer="molstar" aria-label="Use Mol* Interactive" title="Use Mol* Interactive">Mol*<span class="buret-tooltip" role="tooltip">Use interactive Mol* viewer</span></button>
            <button class="buret-button buret-renderer-choice" type="button" data-buret-renderer="xyzrender-external" aria-label="Use external xyzrender" title="Use external xyzrender">xyzr<span class="buret-tooltip" role="tooltip">Use external xyzrender SVG</span></button>
          </div>
        </div>
        <button class="buret-button buret-grip" type="button" data-drag-handle aria-label="Collapse controls" aria-expanded="true" title="Collapse controls">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h2v2H8V5Zm6 0h2v2h-2V5ZM8 11h2v2H8v-2Zm6 0h2v2h-2v-2ZM8 17h2v2H8v-2Zm6 0h2v2h-2v-2Z" fill="currentColor"/></svg>
          <span class="buret-tooltip" role="tooltip">Drag or collapse controls</span>
        </button>
          <div class="buret-xyzrender-popover hidden" data-buret-xyzrender-popover role="dialog" aria-label="xyzrender controls">
            <div class="buret-xyzrender-popover-header">
              <div class="buret-xyzrender-popover-title">xyzrender</div>
              <button class="buret-button buret-xyzrender-header-action" type="button" data-buret-action="xyzrender-reset-orientation" aria-label="Reset xyzrender 3D view" title="Reset xyzrender 3D view">Reset 3D<span class="buret-tooltip" role="tooltip">Reset xyzrender 3D view</span></button>
              <button class="buret-button buret-xyzrender-header-action" type="button" data-buret-action="xyzrender-reset" aria-label="Reset xyzrender controls" title="Reset xyzrender controls">Reset<span class="buret-tooltip" role="tooltip">Reset xyzrender controls</span></button>
            </div>
            <div class="buret-xyzrender-section buret-xyzrender-section-flags">
              <div class="buret-flag-list">
                <label class="buret-flag-row">
                  <span class="buret-flag-copy"><span class="buret-flag-label">Transparent</span></span>
                  <input type="checkbox" data-buret-xctrl="transparentBackground" />
                </label>
                <label class="buret-flag-row">
                  <span class="buret-flag-copy"><span class="buret-flag-label">Gradients</span></span>
                  <select class="buret-input" data-buret-xctrl="gradients"><option value="">Default</option><option value="on">On</option><option value="off">Off</option></select>
                </label>
                <label class="buret-flag-row">
                  <span class="buret-flag-copy"><span class="buret-flag-label">Fog</span></span>
                  <select class="buret-input" data-buret-xctrl="fog"><option value="">Default</option><option value="on">On</option><option value="off">Off</option></select>
                </label>
                <label class="buret-flag-row">
                  <span class="buret-flag-copy"><span class="buret-flag-label">VdW</span></span>
                  <input type="checkbox" data-buret-xctrl="showVdw" />
                </label>
                <label class="buret-flag-row">
                  <span class="buret-flag-copy"><span class="buret-flag-label">Hide bonds</span></span>
                  <input type="checkbox" data-buret-xctrl="hideBonds" />
                </label>
              </div>
            </div>
          <details class="buret-xyzrender-advanced buret-xyzrender-crystal hidden" data-buret-xyzrender-crystal>
            <summary>Crystal</summary>
            <div class="buret-xyzrender-section buret-xyzrender-section-advanced">
              <div class="buret-flag-list">
                <label class="buret-flag-row">
                  <span class="buret-flag-copy"><span class="buret-flag-label">Cell</span></span>
                  <select class="buret-input" data-buret-xctrl="showCell"><option value="">Default</option><option value="on">On</option><option value="off">Off</option></select>
                </label>
                <label class="buret-flag-row">
                  <span class="buret-flag-copy"><span class="buret-flag-label">Ghosts</span></span>
                  <select class="buret-input" data-buret-xctrl="showGhosts"><option value="">Default</option><option value="on">On</option><option value="off">Off</option></select>
                </label>
                <label class="buret-flag-row">
                  <span class="buret-flag-copy"><span class="buret-flag-label">Axes</span></span>
                  <select class="buret-input" data-buret-xctrl="showAxes"><option value="">Default</option><option value="on">On</option><option value="off">Off</option></select>
                </label>
                <label class="buret-flag-row">
                  <span class="buret-flag-copy"><span class="buret-flag-label">Supercell</span></span>
                  <input class="buret-input" type="text" placeholder="2 2 1" data-buret-xctrl="supercell" />
                </label>
              </div>
            </div>
          </details>
          <details class="buret-xyzrender-advanced" data-buret-xyzrender-field>
            <summary>Field overlay</summary>
            <div class="buret-xyzrender-section buret-xyzrender-section-advanced">
              <div class="buret-field-grid">
                <label class="buret-field"><span>Mode</span><select class="buret-input" data-buret-xctrl="fieldMode"><option value="">Auto</option><option value="off">Off</option><option value="density">Density</option><option value="mo">MO</option><option value="esp">ESP</option><option value="nci">NCI</option></select></label>
                <label class="buret-field"><span>Iso</span><span class="buret-slider-row"><input class="buret-slider" type="range" min="0.01" max="2" step="0.01" value="0.3" data-buret-xctrl-slider="fieldIso" /><input class="buret-input buret-slider-value" type="number" min="0.01" step="0.01" placeholder="auto" data-buret-xctrl="fieldIso" /></span></label>
                <label class="buret-field"><span>Opacity</span><span class="buret-slider-row"><input class="buret-slider" type="range" min="0" max="1" step="0.01" value="0.5" data-buret-xctrl-slider="fieldOpacity" /><input class="buret-input buret-slider-value" type="number" min="0" max="1" step="0.01" placeholder="auto" data-buret-xctrl="fieldOpacity" /></span></label>
                <label class="buret-field"><span>Surface</span><select class="buret-input" data-buret-xctrl="fieldSurfaceStyle"><option value="">Auto</option><option value="solid">Solid</option><option value="mesh">Mesh</option><option value="contour">Contour</option><option value="dot">Dot</option></select></label>
                <label class="buret-field"><span>MO + color</span><input class="buret-input" type="text" placeholder="steelblue" data-buret-xctrl="fieldMoPositiveColor" /></label>
                <label class="buret-field"><span>MO - color</span><input class="buret-input" type="text" placeholder="maroon" data-buret-xctrl="fieldMoNegativeColor" /></label>
                <label class="buret-field"><span>Density color</span><input class="buret-input" type="text" placeholder="steelblue" data-buret-xctrl="fieldDensityColor" /></label>
                <label class="buret-field"><span>Palette</span><input class="buret-input" type="text" placeholder="viridis" data-buret-xctrl="fieldCmapPalette" /></label>
                <label class="buret-field"><span>Range min</span><span class="buret-slider-row"><input class="buret-slider" type="range" min="-5" max="5" step="0.05" value="-1" data-buret-xctrl-slider="fieldCmapMin" /><input class="buret-input buret-slider-value" type="number" step="0.05" placeholder="auto" data-buret-xctrl="fieldCmapMin" /></span></label>
                <label class="buret-field"><span>Range max</span><span class="buret-slider-row"><input class="buret-slider" type="range" min="-5" max="5" step="0.05" value="1" data-buret-xctrl-slider="fieldCmapMax" /><input class="buret-input buret-slider-value" type="number" step="0.05" placeholder="auto" data-buret-xctrl="fieldCmapMax" /></span></label>
              </div>
            </div>
          </details>
          <details class="buret-xyzrender-advanced" data-buret-xyzrender-appearance>
            <summary>Appearance</summary>
            <div class="buret-xyzrender-section buret-xyzrender-section-advanced">
              <div class="buret-field-grid">
                <label class="buret-field"><span>Atom scale</span><input class="buret-input" type="number" min="0" step="0.05" data-buret-xctrl="atomScale" /></label>
                <label class="buret-field"><span>Bond width</span><input class="buret-input" type="number" min="0" step="0.1" data-buret-xctrl="bondWidth" /></label>
                <label class="buret-field"><span>VdW scale</span><input class="buret-input" type="number" min="0" step="0.05" data-buret-xctrl="vdwScale" /></label>
                <label class="buret-field buret-field-full"><span>Mol color</span><input class="buret-input" type="text" placeholder="#rrggbb or name" data-buret-xctrl="molColor" /></label>
              </div>
            </div>
          </details>
        </div>
      </div>
      <div id="buret-viewport-corner" class="buret-viewport-corner">
        <button id="buret-scene-tree-toggle" class="buret-corner-toggle hidden" type="button" data-buret-action="scene-tree" aria-label="Toggle scene tree" aria-haspopup="dialog" aria-controls="buret-scene-tree" aria-expanded="false" title="Scene tree">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/></svg>
          <span class="buret-tooltip" role="tooltip">Scene tree</span>
        </button>
        <button id="buret-sequence-toggle" class="buret-corner-toggle hidden" type="button" data-buret-action="sequence-panel" aria-label="Toggle sequence" aria-haspopup="dialog" aria-controls="buret-sequence" aria-expanded="false" title="Sequence">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 6H3"/><path d="M15 12H3"/><path d="M17 18H3"/></svg>
          <span class="buret-tooltip" role="tooltip">Sequence</span>
        </button>
      </div>
      <aside id="buret-scene-tree" class="buret-scene-tree hidden" data-buret-scene-tree role="dialog" aria-label="Scene tree" aria-hidden="true">
        <div class="buret-scene-tree-header" data-buret-panel-handle>
          <span class="buret-scene-tree-title">Scene</span>
          <button class="buret-scene-tree-header-action" type="button" data-buret-action="scene-tree-close" aria-label="Close scene tree" title="Close scene tree">
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="buret-scene-tree-body" data-buret-scene-tree-body></div>
      </aside>
      <aside id="buret-sequence" class="buret-sequence hidden" data-buret-sequence role="dialog" aria-label="Sequence" aria-hidden="true">
        <div class="buret-scene-tree-header" data-buret-panel-handle>
          <span class="buret-scene-tree-title">Sequence</span>
          <span class="buret-sequence-chains" data-buret-sequence-chains></span>
          <button class="buret-scene-tree-header-action" type="button" data-buret-action="sequence-close" aria-label="Close sequence" title="Close sequence">
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="buret-sequence-body" data-buret-sequence-body></div>
      </aside>
      <button id="buret-compute-menu-trigger" class="buret-generate-3d-control hidden" type="button" data-buret-action="generate-3d-conformer" aria-label="Open molecular compute menu" aria-haspopup="menu" aria-controls="buret-compute-menu" aria-expanded="false">
        <span data-buret-generate-3d-label>Compute</span>
        <span class="buret-tooltip" role="tooltip">Native molecular compute</span>
      </button>
      <div id="buret-compute-menu" class="buret-generate-3d-menu hidden" data-buret-generate-3d-menu role="menu" aria-labelledby="buret-compute-menu-trigger" aria-orientation="vertical">
        <button type="button" role="menuitem" data-buret-compute-operation="generate3d">Generate 3D</button>
        <button type="button" role="menuitem" data-buret-compute-operation="generateEnsemble">Generate conformer ensemble</button>
        <button type="button" role="menuitem" data-buret-compute-operation="optimizeGeometry">Optimize geometry</button>
        <button type="button" role="menuitem" data-buret-compute-operation="semiempiricalRm1">RM1 energy &amp; charges</button>
        <button type="button" role="menuitem" data-buret-compute-operation="alignPoses">Align &amp; compare poses</button>
      </div>
      <aside class="buret-preview-dock buret-preview-dock-right" data-buret-preview-dock="right" aria-label="Right dock" aria-hidden="true"></aside>
      <section class="buret-preview-dock buret-preview-dock-bottom" data-buret-preview-dock="bottom" aria-label="Bottom dock" aria-hidden="true"></section>
    `);
    if (window.__BURRETE_HOSTED_MCP_WIDGET__ === true) {
      const toolbar = document.getElementById('buret-toolbar');
      const grip = toolbar?.querySelector('[data-drag-handle]');
      if (toolbar && grip) {
        toolbar.classList.add('collapsed');
        document.body?.classList.add('buret-toolbar-collapsed');
        grip.setAttribute('aria-expanded', 'false');
        grip.setAttribute('aria-label', 'Expand controls');
        grip.setAttribute('title', 'Expand controls');
        const fallbackGripClick = event => {
          event.preventDefault();
          event.stopPropagation();
          const collapsed = !toolbar.classList.contains('collapsed');
          toolbar.classList.toggle('collapsed', collapsed);
          document.body?.classList.toggle('buret-toolbar-collapsed', collapsed);
          grip.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
          grip.setAttribute('aria-label', collapsed ? 'Expand controls' : 'Collapse controls');
          grip.setAttribute('title', collapsed ? 'Expand controls' : 'Collapse controls');
        };
        window.__BURRETE_HOSTED_GRIP_FALLBACK__ = fallbackGripClick;
        grip.addEventListener('click', fallbackGripClick);
      }
    }
  }

  window.BurreteViewerShell = { mountToolbar };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountToolbar, { once: true });
  } else {
    mountToolbar();
  }
})();
