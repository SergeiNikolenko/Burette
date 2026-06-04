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
          <button class="buret-button hidden" type="button" data-buret-action="ketcher" aria-label="Open in Ketcher" title="Open in Ketcher">Ketcher</button>
          <div class="buret-xyzrender-preset-slot" data-buret-xyzrender-preset-slot>
            <select class="buret-select" data-buret-xyzrender-preset aria-label="External xyzrender preset" title="External xyzrender preset"></select>
          </div>
          <button class="buret-button buret-xyzrender-tune hidden" type="button" data-buret-action="xyzrender-tune" aria-label="Tune xyzrender" title="Tune xyzrender">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H4v2h6V5Zm10 0h-6v2h6V5ZM14 11H4v2h10v-2Zm6 0h-2v2h2v-2ZM8 17H4v2h4v-2Zm12 0h-8v2h8v-2Z" fill="currentColor"/></svg>
          </button>
          <button class="buret-button hidden" type="button" data-buret-action="sdf-grid" aria-label="Show SDF grid" title="Show SDF grid">Grid</button>
          <div class="buret-renderer-control" data-buret-renderer-control>
            <button class="buret-button buret-renderer-choice" type="button" data-buret-renderer="molstar" aria-label="Use Mol* Interactive" title="Use Mol* Interactive">Mol*</button>
            <button class="buret-button buret-renderer-choice" type="button" data-buret-renderer="xyzrender-external" aria-label="Use external xyzrender" title="Use external xyzrender">xyzr</button>
          </div>
        </div>
        <button class="buret-button buret-grip" type="button" data-drag-handle aria-label="Collapse controls" aria-expanded="true" title="Collapse controls">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h2v2H8V5Zm6 0h2v2h-2V5ZM8 11h2v2H8v-2Zm6 0h2v2h-2v-2ZM8 17h2v2H8v-2Zm6 0h2v2h-2v-2Z" fill="currentColor"/></svg>
        </button>
          <div class="buret-xyzrender-popover hidden" data-buret-xyzrender-popover role="dialog" aria-label="xyzrender controls">
            <div class="buret-xyzrender-popover-header">
              <div class="buret-xyzrender-popover-title">xyzrender</div>
              <button class="buret-button buret-xyzrender-header-action" type="button" data-buret-action="xyzrender-reset">Reset</button>
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
    `);
  }

  window.BurreteViewerShell = { mountToolbar };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountToolbar, { once: true });
  } else {
    mountToolbar();
  }
})();
