import { styleViewerMenu, styleViewerPopover, styleViewerButton, styleViewerSurface, moveViewerMenuFocus } from './viewer-atlas-menu';
import { mountViewerAnimationControls } from './viewer-animation-controls';
import { mountViewerQueryControls, mountViewerSelectionActions } from './viewer-selection-controls';
import { mountViewerSelectionToolbar } from './viewer-selection-toolbar';
import { mountViewerViewportToolbar } from './viewer-viewport-toolbar';

(() => {
  'use strict';

  // Keep the existing controls as the command model: native menus dispatch to
  // the same handlers as browser/Quick Look, including live edits and undo.
  window.BuretteNativeViewerMenus = {
    styleMenu: styleViewerMenu,
    stylePopover: styleViewerPopover,
    styleButton: styleViewerButton,
    moveMenuFocus: moveViewerMenuFocus,
    mountAnimationControls: mountViewerAnimationControls,
    mountQueryControls: mountViewerQueryControls,
    mountSelectionActions: mountViewerSelectionActions,
    mountSelectionToolbar: mountViewerSelectionToolbar,
    mountViewportToolbar: mountViewerViewportToolbar,
    styleControls: styleViewerSurface,
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
      // NSMenu must release tracking before a choice rebuilds the scene. The
      // browser's Atlas Select stays open in the parent menu and applies live.
      const config = window.BuretteConfig || {};
      const liveChoices = config.appViewer === true && config.tauriViewer === false;
      const chooseControl = (key, action) => liveChoices ? handlers.set(key, action) : choose(key, action);
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
          chooseControl(key, value => {
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
            chooseControl(key, value => { control.value = String(value); emit(control, 'change'); });
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
            ...(checked === null && element.classList.contains('buret-tree-menu-item-destructive') ? { variant: 'destructive' } : {}),
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

  // Browsers have no operating-system menus, so a viewer <select> opens an
  // in-page list there; the macOS app, Quick Look and iPhone keep the native
  // picker. The <select> stays the source of truth: choosing dispatches the
  // events the native picker would.
  window.BuretteViewerSelectMenus = {
    install({ checkIcon }) {
      if (this.installed) return;
      this.installed = true;
      let open = null;
      const nativeMenus = () => {
        const config = window.BuretteConfig || {};
        return config.tauriViewer === true || config.quickLookViewer === true || config.host === 'app'
          || document.body.classList.contains('burette-mobile-host');
      };
      const selectFrom = event => {
        const select = event.target?.closest?.('select');
        return select && !select.multiple && !(select.size > 1) && !select.disabled && !nativeMenus() ? select : null;
      };
      const close = (restoreFocus = true) => {
        if (!open) return;
        const { select, list } = open;
        open = null;
        select.removeAttribute('aria-expanded');
        list.hidePopover();
        list.remove();
        if (restoreFocus) select.focus({ preventScroll: true });
      };
      this.closeWithin = owner => {
        if (open && owner.contains(open.select)) close(false);
      };
      const choose = (select, value) => {
        close();
        if (select.value === value) return;
        select.value = value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const place = (select, list) => {
        const margin = 8;
        const rect = select.getBoundingClientRect();
        list.style.minWidth = `${Math.max(rect.width, 144)}px`;
        const below = window.innerHeight - rect.bottom - margin - 4;
        const above = rect.top - margin - 4;
        const up = list.scrollHeight > below && above > below;
        list.style.maxHeight = `${Math.max(up ? above : below, 80)}px`;
        const box = list.getBoundingClientRect();
        list.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - margin - box.width))}px`;
        list.style.top = `${up ? Math.max(margin, rect.top - 4 - box.height) : rect.bottom + 4}px`;
      };
      const show = select => {
        close(false);
        const list = document.createElement('div');
        const atlas = select.hasAttribute('data-native-selectcontrol');
        if (atlas) {
          list.className = 'buret-atlas-picker';
          styleViewerMenu(list, window.BuretteConfig?.themeTokens, select.closest('[data-effective-theme]')?.dataset.effectiveTheme || 'light');
        } else list.className = 'buret-select-menu';
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-label', select.getAttribute('aria-label') || select.closest('label, .buret-tree-menu-field')?.querySelector('span')?.textContent.trim() || 'Options');
        list.setAttribute('popover', 'manual');
        const addOption = (option, groupDisabled) => {
          if (option.hidden) return;
          const item = document.createElement('div');
          item.className = atlas ? 'atlas-menu-item' : 'buret-select-menu-item';
          item.setAttribute('role', 'option');
          item.tabIndex = -1;
          item.dataset.value = option.value;
          item.textContent = option.text;
          item.setAttribute('aria-selected', String(option.selected));
          if (groupDisabled || option.disabled) item.setAttribute('aria-disabled', 'true');
          if (option.selected) {
            const check = checkIcon();
            check.classList.add('buret-select-menu-check');
            item.append(check);
          }
          list.append(item);
        };
        for (const child of select.children) {
          if (child.tagName === 'OPTGROUP') {
            const label = document.createElement('div');
            label.className = atlas ? 'atlas-menu-label' : 'buret-select-menu-label';
            label.textContent = child.label;
            list.append(label);
            for (const option of child.children) addOption(option, child.disabled);
          } else if (child.tagName === 'OPTION') addOption(child, false);
        }
        const items = () => Array.from(list.querySelectorAll('[role="option"]:not([aria-disabled="true"])'));
        const focusItem = item => { item?.focus({ preventScroll: true }); item?.scrollIntoView({ block: 'nearest' }); };
        // Keep pointer events inside the list from reaching the menus that own the select.
        for (const type of ['pointerdown', 'mousedown', 'click']) list.addEventListener(type, event => {
          event.stopPropagation();
          if (type !== 'click') return;
          const item = event.target.closest('[role="option"]');
          if (item && item.getAttribute('aria-disabled') !== 'true') choose(select, item.dataset.value);
        });
        list.addEventListener('pointermove', event => {
          const item = event.target.closest('[role="option"]:not([aria-disabled="true"])');
          if (item && document.activeElement !== item) item.focus({ preventScroll: true });
        });
        list.addEventListener('keydown', event => {
          const enabled = items();
          const index = enabled.indexOf(document.activeElement);
          if (event.key === 'ArrowDown') focusItem(enabled[Math.min(index + 1, enabled.length - 1)]);
          else if (event.key === 'ArrowUp') focusItem(enabled[index < 0 ? enabled.length - 1 : Math.max(index - 1, 0)]);
          else if (event.key === 'Home') focusItem(enabled[0]);
          else if (event.key === 'End') focusItem(enabled.at(-1));
          else if (event.key === 'Enter' || event.key === ' ') { if (index >= 0) choose(select, enabled[index].dataset.value); }
          else if (event.key === 'Escape' || event.key === 'Tab') close();
          else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
            const key = event.key.toLowerCase();
            const ordered = [...enabled.slice(index + 1), ...enabled.slice(0, index + 1)];
            focusItem(ordered.find(item => item.textContent.trim().toLowerCase().startsWith(key)));
          } else return;
          event.preventDefault();
          event.stopPropagation();
        });
        // A list inside the owning menu passes its outside-click checks; Mol*
        // controls are React-owned, so their lists go to the body.
        const owner = select.closest('.msp-plugin') ? document.body : (select.closest('label') || select).parentElement;
        owner.append(list);
        select.setAttribute('aria-expanded', 'true');
        open = { select, list };
        list.showPopover();
        place(select, list);
        const enabled = items();
        focusItem(enabled.find(item => item.getAttribute('aria-selected') === 'true') || enabled[0]);
      };
      document.addEventListener('mousedown', event => {
        const select = event.button === 0 ? selectFrom(event) : null;
        if (!select) return;
        event.preventDefault();
        if (open?.select === select) close();
        else show(select);
      }, true);
      document.addEventListener('pointerdown', event => {
        if (open && !open.list.contains(event.target) && !open.select.contains(event.target)) close(false);
      }, true);
      document.addEventListener('keydown', event => {
        if (open || event.metaKey || event.ctrlKey || !['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) return;
        const select = selectFrom(event);
        if (!select) return;
        event.preventDefault();
        event.stopPropagation();
        show(select);
      }, true);
      window.addEventListener('scroll', event => { if (open && !open.list.contains(event.target)) close(false); }, true);
      window.addEventListener('resize', () => close(false));
      window.addEventListener('blur', () => close(false));
    }
  };
})();
