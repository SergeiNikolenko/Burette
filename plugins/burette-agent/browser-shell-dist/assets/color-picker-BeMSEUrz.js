(function () {
  'use strict';

  const families = [
    [0xd1c9e3, 0xa48abd, 0x705c91], [0xbcd2e7, 0x7ca5c5, 0x497699],
    [0xb3d6d7, 0x72a7a6, 0x467c7d], [0xc7d6be, 0x90ab80, 0x637d55],
    [0xe3dabb, 0xbcad78, 0x92834c], [0xe4cbbb, 0xc7997d, 0x936c54],
    [0xdfc2d0, 0xb78ba2, 0x8e5f77], [0xdedfe0, 0xa7aaab, 0x6d7274],
  ];
  const blend = (a, b) => [16, 8, 0].reduce((value, shift) =>
    value | Math.round(((a >> shift & 255) + (b >> shift & 255)) / 2) << shift, 0);
  const shades = [0, 1, 2, 3, 4].flatMap(row => families.map(([light, middle, dark]) =>
    [light, blend(light, middle), middle, blend(middle, dark), dark][row]));

  // Exact qualitative lists from Mol* mol-util/color/lists (ColorBrewer / D3).
  const palettes = [
    { label: 'Shades', colors: shades },
    { label: 'Tableau-10', colors: [0x4e79a7, 0xf28e2c, 0xe15759, 0x76b7b2, 0x59a14f, 0xedc949, 0xaf7aa1, 0xff9da7, 0x9c755f, 0xbab0ab] },
    { label: 'Pastel-1', colors: [0xfbb4ae, 0xb3cde3, 0xccebc5, 0xdecbe4, 0xfed9a6, 0xffffcc, 0xe5d8bd, 0xfddaec, 0xf2f2f2] },
    { label: 'Many-Distinct', colors: [0x1b9e77, 0xd95f02, 0x7570b3, 0xe7298a, 0x66a61e, 0xe6ab02, 0xa6761d, 0x666666,
      0xe41a1c, 0x377eb8, 0x4daf4a, 0x984ea3, 0xff7f00, 0xffff33, 0xa65628, 0xf781bf, 0x999999,
      0x66c2a5, 0xfc8d62, 0x8da0cb, 0xe78ac3, 0xa6d854, 0xffd92f, 0xe5c494, 0xb3b3b3] },
  ];
  const presets = [...new Set(palettes.flatMap(palette => palette.colors))]
    .map(value => ({ label: '#' + value.toString(16).padStart(6, '0'), value }));

  function create(value, onChange, onCommit = () => {}) {
    const panel = document.createElement('div');
    panel.className = 'buret-color-picker';
    panel.hidden = true;
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', 'Colour palette');
    panel.innerHTML = `<label class="buret-color-picker-title">Shades<select aria-label="Colour palette preset"></select></label>
      <div class="buret-color-picker-grid" role="group" aria-label="Colour shades"></div>
      <label class="buret-color-picker-hex"><span>HEX</span><input type="text" maxlength="7" spellcheck="false" aria-label="Hex colour"></label>`;
    const grid = panel.querySelector('.buret-color-picker-grid');
    const hex = panel.querySelector('input');
    let buttons = [];
    const select = panel.querySelector('select');
    palettes.forEach((palette, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = palette.label;
      select.appendChild(option);
    });
    function render() {
      hex.value = '#' + value.toString(16).padStart(6, '0');
      hex.removeAttribute('aria-invalid');
      for (const button of buttons) button.setAttribute('aria-pressed', String(Number(button.dataset.color) === value));
    }
    function choose(next) {
      value = next;
      render();
      onChange(value);
      onCommit();
    }
    function renderPalette() {
      grid.replaceChildren();
      grid.style.gridTemplateColumns = `repeat(${select.value === '0' ? 8 : 5}, minmax(0, 1fr))`;
      buttons = [];
      for (const colour of palettes[Number(select.value) || 0].colors) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'buret-color-picker-shade';
        button.dataset.color = String(colour);
        button.style.background = '#' + colour.toString(16).padStart(6, '0');
        button.title = button.style.background;
        button.setAttribute('aria-label', '#' + colour.toString(16).padStart(6, '0'));
        button.addEventListener('click', () => choose(colour));
        buttons.push(button);
        grid.appendChild(button);
      }
      render();
    }
    select.addEventListener('change', renderPalette);
    grid.addEventListener('keydown', event => {
      const index = buttons.indexOf(document.activeElement);
      const columns = select.value === '0' ? 8 : 5;
      const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key];
      if (index < 0 || delta === undefined) return;
      event.preventDefault();
      buttons[Math.max(0, Math.min(buttons.length - 1, index + delta))].focus();
    });
    hex.addEventListener('change', () => {
      if (!/^#?[\da-f]{6}$/i.test(hex.value)) { hex.setAttribute('aria-invalid', 'true'); return; }
      choose(parseInt(hex.value.replace('#', ''), 16));
    });
    hex.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); hex.dispatchEvent(new Event('change')); }
    });
    for (const name of ['pointerdown', 'pointermove', 'pointerup', 'click', 'keydown', 'wheel']) {
      panel.addEventListener(name, event => event.stopPropagation());
    }
    renderPalette();
    return panel;
  }
  window.BuretteColorPicker = { create, presets };
})();
