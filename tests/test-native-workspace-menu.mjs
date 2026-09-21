import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

test('native file actions retain application images and a separate placement control', async () => {
  const source = await readFile(new URL('../apps/desktop/src/components/open-in-editor-menu.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source.replaceAll('import.meta.env.DEV', 'false'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  for (const mode of ['inline', 'fullscreen']) {
    for (const hasFile of [true, false]) {
      const requested = [];
      const target = mode === 'inline' ? 'fullscreen' : 'inline';
      const modules = {
        react: { useMemo: fn => fn(), useCallback: fn => fn, useEffect() {}, useState: value => [typeof value === 'function' ? value() : value, () => {}] },
        'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
        '@hugeicons/react': { HugeiconsIcon: 'Icon' },
        '@hugeicons/core-free-icons': { MoreHorizontalIcon: 'ellipsis', SidebarRight01Icon: 'pane', BubbleChatIcon: 'chat' },
        '@/components/ui/button': { Button: 'ShadcnButton' },
        '@tauri-apps/api/core': { convertFileSrc: value => value },
        './radix-menu': { RadixDropdownMenu: 'ShadcnMenu' },
        './shortcut-tooltip': {}, '../lib/tauri': { isTauriRuntime: () => true },
        '../hooks/use-finder-icon-url': { useFinderIconUrl: () => null },
        '../hooks/use-default-application-icon-url': { useDefaultApplicationIconUrl: () => null },
        '../hooks/use-native-application-icons': { useNativeApplicationIcons: () => ({ finder: 'data:image/png;base64,finder' }) },
      };
      const exports = {};
      runInNewContext(code, { exports, require: name => { assert.ok(modules[name], name); return modules[name]; },
        window: { BuretteMcpWorkspace: { placement: { getSnapshot: () => ({ mode, target, disabled: false }), set: async value => requested.push(value) } } },
      });
      const menu = exports.OpenInEditorMenu({ state: { activeDocument: hasFile ? { path: '/fixture.sdf' } : null, preferences: { openInDefaultDestination: 'finder' } }, actions: {} });
      if (!hasFile) { assert.equal(menu, null); continue; }
      assert.equal(menu.type, 'ShadcnMenu');
      const trigger = menu.props.trigger;
      assert.equal(trigger.type, 'button');
      assert.equal(trigger.props['aria-label'], 'Reveal in Finder');
      assert.equal(trigger.props.children[0].props.children.type, 'img');
      assert.equal(trigger.props.children[0].props.children.props.src, 'data:image/png;base64,finder');
      assert.equal(trigger.props.children[1].type, 'svg');
      assert.equal(menu.props.items.find(item => item.id === 'chemical-editor-finder').iconUrl, 'data:image/png;base64,finder');
      assert.ok(menu.props.items.every(item => item.id !== 'workspace-placement'));
      assert.deepEqual(requested, []);
    }
  }
});

test('the Apps SDK display menu moves the existing workspace and reflects host availability', async () => {
  const source = await readFile(new URL('../apps/desktop/src/components/native-workspace-placement-control.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  for (const mode of ['inline', 'fullscreen']) {
    for (const disabled of [true, false]) {
      const requested = [];
      const target = mode === 'inline' ? 'fullscreen' : 'inline';
      const modules = {
        'react-dom': { createPortal: (row, container) => { assert.equal(container, 'theme-shell'); return row; } },
        '../hooks/use-native-workspace-placement': { useNativeWorkspacePlacement: () => ({ mode, target, disabled }) },
        './radix-menu': { useThemePortalContainer: () => 'theme-shell' },
        'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
        '@openai/apps-sdk-ui/components/Icon': { ChevronUp: 'ChevronUp', ExpandLarge: 'ExpandLarge', CollapseLarge: 'CollapseLarge' },
        '@openai/apps-sdk-ui/components/Button': { Button: 'SDKButton' },
        '@openai/apps-sdk-ui/components/Menu': { Menu: Object.assign(() => {}, { Trigger: 'Trigger', Content: 'Content', Item: 'Item' }) },
        '../plugin-ui.css': {},
      };
      const exports = {};
      const window = { BuretteMcpWorkspace: { placement: { getSnapshot: () => ({ mode, target, disabled }), subscribe() {}, set: async value => requested.push(value) } } };
      runInNewContext(code, { exports, window, require: name => { assert.ok(modules[name], name); return modules[name]; } });
      const row = exports.NativeWorkspacePlacementControl();
      assert.match(row.props.className, /absolute.*right-3.*bottom-3/);
      assert.ok('data-workspace-placement-control' in row.props);
      const menu = row.props.children;
      const [trigger, content] = menu.props.children;
      const button = trigger.props.children;
      assert.equal(button.type, 'SDKButton');
      assert.equal(button.props.disabled, disabled);
      assert.equal(button.props.size, 'sm');
      assert.equal(button.props.variant, 'outline');
      assert.equal(button.props.style, undefined);
      assert.equal(button.props['aria-label'], 'Codex workspace menu');
      assert.equal(button.props.children[0].trim(), 'Codex');
      assert.equal(content.props.side, 'top');
      assert.equal(content.props.align, 'end');
      const item = content.props.children;
      assert.equal(item.props.disabled, disabled);
      assert.equal(item.props.children[1], mode === 'inline' ? 'Open in side pane' : 'Return to chat');
      if (!disabled) { item.props.onSelect(); assert.deepEqual(requested, [target]); }
      window.BuretteMcpWorkspace = undefined;
      assert.equal(exports.NativeWorkspacePlacementControl(), null, 'ordinary desktop has no host-placement control');
    }
  }
});
