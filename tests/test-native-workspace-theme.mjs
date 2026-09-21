import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildThemeStyle, readSystemThemeMode, resolveThemeMode, subscribeSystemThemeMode } from '../apps/desktop/src/lib/theme.ts';

test('native theme follows host changes even with a saved manual preference, and unsubscribes', () => {
  const previous = globalThis.window;
  const events = new EventTarget();
  globalThis.window = {
    BuretteMcpWorkspace: { theme: 'dark' },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    matchMedia: () => ({ matches: true }),
  };
  try {
    assert.equal(resolveThemeMode('light'), 'dark');
    const themes = [];
    const unsubscribe = subscribeSystemThemeMode(() => themes.push(readSystemThemeMode()));
    window.BuretteMcpWorkspace.theme = 'light';
    events.dispatchEvent(new Event('burette-host-theme'));
    assert.equal(resolveThemeMode('dark'), 'light');
    unsubscribe();
    events.dispatchEvent(new Event('burette-host-theme'));
    assert.deepEqual(themes, ['light']);
    delete window.BuretteMcpWorkspace;
    assert.equal(resolveThemeMode('dark'), 'dark', 'desktop manual preferences remain supported');
  } finally { globalThis.window = previous; }
});

test('active tabs keep a contrasting foreground/background pair across theme changes', () => {
  const luminance = rgb => rgb.match(/\d+/gu).map(Number).map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  for (const theme of ['light', 'dark']) {
    const style = buildThemeStyle({ theme, themeLightForeground: '#fff', themeDarkForeground: '#000' });
    const values = [luminance(style['--tab-active-bg']), luminance(style['--tab-active-fg'])].sort((a, b) => b - a);
    assert.ok((values[0] + 0.05) / (values[1] + 0.05) > 7, 'fixed tab fill must have its own contrasting text, even with customized shell colors');
  }
});
