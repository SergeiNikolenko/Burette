import { expect, mock, test } from 'bun:test';
const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
let destination: string | null = '/tmp/animation.gif';
const reference = '2\nref\nH -1 0 0\nH 1 0 0\n';
mock.module('@tauri-apps/api/core', () => ({ invoke: async (command: string, args: Record<string, unknown>) => {
  calls.push({ command, args });
  return command === 'write_base64_file' ? destination : { svg: '<svg/>', orientationRef: reference, gifBase64: 'R0lGODlh' };
} }));
mock.module('@tauri-apps/plugin-dialog', () => ({ save: async () => destination }));
const { renderXyzrender, saveXyzrenderFile } = await import('../apps/desktop/src/lib/xyzrender-transport');
Object.assign(globalThis, { window: { __TAURI_INTERNALS__: {} } });
globalThis.fetch = (() => { throw new Error('Native renderer must not use an HTTP server'); }) as typeof fetch;

test('native orientation prepares a reference, then renders rotated coordinates without HTTP', async () => {
  calls.length = 0;
  const response = await renderXyzrender({ path: '/tmp/molecule.xyz', orientation: [0, 0, 90] });
  expect(response.ok).toBe(true);
  expect(calls.map(call => call.command)).toEqual(['render_xyzrender_editor', 'render_xyzrender_editor']);
  expect(calls[0].args.request).toMatchObject({ saveReference: true });
  expect(calls[1].args.request).toMatchObject({ orientationRef: '2\nBurette orientation\nH -0.000000000 -1.000000000 0.000000000\nH 0.000000000 1.000000000 0.000000000\n' });
  expect((await response.json()).baseOrientationRef).toBe(reference);
});
test('native GIF save writes only the destination selected in the system dialog', async () => {
  calls.length = 0;
  expect(await saveXyzrenderFile('molecule.gif', 'gif', 'R0lGODlh')).toEqual({ name: 'molecule.gif', path: destination });
  expect(calls).toEqual([{ command: 'write_base64_file', args: { request: { outputPath: destination, contentsBase64: 'R0lGODlh' } } }]);
  destination = null;
  calls.length = 0;
  expect(await saveXyzrenderFile('molecule.gif', 'gif', 'R0lGODlh')).toBeNull();
  expect(calls).toEqual([]);
});
test('an already cancelled request cannot start a native process', async () => {
  calls.length = 0;
  const controller = new AbortController(); controller.abort();
  await expect(renderXyzrender({ path: '/tmp/molecule.xyz' }, controller.signal)).rejects.toThrow();
  expect(calls).toEqual([]);
});
test('trajectory and vibration use the full source rather than the selected inline frame', async () => {
  for (const mode of ['trajectory', 'vibration']) {
    calls.length = 0;
    await renderXyzrender({ path: '/tmp/frame.xyz', inputDataBase64: 'selected-frame', inputExtension: 'xyz',
      animationSourcePath: '/tmp/trajectory.xyz', animationSourceExtension: 'xyz', animation: { mode } });
    expect(calls[0].args.request).toMatchObject({ path: '/tmp/trajectory.xyz', inputExtension: 'xyz', inputDataBase64: undefined });
  }
  calls.length = 0;
  await renderXyzrender({ path: 'edited.xyz', inputDataBase64: 'edited-inline', animation: { mode: 'trajectory' } });
  expect(calls[0].args.request).toMatchObject({ path: 'edited.xyz', inputDataBase64: 'edited-inline' });
});
