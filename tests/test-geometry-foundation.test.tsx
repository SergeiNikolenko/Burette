import { test, expect, React, act, createRoot, ConstraintToggle, geometryBase, geometryText,
  withInternalCoordinate, flush, water, doc, transport, mount, ack } from './geometry-foundation-fixture';

test('Cartesian edits retain unchanged source lines and near-linear transverse precision', () => {
  const base = geometryBase(water), edited = geometryText(base, withInternalCoordinate(base.rows, 1, 0, 1.234567890123));
  expect(edited.split('\n').slice(0, 3)).toEqual(water.split('\n').slice(0, 3));
  expect(geometryBase(edited).rows[1].values[0]).toBeCloseTo(1.234567890123, 11);
  const near = geometryText(base, withInternalCoordinate(base.rows, 2, 1, 179.999999));
  expect(geometryBase(near).rows[2].values[1]).toBeCloseTo(179.999999, 7);
  expect(geometryText(base, base.rows)).toBe(water);
});
test('coalesced previews commit after ACK, exclude other owners and release after settled commit', async () => {
  const d = doc(), t = transport(), a = await mount(d, t.send), b = await mount(d, t.send);
  try {
    a.api().preview('first', 'saved'); a.api().preview('latest', 'saved'); await flush();
    expect(t.calls.map(call => call.text)).toEqual(['latest']);
    b.api().preview('foreign', 'saved'); await flush(); expect(t.calls).toHaveLength(1);
    let finished = false; const done = a.api().commit('committed', 'saved').then(() => { finished = true; });
    await act(async () => {}); expect(finished).toBe(false); await ack(t.calls[0]);
    expect(t.calls.map(call => call.text)).toEqual(['latest', 'committed']); await ack(t.calls[1]); await done;
    b.api().preview('next-owner', 'committed'); await flush(); expect(t.calls[2].text).toBe('next-owner'); await ack(t.calls[2]);
    b.api().cancel(); await act(async () => {}); await ack(t.calls[3]);
  } finally { await a.close(); await b.close(); }
});
test('cancel after an outstanding commit rejects it and restores baseline after its late ACK', async () => {
  const t = transport(), a = await mount(doc(), t.send);
  try {
    const commit = a.api().commit('changed', 'saved').catch(error => error.message); await act(async () => {});
    a.api().cancel(); expect(t.calls.map(call => call.text)).toEqual(['changed']);
    await ack(t.calls[0]); expect(await commit).toBe('Geometry edit cancelled.');
    expect(t.calls.map(call => call.text)).toEqual(['changed', 'saved']); await ack(t.calls[1]);
  } finally { await a.close(); }
});
test('failed preview reports error; rollback remains serialized and another surface waits', async () => {
  const d = doc(), t = transport(), a = await mount(d, t.send), b = await mount(d, t.send);
  try {
    a.api().preview('changed', 'saved'); await flush();
    await act(async () => t.calls[0].reject(new Error('viewer rejected'))); expect(a.errors.map(String)).toEqual(['Error: viewer rejected']);
    a.api().cancel(); await act(async () => {});
    await expect(b.api().commit('foreign', 'saved')).rejects.toThrow('Another panel');
    await ack(t.calls[1]); const done = b.api().commit('accepted', 'saved'); await act(async () => {}); await ack(t.calls[2]); await done;
  } finally { await a.close(); await b.close(); }
});
test('replacement restores pending geometry before reload and holds ownership until reload settles', async () => {
  const d = doc(), t = transport(), a = await mount(d, t.send), b = await mount(d, t.send); let finish!: () => void; let started = false;
  try {
    a.api().preview('transient', 'saved'); await flush();
    const replacing = a.api().replace(() => { started = true; return new Promise<void>(resolve => { finish = resolve; }); });
    await ack(t.calls[0]); expect(started).toBe(false); expect(t.calls[1].text).toBe('saved'); await ack(t.calls[1]); expect(started).toBe(true);
    await expect(b.api().commit('foreign', 'saved')).rejects.toThrow('Another panel');
    await act(async () => finish()); await replacing;
    const done = b.api().commit('new-scene', 'saved'); await act(async () => {}); await ack(t.calls[2]); await done;
  } finally { await a.close(); await b.close(); }
});
test('unmount queues baseline restoration behind outstanding preview without publishing another document', async () => {
  const d = doc(), t = transport(), a = await mount(d, t.send);
  a.api().preview('transient', 'saved'); await flush(); await a.close(); await ack(t.calls[0]);
  expect(t.calls.map(call => [call.document.id, call.text])).toEqual([[d.id, 'transient'], [d.id, 'saved']]); await ack(t.calls[1]);
});
test('constraint pin exposes pressed/disabled state and suppresses row click while toggling', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); let toggled = 0, row = 0;
  const render = async (active: boolean, unavailable?: string) => act(async () => root.render(<div onClick={() => row++}><ConstraintToggle label="Freeze atom" active={active} disabled={false} unavailable={unavailable} onToggle={() => toggled++} /></div>));
  try {
    await render(false); const button = host.querySelector('button')!; expect([button.getAttribute('aria-label'), button.getAttribute('aria-pressed')]).toEqual(['Freeze atom', 'false']);
    await act(async () => button.click()); expect([toggled, row]).toEqual([1, 0]);
    await render(true, 'Reference points cannot be frozen'); expect([host.querySelector('button')!.disabled, host.querySelector('button')!.getAttribute('aria-pressed')]).toEqual([true, 'true']);
    await act(async () => host.querySelector('button')!.click()); expect(toggled).toBe(1);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
