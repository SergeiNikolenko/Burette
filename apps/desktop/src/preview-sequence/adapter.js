import { decorateComponents } from './components';
import { bindSequenceDrag } from './drag-selection';
import { mountSelect, initResize, setContentHeight, sequenceOptionLabel } from './controls';
/* Presentation adapter: Mol* retains ownership of selects, residue nodes and picking. */
(() => {
  'use strict';
  let current, pending = false;
  const layouts = new WeakMap();
  function element(tag, className, label) {
    const node = document.createElement(tag);
    node.className = className;
    if (label) node.textContent = label;
    return node;
  }
  function dismiss() {
    current?.controls?.forEach(control => control.close());
  }
  function disposeControls() {
    current?.controls?.forEach(control => control.destroy());
    if (current) current.controls = [];
  }
  function layout(wrapper) {
    const compact = wrapper.closest('.msp-sequence').classList.contains('buret-seq-compact');
    const groups = compact ? Infinity : Math.max(1, Math.floor((wrapper.clientWidth - 32) / 94));
    const previous = layouts.get(wrapper);
    const nodes = Array.from(wrapper.children);
    if (wrapper.classList.contains('buret-seq-grid') && previous?.groups === groups
      && previous.nodes.length === nodes.length && previous.nodes.every((node, i) => node === nodes[i])) return;
    const residues = Array.from(wrapper.querySelectorAll('[data-seqid]'));
    // Multi-letter ligands and very large sequences keep Mol*'s flexible layout.
    const regular = residues.length <= 10000 && residues.every(node => node.textContent.replace(/\u200b/g, '').length === 1);
    if (!regular || !residues.length) {
      if (wrapper.classList.contains('buret-seq-grid')) wrapper.classList.remove('buret-seq-grid');
      if (layouts.has(wrapper)) {
        layouts.delete(wrapper);
        wrapper.style.removeProperty('grid-template-columns');
        wrapper.style.removeProperty('grid-template-rows');
        Array.from(wrapper.children).forEach(node => node.style.removeProperty('grid-area'));
      }
      return;
    }
    layouts.set(wrapper, { groups, nodes, residueCount: residues.length });
    wrapper.classList.add('buret-seq-grid');
    const columns = compact ? Math.ceil(residues.length / 10) : groups;
    wrapper.style.gridTemplateColumns = Array.from({ length: columns }, () => `${'8px '.repeat(10)}14px`).join(' ');
    wrapper.style.gridTemplateRows = `repeat(${Math.ceil(residues.length / (columns * 10))}, 12px 22px)`;
    residues.forEach((node, index) => {
      const position = index % (groups * 10);
      const column = position + Math.floor(position / 10) + 1;
      const row = Math.floor(index / (groups * 10)) * 2 + 2;
      node.style.gridArea = `${row} / ${column}`;
      const number = node.previousElementSibling;
      if (number?.classList.contains('msp-sequence-number')) number.style.gridArea = `${row - 1} / ${column}`;
    });
  }
  function refresh() {
    if (!current?.panel.isConnected) return;
    if (!current.panel.clientWidth) { dismiss(); return; }
    const { panel, header } = current;
    const compact = panel.getBoundingClientRect().height <= 112;
    const enteringCompact = compact && !panel.classList.contains('buret-seq-compact');
    panel.classList.toggle('buret-seq-compact', compact);
    const native = panel.querySelector('.msp-sequence-select');
    const selects = Array.from(native?.querySelectorAll('select') || []);
    const signature = JSON.stringify(selects.map(s => [s.value, s.disabled, Array.from(s.options, o => [o.value, o.text, o.disabled])]));
    if (current.signature !== signature || current.selects?.some((s, i) => s !== selects[i])) {
      const focusedRole = header.contains(document.activeElement) ? document.activeElement.closest('[data-role]')?.dataset.role : null;
      disposeControls();
      current.signature = signature;
      current.selects = selects;
      header.replaceChildren(element('strong', 'buret-seq-title', 'Sequence'));
      selects.forEach((select, index) => {
        const role = index === 0 ? 'Structure' : index === 1 ? 'View' : selects.length >= 4 ? ['Molecule', 'Chain', 'Instance'][index - 2] : 'Instance';
        const value = select.selectedOptions[0]?.text || 'None';
        const label = role === 'Chain' ? `Chain ${value}` : role === 'View' ? sequenceOptionLabel(value, role) : value;
        let control;
        if (select.options.length === 1) {
          control = element('span', 'buret-seq-context', label);
        } else {
          const mounted = mountSelect(select, role, label, schedule);
          current.controls.push(mounted);
          control = mounted.node;
        }
        control.dataset.role = role;
        header.append(control);
      });
      if (focusedRole) Array.from(header.children).find(node => node.dataset.role === focusedRole)?.querySelector('button')?.focus();
    }
    const wrappers = panel.querySelectorAll('.msp-sequence-wrapper');
    wrappers.forEach(layout);
    panel.querySelectorAll('.msp-sequence-chain-label').forEach(label => {
      if (label.classList.contains('buret-component-label')) return;
      if (!label.textContent.startsWith('Chain ')) label.textContent = `Chain ${label.textContent}`;
      label.title = label.textContent;
    });
    decorateComponents(panel, schedule);
    const reading = panel.querySelector('.msp-sequence-wrapper-non-empty');
    const last = reading && Array.from(reading.children).findLast(node => !node.hidden && (!node.classList.contains('buret-component-label') || node.classList.contains('buret-water-label')));
    if (reading && enteringCompact) reading.scrollTop = 0;
    if (last) {
      if (compact) {
        // Measure the expanded capacity independently of the one-line track,
        // so switching from a short chain can raise the resize ceiling again.
        const groups = Math.max(1, Math.floor((reading.clientWidth - 32) / 94));
        let height = 40;
        for (const child of reading.children) {
          const grid = layouts.get(child);
          if (grid) height += Math.ceil(grid.residueCount / (groups * 10)) * 34 + 22;
          else if (child.classList.contains('msp-sequence-chain-label')) height += 34;
          else height += child.getBoundingClientRect().height;
        }
        setContentHeight(height);
      } else {
        const visible = Array.from(reading.children).filter(node => !node.hidden && (!node.classList.contains('buret-component-label') || node.classList.contains('buret-water-label')));
        const bottom = Math.max(...visible.map(node => node.getBoundingClientRect().bottom));
        const height = bottom - reading.getBoundingClientRect().top + reading.scrollTop + (panel.querySelector('.buret-component-row') ? 12 : 0);
        setContentHeight(header.getBoundingClientRect().height + height);
      }
    }
  }
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; refresh(); });
  }
  function sync() {
    const panel = document.querySelector('.msp-sequence');
    if (!panel) {
      dismiss();
      disposeControls();
      current?.resize.disconnect();
      current?.disposeDrag();
      current = null;
      return;
    }
    if (document.body.classList.contains('burette-mobile-host')) return;
    if (current?.panel !== panel) {
      dismiss();
      disposeControls();
      current?.resize.disconnect();
      current?.disposeDrag();
      const header = element('div', 'buret-seq-header');
      panel.prepend(header);
      panel.classList.add('buret-seq-enhanced');
      const resize = new ResizeObserver(schedule);
      resize.observe(panel);
      current = { panel, header, resize, controls: [], disposeDrag: bindSequenceDrag(panel) };
    }
    schedule();
  }
  window.BuretteSequencePanel = { sync, initResize };
})();
