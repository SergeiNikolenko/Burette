import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { Window } from 'happy-dom';
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

test('the solid Apps SDK button directly moves the existing workspace', async () => {
  const source = await readFile(new URL('../apps/desktop/src/components/native-workspace-placement-control.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  for (const mode of ['inline', 'fullscreen']) {
    for (const disabled of [true, false]) {
      const requested = [];
      const notices = [];
      const target = mode === 'inline' ? 'fullscreen' : 'inline';
      const modules = {
        react: { useState: initial => [initial, value => notices.push(value)] },
        '../hooks/use-native-workspace-placement': { useNativeWorkspacePlacement: () => ({ mode, target, disabled }) },
        'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
        '@openai/apps-sdk-ui/components/Icon': { ExpandLarge: 'ExpandLarge', CollapseLarge: 'CollapseLarge' },
        '@openai/apps-sdk-ui/components/Button': { Button: 'SDKButton' },
        '../plugin-ui.css': {},
      };
      const exports = {};
      const window = { BuretteMcpWorkspace: { placement: { getSnapshot: () => ({ mode, target, disabled }), subscribe() {}, set: async value => requested.push(value) } } };
      runInNewContext(code, { exports, window, require: name => { assert.ok(modules[name], name); return modules[name]; } });
      const row = exports.NativeWorkspacePlacementControl();
      assert.ok('data-workspace-placement-control' in row.props);
      const button = row.props.children[1];
      assert.equal(button.type, 'SDKButton');
      assert.equal(button.props.disabled, disabled);
      assert.equal(button.props.size, 'sm');
      assert.equal(button.props.variant, 'solid');
      assert.equal(button.props.style, undefined);
      assert.equal(button.props['aria-label'], mode === 'inline' ? 'Open in side pane' : 'Return to chat');
      assert.equal(button.props.children[0].trim(), 'Codex');
      if (!disabled) { button.props.onClick(); assert.deepEqual(requested, [target]); assert.deepEqual(notices, ['']); }
      window.BuretteMcpWorkspace = undefined;
      assert.equal(exports.NativeWorkspacePlacementControl(), null, 'ordinary desktop has no host-placement control');
    }
  }
});

test('host button has an independent mount outside the inert preview root', async () => {
  const main = await readFile(new URL('../apps/desktop/src/main.tsx', import.meta.url), 'utf8');
  const placement = await readFile(new URL('../plugins/burette-agent/ui/native-workspace-placement.mjs', import.meta.url), 'utf8');
  assert.match(main, /document\.body\.appendChild\(controlHost\)/);
  assert.match(main, /const controlsRoot = controlHost \? createRoot\(controlHost\)/);
  assert.match(main, /controlsRoot\?\.render\(/);
  assert.match(main, /controlsRoot\?\.unmount\(\)/);
  assert.match(placement, /body>\[data-workspace-placement-host\]\{position:fixed;[^}]*z-index:101;pointer-events:auto\}/);
});

test('the button receives a real DOM click while the preview is inert', async () => {
  const browser = new Window();
  const previous = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator };
  globalThis.window = browser;
  globalThis.document = browser.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: browser.navigator });
  try {
    const React = await import('react');
    const { createRoot } = await import('react-dom/client');
    const source = await readFile(new URL('../apps/desktop/src/components/native-workspace-placement-control.tsx', import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const requests = [];
    browser.BuretteMcpWorkspace = { placement: { set: async mode => { requests.push(mode); return { ok: true, mode }; } } };
    const modules = {
      react: React,
      'react/jsx-runtime': await import('react/jsx-runtime'),
      '../hooks/use-native-workspace-placement': { useNativeWorkspacePlacement: () => ({ mode: 'inline', target: 'fullscreen', disabled: false }) },
      '@openai/apps-sdk-ui/components/Icon': { ExpandLarge: () => null, CollapseLarge: () => null },
      '@openai/apps-sdk-ui/components/Button': { Button: ({ children, color, variant, size, ...props }) => React.createElement('button', props, children) },
      '../plugin-ui.css': {},
    };
    const exports = {};
    runInNewContext(code, { exports, window: browser, require: name => { assert.ok(modules[name], name); return modules[name]; } });
    const preview = browser.document.createElement('div');
    preview.inert = true;
    browser.document.body.appendChild(preview);
    const controlHost = browser.document.createElement('div');
    browser.document.body.appendChild(controlHost);
    const controlsRoot = createRoot(controlHost);
    controlsRoot.render(React.createElement(exports.NativeWorkspacePlacementControl));
    await new Promise(resolve => setTimeout(resolve, 20));
    const button = controlHost.querySelector('button');
    assert.ok(button);
    button.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(requests, ['fullscreen']);
    browser.BuretteMcpWorkspace.placement.set = async () => { throw new Error('Host declined'); };
    button.click();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.match(controlHost.querySelector('[role="alert"]')?.textContent || '', /Host declined/);
    controlsRoot.unmount();
  } finally {
    await new Promise(resolve => setTimeout(resolve, 50));
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previous.navigator });
    await browser.happyDOM.close();
  }
});
