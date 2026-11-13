const VERSION = __BURETTE_EMBED_VERSION__;
const LOAD_TIMEOUT_MS = 60_000;
const COMMAND_TIMEOUT_MS = 30_000;
const MAX_SCENE_BYTES = 100 * 1024 * 1024;
const THEMES = new Set(['light', 'dark', 'auto']);
const EVENTS = new Set(['ready', 'pose', 'frame', 'smoothing', 'selection', 'error', 'export']);
const DEFAULT_BASE = new URL('./', import.meta.url);

async function fetchFile(url, name, signal) {
  const response = await fetch(url, { credentials: 'same-origin', signal });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`${name} is empty.`);
  const chunks = [];
  let bytes = 0;
  try {
    if (Number(response.headers.get('Content-Length')) > MAX_SCENE_BYTES) {
      throw new Error(`${name} is larger than 100 MiB.`);
    }
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      bytes += next.value.byteLength;
      if (bytes > MAX_SCENE_BYTES) throw new Error(`${name} is larger than 100 MiB.`);
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return new Blob(chunks);
}

async function fileBytes(file, role, signal) {
  if (!file || typeof file !== 'object') throw new TypeError(`${role} must be an object.`);
  const url = file.url && new URL(file.url, document.baseURI);
  const name = String(file.name || url?.pathname.split('/').pop() || role);
  let data = file.data;
  if (data == null && url) data = await fetchFile(url, name, signal);
  signal.throwIfAborted();
  if (data instanceof Blob) {
    if (data.size > MAX_SCENE_BYTES) throw new Error(`${name} is larger than 100 MiB.`);
    data = await data.arrayBuffer();
  } else if (ArrayBuffer.isView(data)) {
    data = new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
  }
  if (typeof data === 'string') data = new TextEncoder().encode(data);
  if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) throw new TypeError(`${role} needs data or url.`);
  if (!data.byteLength) throw new Error(`${name} is empty.`);
  return { name, format: file.format, data };
}

const fileList = value => value == null ? [] : Array.isArray(value) ? value : [value];

function downloadExport({ name, mimeType, text, base64 }) {
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text)
    : Uint8Array.from(atob(base64 || ''), char => char.charCodeAt(0));
  const href = URL.createObjectURL(new Blob([bytes], { type: mimeType || 'application/octet-stream' }));
  const link = Object.assign(document.createElement('a'), { href, download: name.split(/[\\/]/u).pop() || 'structure' });
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/** Mounts a Burette 3D viewer into a container with a defined height. */
export function createBuretteViewer(container, options = {}) {
  const base = new URL(options.base ?? DEFAULT_BASE, document.baseURI);
  const transport = window.BuretteMcpWorkspace;
  const sameHost = base.protocol === location.protocol && base.host === location.host;
  const frameOrigin = transport || sameHost ? window.origin : base.origin;
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const listeners = new Map([...EVENTS].map(name => [name, new Set()]));
  const pending = new Map();
  let theme = options.theme ?? 'auto';
  let appearance = options.appearance ?? {};
  if (!THEMES.has(theme)) throw new TypeError('Unknown viewer theme.');
  let session;
  let serial = 0;
  let destroyed = false;

  function emit(name, detail) {
    const subscribers = listeners.get(name);
    if (name === 'export' && !subscribers.size) downloadExport(detail);
    for (const listener of subscribers) {
      try { listener(detail); }
      catch (error) { window.reportError(error); }
    }
  }

  function onMessage(event) {
    const message = event.data;
    if (event.source !== session?.element.contentWindow || event.origin !== frameOrigin || message?.source !== 'burette-embed') return;
    if (message.type === 'frame-ready') {
      const request = pending.get('frame');
      if (message.version === VERSION) request?.resolve();
      else request?.reject(new Error('Burette viewer assets are from different builds.'));
    } else if (message.type === 'result') {
      const request = pending.get(message.id);
      if (message.ok) request?.resolve(message.result);
      else request?.reject(new Error(message.error));
    } else if (message.type === 'pose') {
      const { index, sourceRecordId, count, mode, file } = message;
      emit('pose', { index, sourceRecordId, count, mode, file });
    } else if (message.type === 'frame') {
      const { index, playing, segment } = message;
      emit('frame', { index, playing, segment });
    } else if (message.type === 'smoothing') emit('smoothing', { view: message.view });
    else if (message.type === 'selection') emit('selection', { selection: message.selection });
    else if (message.type === 'error' && session.ready) emit('error', { message: message.message });
    else if (message.type === 'export') emit('export', { name: message.name, mimeType: message.mimeType, text: message.text, base64: message.base64 });
  }
  window.addEventListener('message', onMessage);

  function stop(reason) {
    const previous = session;
    session = undefined;
    previous?.controller.abort(reason);
    previous?.element.remove();
    for (const request of pending.values()) request.reject(reason);
  }

  function waitFor(id, timeout, description, send) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(reject, new DOMException(`${description} timed out.`, 'TimeoutError')), timeout);
      function finish(settle, value) {
        clearTimeout(timer);
        pending.delete(id);
        settle(value);
      }
      pending.set(id, { resolve: value => finish(resolve, value), reject: error => finish(reject, error) });
      try { send(); } catch (error) { finish(reject, error); }
    });
  }

  function request(current, type, payload, timeout = COMMAND_TIMEOUT_MS) {
    current.controller.signal.throwIfAborted();
    const id = `c${++serial}`;
    return waitFor(id, timeout, type, () => {
      current.element.contentWindow.postMessage({ source: 'burette-embed-host', id, type, ...payload }, frameOrigin === 'null' ? '*' : frameOrigin);
    });
  }

  async function command(type, payload) {
    if (!session?.ready) throw new Error('The viewer has no ready scene.');
    const current = session;
    try {
      return await request(current, type, payload);
    } catch (error) {
      // Discard a timed-out queue so a rejected command cannot apply later.
      if (error.name === 'TimeoutError' && session === current) {
        stop(error);
        emit('error', { message: error.message });
      }
      throw error;
    }
  }

  return {
    version: VERSION,
    get element() { return session?.element ?? null; },
    async open(scene) {
      if (destroyed) throw new Error('The viewer was destroyed.');
      stop(new DOMException('A new scene replaced this one.', 'AbortError'));
      const element = document.createElement('iframe');
      element.title = options.title ?? 'Molecular structure';
      element.allow = 'fullscreen; clipboard-write';
      element.style.cssText = 'display:block;width:100%;height:100%;border:0;';
      const controller = new AbortController();
      const current = session = { controller, element, ready: false };
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(LOAD_TIMEOUT_MS)]);
        const [structure, poses, trajectory] = await Promise.all([
          fileBytes(scene?.structure, 'structure', signal),
          Promise.all(fileList(scene?.poses).map(file => fileBytes(file, 'poses', signal))),
          Promise.all(fileList(scene?.trajectory).map(file => fileBytes(file, 'trajectory', signal)))
        ]);
        signal.throwIfAborted();
        if ([structure, ...poses, ...trajectory].reduce((total, file) => total + file.data.byteLength, 0) > MAX_SCENE_BYTES) {
          throw new Error('The scene is larger than 100 MiB.');
        }
        const url = new URL(`index.html?v=${VERSION}&theme=${theme}`, base);
        const html = transport ? await transport.prepareFrame(transport.resolve(url.href)) : null;
        signal.throwIfAborted();
        await waitFor('frame', COMMAND_TIMEOUT_MS, 'Starting Burette', () => {
          if (html !== null) element.srcdoc = html;
          else element.src = url.href;
          container.append(element);
        });
        const openingTheme = theme;
        await request(current, 'open', { scene: { structure, poses, trajectory, activePose: scene.activePose, theme: openingTheme, appearance } }, LOAD_TIMEOUT_MS);
        controller.signal.throwIfAborted();
        let appliedTheme = openingTheme;
        while (appliedTheme !== theme) {
          appliedTheme = theme;
          await request(current, 'setTheme', { theme: appliedTheme });
        }
        current.ready = true;
        await command('setAppearance', { appearance });
        emit('ready', {});
      } catch (error) {
        if (session === current) {
          stop(error);
          emit('error', { message: String(error?.message || error) });
        }
        throw error;
      }
    },
    setPose: index => command('setPose', { index }),
    setPoseRecord: (sourceRecordId, file = 0) => command('setPose', { sourceRecordId, file }),
    setFrame: index => command('setFrame', { index }),
    play: () => command('setPlayback', { playing: true }),
    pause: () => command('setPlayback', { playing: false }),
    setSmoothing: on => command('setSmoothing', { on: on === true }),
    setPoseMode: mode => command('setPoseMode', { mode }),
    focusLigand: () => command('focusLigand'),
    resetCamera: () => command('resetCamera'),
    capture: ({ width, height, format, axes, transparent } = {}) => command('capture', { width, height, format, axes, transparent }),
    async setTheme(next) {
      if (!THEMES.has(next)) throw new TypeError('Unknown viewer theme.');
      theme = next;
      if (session?.ready) await command('setTheme', { theme });
    },
    async setAppearance(next) {
      appearance = { ...next };
      if (session?.ready) await command('setAppearance', { appearance });
    },
    on(name, listener) {
      if (!EVENTS.has(name)) throw new TypeError(`Unknown event: ${name}`);
      listeners.get(name).add(listener);
      return () => listeners.get(name).delete(listener);
    },
    destroy() {
      destroyed = true;
      window.removeEventListener('message', onMessage);
      stop(new DOMException('The viewer was destroyed.', 'AbortError'));
      for (const subscribers of listeners.values()) subscribers.clear();
    }
  };
}
