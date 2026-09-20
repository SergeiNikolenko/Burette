/* Decorate native component rows without moving Mol*'s residue nodes. */
const rows = new WeakMap();
export function decorateComponents(panel, changed) {
  for (const wrapper of panel.querySelectorAll('.msp-sequence-wrapper')) {
    const label = wrapper.previousElementSibling;
    if (!label?.classList.contains('msp-sequence-chain-label')) continue;
    const residues = Array.from(wrapper.querySelectorAll('[data-seqid]'));
    const codes = residues.map(node => node.textContent.replace(/\u200b/g, '').trim());
    if (!codes.length || codes.some(code => code.length === 1)) continue;
    const raw = label.title || label.textContent;
    const signature = raw + codes.join(',');
    if (rows.get(wrapper)?.signature === signature && (wrapper.querySelector('.buret-component-control') || label.querySelector('.buret-component-control'))) continue;
    wrapper.querySelector('.buret-component-control')?.remove();
    const chain = raw.replace(/^Chain /, '').split(' | ')[0];
    const water = codes.every(code => code === 'HOH' || code === 'WAT' || code === 'DOD');
    wrapper.classList.add('buret-component-row');
    label.classList.add('buret-component-label');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'buret-component-control';
    if (water) {
      label.classList.add('buret-water-label');
      wrapper.classList.add('buret-water-row');
      label.replaceChildren(button);
      button.textContent = `Water · ${residues.length}`;
      button.setAttribute('aria-expanded', 'false');
      wrapper.hidden = true;
      button.onclick = () => {
        wrapper.hidden = !wrapper.hidden;
        button.setAttribute('aria-expanded', String(!wrapper.hidden));
        if (!wrapper.hidden) wrapper.scrollIntoView({ block: 'nearest' });
        changed();
      };
    } else {
      const number = wrapper.querySelector('.msp-sequence-number')?.textContent.trim() || '';
      button.textContent = `${chain}:${number}`;
      button.setAttribute('aria-label', `Details for ${codes.join(', ')} ${chain}:${number}`);
      label.setAttribute('popover', 'auto');
      label.textContent = raw.replace(/^Chain /, '').replace(/ \| \d+: /, ' · ');
      button.onclick = () => {
        const rect = button.getBoundingClientRect();
        label.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - 332))}px`;
        label.style.top = `${Math.min(rect.bottom + 8, window.innerHeight - 150)}px`;
        label.togglePopover();
      };
      wrapper.append(button);
    }
    rows.set(wrapper, { signature });
  }
}
