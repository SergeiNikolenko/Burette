(function () {
  'use strict';

  function create(value, onChange, onCommit = () => {}) {
    const panel = document.createElement('div');
    panel.className = 'buret-color-picker';
    panel.setAttribute('popover', 'auto');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Custom colour');
    panel.innerHTML = `<div class="buret-color-picker-field" role="slider" tabindex="0" aria-label="Saturation and brightness" aria-valuemin="0" aria-valuemax="100"><span></span></div>
      <input class="buret-color-picker-hue" type="range" min="0" max="360" step="1" aria-label="Hue">
      <label class="buret-color-picker-hex"><span>HEX</span><input type="text" maxlength="7" spellcheck="false" aria-label="Hex colour"></label>`;
    const field = panel.querySelector('.buret-color-picker-field');
    const cursor = field.firstElementChild;
    const hue = panel.querySelector('input[type="range"]');
    const hex = panel.querySelector('input[type="text"]');
    let h = 0, s = 0, v = 1;
    function read(number) {
      const rgb = [number >> 16 & 255, number >> 8 & 255, number & 255].map(x => x / 255);
      const max = Math.max(...rgb), min = Math.min(...rgb), d = max - min;
      v = max; s = max ? d / max : 0;
      h = d === 0 ? 0 : max === rgb[0] ? ((rgb[1] - rgb[2]) / d + 6) % 6 * 60
        : max === rgb[1] ? ((rgb[2] - rgb[0]) / d + 2) * 60 : ((rgb[0] - rgb[1]) / d + 4) * 60;
    }
    function colour() {
      const channels = [5, 3, 1].map(n => {
        const k = (n + h / 60) % 6;
        return Math.round(255 * v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1))));
      });
      return (channels[0] << 16) | (channels[1] << 8) | channels[2];
    }
    function render() {
      field.style.backgroundColor = `hsl(${h} 100% 50%)`;
      cursor.style.left = `${s * 100}%`;
      cursor.style.top = `${(1 - v) * 100}%`;
      cursor.style.background = hex.value = '#' + colour().toString(16).padStart(6, '0');
      hue.value = String(h);
      field.setAttribute('aria-valuenow', String(Math.round(s * 100)));
      field.setAttribute('aria-valuetext', `Saturation ${Math.round(s * 100)}%, brightness ${Math.round(v * 100)}%`);
      hex.removeAttribute('aria-invalid');
    }
    const preview = () => onChange(colour());
    const commit = () => { preview(); onCommit(); };
    function point(event) {
      const rect = field.getBoundingClientRect();
      s = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      v = 1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
      render(); preview();
    }
    field.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); field.focus(); field.setPointerCapture(event.pointerId); point(event);
    });
    field.addEventListener('pointermove', event => { if (field.hasPointerCapture(event.pointerId)) point(event); });
    field.addEventListener('pointerup', event => {
      if (!field.hasPointerCapture(event.pointerId)) return;
      point(event); field.releasePointerCapture(event.pointerId); commit();
    });
    field.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      s = Math.max(0, Math.min(1, s + (event.key === 'ArrowRight' ? .01 : event.key === 'ArrowLeft' ? -.01 : 0)));
      v = Math.max(0, Math.min(1, v + (event.key === 'ArrowUp' ? .01 : event.key === 'ArrowDown' ? -.01 : 0)));
      render(); commit();
    });
    field.addEventListener('pointercancel', () => onCommit());
    panel.addEventListener('beforetoggle', event => { if (event.newState === 'closed') onCommit(); });
    hue.addEventListener('input', () => { h = Number(hue.value); render(); preview(); });
    hue.addEventListener('change', commit);
    hex.addEventListener('change', () => {
      if (!/^#?[\da-f]{6}$/i.test(hex.value)) { hex.setAttribute('aria-invalid', 'true'); return; }
      read(parseInt(hex.value.replace('#', ''), 16)); render(); commit();
    });
    hex.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); hex.dispatchEvent(new Event('change')); }
    });
    for (const name of ['pointerdown', 'pointermove', 'pointerup', 'click', 'keydown']) {
      panel.addEventListener(name, event => event.stopPropagation());
    }
    read(value); render();
    return panel;
  }
  window.BuretteColorPicker = { create };
})();
