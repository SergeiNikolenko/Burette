/* Desktop-only projection of the existing Mol* menu controls into AppKit.
 * No host acknowledgement means no observers, no hidden menus and no changed
 * browser interactions. DOM nodes keep ownership of their existing actions. */
(() => {
  'use strict';
  const roots = '#buret-scene-tree-menu, .buret-molecule-context-menu:not(.buret-xyzrender-context-menu)';
  let installed = false;
  let session = null;
  const post = body => window.parent.postMessage({ source: 'burette-viewer', body: {
    ...body, documentId: window.BuretteConfig?.documentId
  } }, '*');
  const title = element => element.getAttribute('aria-label') || element.querySelector('.buret-tree-menu-label')?.textContent?.trim() || element.textContent.trim();
  const color = element => {
    const value = Number(element.dataset.sceneTreeColor ?? element.dataset.sceneTreeMeasurementColor);
    if (Number.isFinite(value)) return '#' + value.toString(16).padStart(6, '0');
    const rgb = element.style.backgroundColor.match(/\d+/g);
    return rgb?.length >= 3 ? '#' + rgb.slice(0, 3).map(x => Number(x).toString(16).padStart(2, '0')).join('') : null;
  };
  function project(menu) {
    const actions = new Map();
    const hover = new Map();
    let count = 0;
    const bind = callback => { if (++count > 500) throw Error('Menu too large'); const id = `control-${count}`; actions.set(id, callback); return id; };
    const command = (element, text = title(element), callback = () => element.click()) => {
      const id = bind(callback);
      hover.set(id, phase => {
        element.dispatchEvent(new PointerEvent(phase === 'enter' ? 'pointerenter' : 'pointerleave'));
        element.dispatchEvent(new PointerEvent(phase === 'enter' ? 'pointerover' : 'pointerout', { bubbles: true }));
      });
      return { kind: 'item', id, text, enabled: !element.disabled,
      ...(element.hasAttribute('aria-pressed') || element.hasAttribute('aria-checked') || element.hasAttribute('aria-selected') || element.hasAttribute('data-current') ? { checked: element.getAttribute('aria-pressed') === 'true' || element.getAttribute('aria-checked') === 'true' || element.getAttribute('aria-selected') === 'true' || element.dataset.current === 'true' } : {})
    }; };
    const dispatch = (element, value, phase) => {
      element.value = String(value);
      element.dispatchEvent(new Event(phase, { bubbles: true }));
    };
    const nodes = parent => Array.from(parent.children).flatMap(element => {
      if (element.matches('summary, svg, [popover], .buret-molecule-context-submenu, [data-scene-tree-picker-list]')) return [];
      if (element.matches('[role="separator"], .buret-tree-menu-divider')) return [{ kind: 'separator' }];
      if (element.matches('.buret-tree-menu-title, .buret-molecule-context-menu-title, .buret-molecule-context-menu-subtitle')) {
        return [{ kind: 'item', id: bind(() => {}), text: title(element), enabled: false }];
      }
      if (element.matches('details')) return [{ kind: 'submenu', id: bind(() => {}), text: element.querySelector('summary')?.textContent || 'Advanced', enabled: true, items: nodes(element) }];
      if (element.matches('.buret-tree-swatches')) {
        const swatches = Array.from(element.querySelectorAll('button')).filter(button => color(button));
        const colors = swatches.map(color);
        const items = [];
        if (colors.length) items.push({ kind: 'control', text: element.previousElementSibling?.matches('span') ? element.previousElementSibling.textContent.trim() : 'Colour',
          id: bind((value, phase) => { if (phase === 'input') swatches[colors.indexOf(value)]?.click(); }),
          control: { kind: 'palette', colors, selected: color(swatches.find(button => button.getAttribute('aria-pressed') === 'true') || document.createElement('span')) }
        });
        // Custom colour is a separate control, never silently discarded.
        for (const button of element.querySelectorAll('button')) {
          if (!swatches.includes(button)) items.push(button.dataset.nativeColor ? {
            kind: 'control', id: bind((value, phase) => button.dispatchEvent(new CustomEvent('burette-native-color', { detail: { value, phase } }))),
            text: title(button), control: { kind: 'color', value: button.dataset.nativeColor }
          } : command(button));
        }
        return items;
      }
      const input = element.matches('input') ? element : element.querySelector(':scope > input');
      if (input) {
        const text = input.getAttribute('aria-label') || element.querySelector('span')?.textContent || 'Value';
        if (input.type === 'checkbox') return [{ kind: 'item', id: bind(() => input.click()), text, enabled: !input.disabled, checked: input.checked }];
        if (input.type === 'range') {
          return [{ kind: 'control', id: bind((value, phase) => dispatch(input, value, phase)), text,
            control: { kind: 'slider', value: Number(input.value), min: Number(input.min || 0), max: Number(input.max || 100), step: Number(input.step || 1) } }];
        }
        if (input.type === 'text' || input.type === 'number') {
          return [{ kind: 'control', id: bind((value, phase) => { if (phase === 'change') dispatch(input, value, 'input'); dispatch(input, value, phase); }), text,
            control: { kind: 'text', value: input.value } }];
        }
        throw Error('Unsupported input');
      }
      const select = element.matches('select') ? element : element.querySelector(':scope > select');
      if (select) return [{ kind: 'submenu', id: bind(() => {}), text: element.querySelector('span')?.textContent || title(select), enabled: !select.disabled,
        items: Array.from(select.options).filter(option => option.value).map(option => ({
          kind: 'item', id: bind(() => dispatch(select, option.value, 'change')), text: option.textContent, enabled: !option.disabled, checked: option.selected
        })) }];
      if (element.matches('button')) {
        const submenu = Array.from(menu.querySelectorAll('.buret-molecule-context-submenu')).find(child => child._buretTrigger === element);
        const picker = element.dataset.sceneTreePicker
          ? Array.from(menu.querySelectorAll('[data-scene-tree-picker-list]')).find(child => child.dataset.sceneTreePickerList === element.dataset.sceneTreePicker) : null;
        if (submenu || picker) {
          const entry = command(element);
          if (picker) entry.text = element.previousElementSibling?.textContent?.trim() || entry.text;
          hover.set(entry.id, phase => { if (phase === 'enter') { if (picker) { if (picker.hidden) element.click(); } else element.dispatchEvent(new FocusEvent('focus')); } });
          return [{ ...entry, kind: 'submenu',
          items: picker ? Array.from(picker.querySelectorAll('button')).map(button => command(button, title(button), () => { if (picker.hidden) element.click(); button.click(); })) : nodes(submenu) }]; }
        return [command(element)];
      }
      return nodes(element);
    });
    return { items: nodes(menu), actions, hover };
  }
  function show(menu) {
    if (session || menu.dataset.nativeMenuAttempted || !menu.isConnected) return;
    menu.dataset.nativeMenuAttempted = 'true';
    let projection;
    try { projection = project(menu); } catch { return; }
    if (!projection.items.length) return;
    const rect = menu.getBoundingClientRect();
    const token = crypto.randomUUID();
    session = { menu, token, actions: projection.actions, hover: projection.hover, visibility: menu.style.visibility };
    // Retain nodes for delegated input/change handlers and their undo state.
    menu.style.visibility = 'hidden';
    post({ type: 'nativeMenuOpen', token, x: rect.left, y: rect.top, items: projection.items });
  }
  window.addEventListener('message', async event => {
    if (event.source !== window.parent || event.data?.source !== 'burette-native-menu') return;
    const message = event.data;
    if (message.kind === 'available' && !installed) {
      installed = true;
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node instanceof Element && node.matches(roots)) show(node);
        }
      }).observe(document.body, { childList: true });
      return;
    }
    if (!session || message.token !== session.token) return;
    if (message.kind === 'control') {
      if (['enter', 'leave'].includes(message.phase)) { session.hover.get(message.id)?.(message.phase); return; }
      if (session.menu.isConnected && ['input', 'change'].includes(message.phase)) session.actions.get(message.id)?.(message.value, message.phase);
      return;
    }
    const current = session;
    session = null;
    current.menu.style.visibility = current.visibility;
    if (message.kind === 'fallback') return;
    if (message.kind === 'closed') {
      if (message.selection) current.actions.get(message.selection)?.();
      try { await current.menu._buretPendingAction; } finally {
      if (current.menu.isConnected && !current.menu.querySelector(':popover-open')) current.menu.dispatchEvent(new Event('burette-native-menu-close'));
      }
      // Controls can open an existing colour picker or a nested action panel.
      // Those handlers own their lifetime, including preview rollback.
    }
  });
  if (window.parent !== window) post({ type: 'nativeMenuReady' });
})();
