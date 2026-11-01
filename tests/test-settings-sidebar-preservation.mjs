import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { plugin } from 'bun';
import { transformSync } from '@babel/core';
import { Window } from 'happy-dom';
const dom = new Window({ url: 'http://localhost/' }), descriptors = new Map();
Object.defineProperty(dom.navigator, 'platform', { configurable: true, value: 'MacIntel' });
for (const [key, value] of Object.entries({ window: dom, document: dom.document, localStorage: dom.localStorage,
  navigator: dom.navigator, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node,
  MutationObserver: dom.MutationObserver, getComputedStyle: dom.getComputedStyle.bind(dom), IS_REACT_ACT_ENVIRONMENT: true })) {
  descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const compiled = new Set();
plugin({ name: 'settings-sidebar-compiler', setup(build) {
  build.onLoad({ filter: /(use-app-shell-navigation-actions\.ts|use-keyboard-shortcuts\.ts|theme-mode-control\.tsx)$/u }, ({ path }) => {
    const tsx = path.endsWith('.tsx'), output = transformSync(readFileSync(path, 'utf8'), { filename: path, babelrc: false, configFile: false,
      parserOpts: { plugins: tsx ? ['typescript', 'jsx'] : ['typescript'] }, plugins: [['babel-plugin-react-compiler', {}]] });
    assert.ok(output?.code); compiled.add(path.split('/').at(-1));
    return { contents: output.code, loader: tsx ? 'tsx' : 'ts' };
  });
} });
const { default: React, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { useAppShellNavigationActions } = await import('../apps/desktop/src/hooks/use-app-shell-navigation-actions.ts');
const { useKeyboardShortcuts } = await import('../apps/desktop/src/hooks/use-keyboard-shortcuts.ts');
const { isMacPlatform } = await import('../apps/desktop/src/lib/keyboard-shortcuts.ts');
const { ThemeModeControl } = await import('../apps/desktop/src/components/settings-panel/theme-mode-control.tsx');
const { useShellStore } = await import('../apps/desktop/src/stores/shell-store.ts');
const { useMoleculeStore } = await import('../apps/desktop/src/stores/molecule-store.ts');
const { useSettingsStore } = await import('../apps/desktop/src/stores/settings-store.ts');
const container = dom.document.createElement('div'); dom.document.body.append(container); const root = createRoot(container);
const doc = { id: 'sidebar-preservation', path: '/water.xyz', title: 'Water', renderer: 'molstar', runtimePath: '', extension: 'xyz', byteCount: 1 };
useMoleculeStore.getState().setDocuments([doc]); useMoleculeStore.getState().setActiveDocument(doc.id);
function Host() {
  const sidebarOpen = useShellStore(state => state.sidebarOpen), tabs = useMoleculeStore(), settings = useSettingsStore();
  const actions = useAppShellNavigationActions({ sidebarOpen, toggleSidebar: useShellStore.getState().toggleSidebar,
    openSettingsTab: tabs.openSettingsTab, openSettingsSectionTab: tabs.openSettingsSection,
    activateLastNonSettingsTab: tabs.activateLastNonSettingsTab, setActiveDocument: tabs.setActiveDocument });
  useKeyboardShortcuts({ ...tabs, activeTab: tabs.tabs.find(tab => tab.id === tabs.activeTabId), buildInfo: { isAgentShell: false } }, actions, useShellStore.getState().toggleSidebar);
  return React.createElement(React.Fragment, null,
    React.createElement('button', { 'data-test': 'open', onClick: actions.openSettings }, 'Settings'),
    React.createElement('button', { 'data-test': 'section', onClick: () => actions.openSettingsSection('appearance') }, 'Appearance'),
    React.createElement(ThemeModeControl, { value: settings.preferences.theme, onChange: theme => settings.setPreference('theme', theme) }),
    React.createElement('button', { 'data-test': 'back', onClick: actions.backToApp }, 'Back to app'));
}
const click = selector => { const target = container.querySelector(selector); assert.ok(target); target.click(); };
let scenarios = 0;
try {
  await act(async () => root.render(React.createElement(Host)));
  assert.equal(isMacPlatform(), true);
  assert.deepEqual([...compiled].sort(), ['theme-mode-control.tsx', 'use-app-shell-navigation-actions.ts', 'use-keyboard-shortcuts.ts']);
  for (const initiallyOpen of [false, true]) for (const route of ['keyboard', 'open', 'section']) for (const changeTheme of [false, true]) {
    await act(async () => {
      useShellStore.getState().closeSidebar(); if (initiallyOpen) useShellStore.getState().toggleSidebar();
      useShellStore.getState().setSidebarWidth(340); useSettingsStore.getState().setPreference('theme', 'auto');
      useMoleculeStore.getState().setActiveDocument(doc.id);
    });
    const previousTab = useMoleculeStore.getState().activeTabId;
    await act(async () => {
      if (route === 'keyboard') {
        const event = new dom.KeyboardEvent('keydown', { key: ',', metaKey: isMacPlatform(), ctrlKey: !isMacPlatform(), bubbles: true, cancelable: true });
        dom.dispatchEvent(event); assert.equal(event.defaultPrevented, true);
      } else click(`[data-test="${route}"]`);
    });
    const settingsTab = useMoleculeStore.getState().tabs.find(tab => tab.id === useMoleculeStore.getState().activeTabId);
    assert.equal(settingsTab.location.kind, 'settings');
    assert.equal(useShellStore.getState().sidebarOpen, initiallyOpen, `${route}: Settings entry preserves sidebar preference`);
    if (changeTheme) {
      await act(async () => click('input[aria-label="Light"]'));
      assert.equal(useSettingsStore.getState().preferences.theme, 'light');
    }
    await act(async () => click('[data-test="back"]'));
    assert.deepEqual({ sidebarOpen: useShellStore.getState().sidebarOpen, sidebarWidth: useShellStore.getState().sidebarWidth,
      tab: useMoleculeStore.getState().activeTabId }, { sidebarOpen: initiallyOpen, sidebarWidth: 340, tab: previousTab });
    scenarios++;
  }
  console.log(`Settings sidebar preservation passed ${scenarios} real keyboard/button/section × hidden/visible × theme/unchanged scenarios with compiled hooks and actual theme control/stores.`);
} finally {
  await act(async () => root.unmount()); await dom.happyDOM.close();
  for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
}
