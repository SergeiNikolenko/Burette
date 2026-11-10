/** Shared molecular frame client. Serve this directory unchanged in each host. */
export function readMolecularAppearance(container) {
  const style = getComputedStyle(container);
  const variables = {};
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;';
  container.append(probe);
  for (const key of ['background', 'foreground', 'popover', 'muted', 'muted-foreground', 'accent', 'border', 'destructive']) {
    if (!style.getPropertyValue(`--${key}`).trim()) continue;
    probe.style.color = `var(--${key})`;
    variables[key] = getComputedStyle(probe).color;
  }
  probe.remove();
  variables.foreground ??= style.color;
  variables['font-sans'] = style.fontFamily;
  return {
    theme: document.documentElement.classList.contains('dark') || style.colorScheme === 'dark' ? 'dark' : 'light',
    locale: document.documentElement.lang,
    variables,
  };
}

export function createMolecularEditor(container, options = {}) {
  const base = new URL(options.base ?? './', import.meta.url);
  const transport = window.BuretteMcpWorkspace;
  const sameHost = base.protocol === location.protocol && base.host === location.host;
  const frameOrigin = transport || sameHost ? window.origin : base.origin;
  const element = document.createElement('iframe');
  element.title = options.title ?? 'Molecular editor';
  element.allow = 'fullscreen; clipboard-read; clipboard-write';
  element.style.cssText = 'display:block;width:100%;height:100%;border:0;';
  const url = new URL('index.html', base);
  url.searchParams.set('hostOrigin', window.origin);
  const pending = new Map();
  const listeners = new Map(['change', 'state', 'error'].map(name => [name, new Set()]));
  let sequence = 0;
  let disposed = false;
  let loaded = false;
  let resolveReady, rejectReady;
  const mounted = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const timer = setTimeout(() => rejectReady(new Error('The molecular editor did not start')), 60_000);
  function request(command, value) {
    if (disposed) return Promise.reject(new Error('The molecular frame was closed'));
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error('The molecular editor did not respond')); }, 30_000);
      pending.set(id, { resolve, reject, timeout });
      element.contentWindow.postMessage({ source: 'burette-molecular-host', id, command, value }, frameOrigin === 'null' ? '*' : frameOrigin);
    });
  }
  function receive(event) {
    const message = event.data;
    if (event.source !== element.contentWindow || event.origin !== frameOrigin || message?.source !== 'burette-molecular-frame') return;
    if (message.type === 'openFile') { options.onOpenFile?.(); }
    else if (message.type === 'ready') { loaded = true; clearTimeout(timer); resolveReady(); }
    else if (message.type === 'result') {
      const item = pending.get(message.value?.id);
      if (!item) return;
      pending.delete(message.value.id);
      clearTimeout(item.timeout);
      if (message.value.ok) item.resolve(message.value.value);
      else item.reject(new Error(message.value.error));
    } else for (const listener of listeners.get(message.type) ?? []) listener(message.value);
  }
  window.addEventListener('message', receive);
  if (transport) {
    transport.prepareFrame(transport.resolve(url.href)).then(html => {
      if (disposed) return;
      element.srcdoc = html;
      container.append(element);
    }).catch(rejectReady);
  } else {
    element.src = url.href;
    container.append(element);
  }
  const syncAppearance = () => request('appearance', { ...readMolecularAppearance(container), openFile: Boolean(options.onOpenFile) });
  const observer = new MutationObserver(() => { if (loaded) void syncAppearance().catch(() => {}); });
  for (let ancestor = container; ancestor; ancestor = ancestor.parentElement) observer.observe(ancestor, { attributes: true, attributeFilter: ['class', 'style', 'lang'] });
  const ready = mounted.then(syncAppearance);
  return {
    element, ready,
    get editor() {
      if (!loaded || disposed) throw new Error('The molecular editor is not ready');
      if (frameOrigin !== window.origin) throw new Error('Synchronous editing requires a same-origin frame');
      return element.contentWindow.BuretteMolecularEditor;
    },
    async load(text) { await ready; return request('load', text); },
    async snapshot() { await ready; return request('snapshot'); },
    async svg() { await ready; return request('svg'); },
    async command(name) { await ready; return request('command', name); },
    async setZoom(zoom) { await ready; return request('zoom', zoom); },
    syncAppearance,
    on(name, listener) {
      const set = listeners.get(name);
      if (!set) throw new Error('Unknown molecular event');
      set.add(listener);
      return () => set.delete(listener);
    },
    destroy() {
      disposed = true;
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener('message', receive);
      const error = new DOMException('Molecular frame closed', 'AbortError');
      rejectReady(error);
      for (const item of pending.values()) { clearTimeout(item.timeout); item.reject(error); }
      pending.clear();
      for (const set of listeners.values()) set.clear();
      element.remove();
    },
  };
}
