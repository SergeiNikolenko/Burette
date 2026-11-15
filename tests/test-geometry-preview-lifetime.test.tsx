import { test, expect, React, act, createRoot, useGeometryLivePreview, flush, water, doc,
  transport, mount, ack, bindingFor, browser } from './geometry-foundation-fixture';
import type { ViewerDocument, ShellActions } from './geometry-foundation-fixture';
import type { GeometryBinding } from '../apps/desktop/src/lib/geometry-binding';
const { useAppMolstarActionSenders } = await import('../apps/desktop/src/hooks/use-app-molstar-action-senders');
const { activeViewerIframeForDocument } = await import('../apps/desktop/src/lib/viewer-bridge');

test('independent: a late old-document failure cannot publish into the next document error handler', async () => {
  const old = doc(), next = doc(), t = transport();
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  let api!: ReturnType<typeof useGeometryLivePreview>;
  const errors: { documentId: string; error: string }[] = [];
  function Probe({ current }: { current: ViewerDocument }) {
    api = useGeometryLivePreview(current, bindingFor(current), t.send, error => errors.push({ documentId: current.id, error: String(error) }));
    return null;
  }
  const render = async (current: ViewerDocument) => act(async () => root.render(<Probe current={current} />));
  try {
    await render(old); api.preview('old-preview', 'old-saved'); await flush(); await render(next);
    await act(async () => t.calls[0].reject(new Error('old-viewer-failure')));
    expect(errors.filter(error => error.documentId === next.id)).toEqual([]);
  } finally {
    for (const call of t.calls) await ack(call);
    await act(async () => root.unmount()); host.remove();
  }
});

test('independent: pending old preview cleanup cannot send its baseline into a replacement same-id iframe', async () => {
  const old = doc(), next = { ...old, path: '/replacement.xyz', title: 'replacement.xyz' };
  const oldPosts: { body: { id: string; action: { type: string; text: string } } }[] = [];
  const newPosts: { body: { id: string; action: { type: string; text: string } } }[] = [];
  const originalCss = Object.getOwnPropertyDescriptor(globalThis, 'CSS');
  Object.defineProperty(globalThis, 'CSS', { configurable: true, value: browser.CSS });
  function frame(posts: typeof oldPosts) {
    const element = document.createElement('iframe'); element.className = 'viewer-iframe';
    element.dataset.documentId = old.id; element.dataset.renderer = 'molstar'; document.body.append(element);
    Object.defineProperty(element.contentWindow!, 'postMessage', { configurable: true, value: (payload: (typeof posts)[number]) => posts.push(payload) });
    return element;
  }
  const oldFrame = frame(oldPosts), oldWindow = oldFrame.contentWindow!;
  let newFrame: HTMLIFrameElement | null = null;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  let api!: ReturnType<typeof useGeometryLivePreview>;
  function Probe({ current }: { current: ViewerDocument }) {
    const actions = useAppMolstarActionSenders({ activeDocument: current, documents: [current], activeViewerIframeForDocument, pushStatus: () => {} });
    api = useGeometryLivePreview(current, bindingFor(current), actions.runStructureViewerAction, () => {});
    return null;
  }
  const render = async (current: ViewerDocument) => act(async () => root.render(<Probe current={current} />));
  const respond = async (source: globalThis.Window, request: (typeof oldPosts)[number]) => act(async () => {
    browser.dispatchEvent(new browser.MessageEvent('message', { source: source as unknown as typeof browser,
      data: { source: 'burette-agent-viewer', body: { type: 'agent-action-result', id: request.body.id, result: { ok: true, result: {} } } } }));
  });
  try {
    await render(old); api.preview(water.replace('0.957200000123', '1.1'), water); await flush();
    expect(oldPosts).toHaveLength(1);
    oldFrame.remove(); newFrame = frame(newPosts); await render(next);
    await respond(oldWindow, oldPosts[0]);
    expect(newPosts.map(post => post.body.action.text)).toEqual([]);
  } finally {
    if (newFrame) for (const post of newPosts) await respond(newFrame.contentWindow!, post);
    await act(async () => root.unmount()); host.remove(); oldFrame.remove(); newFrame?.remove();
    if (originalCss) Object.defineProperty(globalThis, 'CSS', originalCss); else Reflect.deleteProperty(globalThis, 'CSS');
  }
});
test('same-model failures use the latest handler, but unmounted failures stay silent while rollback settles', async () => {
  const d = doc(), t = transport(), errors: string[] = [];
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  let api!: ReturnType<typeof useGeometryLivePreview>;
  function Probe({ label }: { label: string }) {
    api = useGeometryLivePreview(d, bindingFor(d), t.send, error => errors.push(`${label}:${String(error)}`)); return null;
  }
  try {
    await act(async () => root.render(<Probe label="first" />)); api.preview('first', 'saved'); await flush();
    await act(async () => root.render(<Probe label="latest" />));
    await act(async () => t.calls[0].reject(new Error('rejected')));
    expect(errors).toEqual(['latest:Error: rejected']);
    api.cancel(); await act(async () => {}); await ack(t.calls[1]);
    api.preview('second', 'saved'); await flush(); await act(async () => root.unmount());
    await act(async () => t.calls[2].reject(new Error('after unmount')));
    expect(errors).toEqual(['latest:Error: rejected']);
    expect(t.calls.map(call => call.text)).toEqual(['first', 'saved', 'second', 'saved']); await ack(t.calls[3]);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
test('queued writes and rollback retain their sender, target and lease until a new gesture', async () => {
  const d = doc(), a = transport(), b = transport(), binding = bindingFor(d);
  const sent: { sender: string; lease: string; target: unknown }[] = [];
  const wrap = (t: ReturnType<typeof transport>, name: string): ShellActions['runStructureViewerAction'] => (current, action, options) => {
    if (action.type !== 'update_geometry') throw new Error('Unexpected action');
    sent.push({ sender: name, lease: action.lease, target: options?.target }); return t.send(current, action, options);
  };
  const first = wrap(a, 'first'), next = wrap(b, 'next');
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  let api!: ReturnType<typeof useGeometryLivePreview>;
  function Probe({ send }: { send: ShellActions['runStructureViewerAction'] }) { api = useGeometryLivePreview(d, binding, send, () => {}); return null; }
  try {
    await act(async () => root.render(<Probe send={first} />)); api.preview('first', 'saved'); await flush();
    api.preview('queued', 'saved'); await flush(); await act(async () => root.render(<Probe send={next} />));
    await ack(a.calls[0]); expect(a.calls.map(call => call.text)).toEqual(['first', 'queued']); expect(b.calls).toHaveLength(0);
    await ack(a.calls[1]); api.cancel(); await act(async () => {}); await ack(a.calls[2]);
    api.preview('new gesture', 'saved'); await flush(); await ack(b.calls[0]); api.cancel(); await act(async () => {}); await ack(b.calls[1]);
    expect(sent.map(call => call.sender)).toEqual(['first', 'first', 'first', 'next', 'next']);
    expect(sent.every(call => call.lease === binding.lease && call.target === binding.target)).toBe(true);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
test('loading and retired model callbacks cannot acquire or publish a new edit', async () => {
  const d = doc(), t = transport(), binding = bindingFor(d);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  let api!: ReturnType<typeof useGeometryLivePreview>;
  function Probe({ current }: { current: GeometryBinding | null }) { api = useGeometryLivePreview(d, current, t.send, () => {}); return null; }
  try {
    await act(async () => root.render(<Probe current={null} />)); api.preview('loading', 'saved'); await flush();
    await expect(api.commit('loading', 'saved')).rejects.toThrow('wait for it to load'); expect(t.calls).toHaveLength(0);
    await act(async () => root.render(<Probe current={binding} />)); const retired = api;
    await act(async () => root.render(<Probe current={{ ...binding, text: 'new model' }} />));
    retired.preview('old work', 'saved'); await flush();
    await expect(retired.commit('old work', 'saved')).rejects.toThrow('cancelled');
    await expect(retired.replace(async () => {})).rejects.toThrow('cancelled'); expect(t.calls).toHaveLength(0);
    const done = api.commit('current', 'new model'); await act(async () => {}); await ack(t.calls[0]); await done;
    expect(t.calls.map(call => call.text)).toEqual(['current']);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
test('a queued topology replacement does not run after its model lifetime retires', async () => {
  const d = doc(), t = transport(), binding = bindingFor(d); let reloaded = false;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  let api!: ReturnType<typeof useGeometryLivePreview>;
  function Probe({ current }: { current: GeometryBinding }) { api = useGeometryLivePreview(d, current, t.send, () => {}); return null; }
  try {
    await act(async () => root.render(<Probe current={binding} />)); api.preview('transient', 'saved'); await flush();
    const replacing = api.replace(async () => { reloaded = true; }).catch(error => String(error));
    await act(async () => root.render(<Probe current={{ ...binding, text: 'new model' }} />));
    await ack(t.calls[0]); await ack(t.calls[1]);
    expect(await replacing).toContain('cancelled'); expect(reloaded).toBe(false);
    expect(t.calls.map(call => call.text)).toEqual(['transient', 'saved']);
    const done = api.commit('current', 'new model'); await act(async () => {}); await ack(t.calls[2]); await done;
  } finally { await act(async () => root.unmount()); host.remove(); }
});
test('model reads wait for rollback acknowledgement and guards detect a complete intervening gesture', async () => {
  const { waitForGeometryPreviewIdle } = await import('../apps/desktop/src/lib/geometry-preview-owners');
  const d = doc(), t = transport(), a = await mount(d, t.send); let ready = false;
  try {
    a.api().preview('transient', 'saved'); await flush();
    const read = waitForGeometryPreviewIdle(d.id).then(guard => { ready = true; return guard; });
    const other = await waitForGeometryPreviewIdle(doc().id); expect(other.isCurrent()).toBe(true); other.release();
    a.api().cancel(); await ack(t.calls[0]); expect(ready).toBe(false);
    await ack(t.calls[1]); const guard = await read; expect(guard.isCurrent()).toBe(true);
    a.api().preview('another', 'saved'); await flush(); await ack(t.calls[2]);
    a.api().cancel(); await act(async () => {}); await ack(t.calls[3]);
    expect(guard.isCurrent()).toBe(false); guard.release();
    const fresh = await waitForGeometryPreviewIdle(d.id); expect(fresh.isCurrent()).toBe(true); fresh.release();
  } finally { await a.close(); }
});
test('aborting an idle wait leaves the active preview owner and later readers intact', async () => {
  const { waitForGeometryPreviewIdle } = await import('../apps/desktop/src/lib/geometry-preview-owners');
  const d = doc(), t = transport(), a = await mount(d, t.send), b = await mount(d, t.send);
  try {
    a.api().preview('transient', 'saved'); await flush();
    const abort = new AbortController(), waiting = waitForGeometryPreviewIdle(d.id, abort.signal);
    abort.abort(); await expect(waiting).rejects.toThrow('cancelled');
    await expect(b.api().commit('foreign', 'saved')).rejects.toThrow('Another panel');
    a.api().cancel(); await ack(t.calls[0]); await ack(t.calls[1]);
    const guard = await waitForGeometryPreviewIdle(d.id); expect(guard.isCurrent()).toBe(true); guard.release();
  } finally { await a.close(); await b.close(); }
});
