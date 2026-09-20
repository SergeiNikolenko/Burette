import assert from 'node:assert/strict';

const storage = new Map([
  ['burette.shell', JSON.stringify({ state: { preferences: { conformerEngine: 'datamol', theme: 'dark', desktopPreviewLimitMiB: 512 } }, version: 0 })],
]);
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key),
};
globalThis.window = { localStorage: globalThis.localStorage };
const { useSettingsStore, getSettingsStoreSnapshot, defaultPreferences } = await import('../apps/desktop/src/stores/settings-store.ts');
assert.deepEqual(useSettingsStore.getState().preferences, { ...defaultPreferences, theme: 'dark', desktopPreviewLimitMiB: 512 });
useSettingsStore.getState().setPreference('theme', 'light');
assert.equal('conformerEngine' in JSON.parse(storage.get('burette.shell')).state.preferences, false);
const snapshot = { preferences: { ...defaultPreferences, conformerEngine: 'rdkit', theme: 'dark' } };
useSettingsStore.getState().restoreSnapshot(snapshot);
assert.deepEqual(getSettingsStoreSnapshot(), { preferences: { ...defaultPreferences, theme: 'dark' } });
assert.equal(snapshot.preferences.conformerEngine, 'rdkit', 'migration must not mutate saved history');
console.log('Settings rehydration and snapshot migration passed');
