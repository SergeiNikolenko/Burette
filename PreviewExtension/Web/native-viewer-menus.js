(() => {
  'use strict';

  // Keep the existing controls as the command model: native menus dispatch to
  // the same handlers as browser/Quick Look, including live edits and undo.
  window.BuretteNativeViewerMenus = {
    show(menu, { post, x, y, ...callbacks }) {
      const session = this.create(menu, callbacks);
      const requestId = `viewer-controls-${crypto.randomUUID()}`;
      const receive = event => {
        if (event.source !== window.parent || event.data?.source !== 'burette-host') return;
        const body = event.data.body;
        if (body?.type !== 'molstarContextMenuResult' || body.requestId !== requestId) return;
        if (body.event === 'select') { session.handlers.get(body.id)?.(body.value); return; }
        window.removeEventListener('message', receive);
        if (body.event === 'unsupported') session.fallback();
        else session.close();
      };
      window.addEventListener('message', receive);
      menu.style.visibility = 'hidden'; menu.setAttribute('aria-hidden', 'true');
      if (post({ type: 'molstarContextMenu', requestId, clientX: x, clientY: y, items: session.items })) return true;
      window.removeEventListener('message', receive); session.fallback(); return false;
    },
    create(menu, { color = () => {}, finishControl = () => {}, close }) {
      const handlers = new Map();
      const changed = new Set();
      let serial = 0;
      let afterClose;
      const id = () => `control-${++serial}`;
      const choose = (key, action) => handlers.set(key, value => { afterClose = () => action(value); });
      const emit = (control, type) => control.dispatchEvent(new Event(type, { bubbles: true }));
      const editText = (control, label) => {
        const dialog = document.createElement('dialog');
        dialog.setAttribute('aria-label', label);
        const form = document.createElement('form');
        form.method = 'dialog';
        const field = document.createElement('input');
        field.className = 'buret-input'; field.value = control.value;
        field.setAttribute('aria-label', label);
        const save = document.createElement('button');
        save.className = 'buret-button'; save.textContent = 'Save';
        const cancel = document.createElement('button');
        cancel.className = 'buret-button'; cancel.textContent = 'Cancel'; cancel.type = 'button';
        cancel.onclick = () => dialog.close();
        const owner = document.createElement('div');
        owner.hidden = true; owner.dataset.ref = control.closest('[data-ref]')?.dataset.ref || '';
        owner.append(control);
        form.append(label, field, save, cancel, owner); dialog.append(form);
        form.onsubmit = () => { control.value = field.value; emit(control, 'change'); };
        dialog.onclose = () => dialog.remove();
        document.body.append(dialog); dialog.showModal(); field.focus(); field.select();
      };
      const caption = element => {
        const label = element.querySelector('.buret-tree-menu-label, .ab-item-title')?.textContent?.trim()
          || element.textContent.trim();
        const suffix = element.querySelector('.ab-item-meta')?.textContent.trim();
        return suffix ? `${label} ${suffix}` : label;
      };
      const icon = element => {
        const svg = element.querySelector('.buret-tree-menu-icon svg, :scope > svg');
        if (!svg) return undefined;
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg).replaceAll('currentColor', '#000'))}`;
      };
      const visit = parent => Array.from(parent.children).flatMap(element => {
        if (element.hidden || element.classList.contains('hidden') || element.tagName === 'SUMMARY') return [];
        const key = id();
        if (element.matches('.buret-tree-menu-divider, .buret-molstar-preset-menu-separator, .ab-separator, [role=separator]')) return [{ kind: 'separator' }];
        if (element.matches('.buret-tree-menu-header, .buret-tree-menu-title, .buret-molstar-preset-menu-section, .ab-group, .ab-selhead, .buret-grid-molecule-context-menu-title, .buret-grid-molecule-context-menu-subtitle')) {
          return [{ kind: 'label', text: caption(element) }];
        }
        if (element.tagName === 'DETAILS') return [{ kind: 'submenu', id: key,
          text: element.querySelector('summary')?.textContent.trim() || 'Options', items: visit(element) }];
        const swatches = element.matches('.buret-tree-swatches') ? element : element.querySelector(':scope > .buret-tree-swatches');
        if (swatches) {
          const buttons = Array.from(swatches.querySelectorAll('[data-scene-tree-color], [data-viewport-color]'));
          const hex = button => `#${Number(button.dataset.sceneTreeColor ?? button.dataset.viewportColor).toString(16).padStart(6, '0')}`;
          if (!buttons.length) return [];
          handlers.set(key, value => {
            if (!/^#[0-9a-f]{6}$/i.test(String(value))) return;
            color(buttons[0], Number.parseInt(value.slice(1), 16));
          });
          const active = buttons.find(button => button.getAttribute('aria-pressed') === 'true');
          const label = element.querySelector(':scope > span')?.textContent.trim();
          return [...(label ? [{ kind: 'label', text: label }] : []),
            { kind: 'swatches', id: key, colors: buttons.map(hex), ...(active ? { active: hex(active) } : {}) }];
        }
        const picker = element.querySelector(':scope > [data-scene-tree-picker]');
        if (picker) {
          const list = menu.querySelector(`[data-scene-tree-picker-list="${picker.dataset.sceneTreePicker}"]`);
          const options = Array.from(list?.children || []);
          choose(key, value => {
            picker.click();
            options.find(option => option.dataset.sceneTreePickerValue === value)?.click();
          });
          return [{ kind: 'select', id: key, label: element.firstElementChild.textContent,
            value: list?.dataset.current || '', options: options.map(option => ({ value: option.dataset.sceneTreePickerValue, label: option.textContent })) }];
        }
        if (element.matches('.ab-row')) return visit(element);
        const control = element.matches('input, select') ? element : element.querySelector(':scope > input, :scope > select');
        if (control) {
          const label = element.querySelector(':scope > span')?.textContent.trim() || control.getAttribute('aria-label') || 'Value';
          if (control.tagName === 'SELECT') {
            choose(key, value => { control.value = String(value); emit(control, 'change'); });
            return [{ kind: 'select', id: key, label, value: control.value, disabled: control.disabled,
              options: Array.from(control.options).filter(option => option.value && !option.disabled)
                .map(option => ({ value: option.value, label: option.textContent })) }];
          }
          if (control.type === 'checkbox') {
            choose(key, value => { control.checked = value === true; emit(control, 'change'); });
            return [{ kind: 'checkbox', id: key, text: label, checked: control.checked, disabled: control.disabled }];
          }
          if (control.type === 'range' || control.type === 'number') {
            handlers.set(key, value => {
              if (!Number.isFinite(Number(value))) return;
              control.value = String(value); changed.add(control); emit(control, 'input');
            });
            return [{ kind: 'number', id: key, label, value: Number(control.value),
              min: Number(control.min || 0), max: Number(control.max || 100), step: Number(control.step || 1),
              ...(element.querySelector('.buret-tree-menu-slider-value')?.textContent.endsWith('%') ? { unit: '%' } : {}) }];
          }
          if (control.type === 'text') {
            // Free-form text belongs in a dialog, after NSMenu releases tracking.
            choose(key, () => editText(control, label));
            return [{ kind: 'item', id: key, text: `${label}…` }];
          }
        }
        if (element.tagName === 'BUTTON') {
          choose(key, () => element.click());
          const checked = element.getAttribute('aria-checked') ?? element.getAttribute('aria-pressed');
          return [{ kind: checked === null ? 'item' : 'checkbox', id: key, text: caption(element),
            disabled: element.disabled, ...(checked === null ? { icon: icon(element) } : { checked: checked === 'true' }) }];
        }
        return visit(element);
      });
      const items = visit(menu);
      return {
        items, handlers,
        fallback() { menu.style.visibility = ''; menu.removeAttribute('aria-hidden'); },
        close() {
          for (const control of changed) {
            // Commit even if a command removed the portalled menu first.
            if (control.isConnected) emit(control, 'change');
            finishControl(control);
          }
          afterClose?.();
          close();
          menu.style.visibility = '';
          menu.removeAttribute('aria-hidden');
        }
      };
    }
  };
})();
