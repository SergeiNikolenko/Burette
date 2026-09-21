// Transport adapter for the shared build: executable modules remain modules,
// including cycles and lazy imports. No eval, HTTP listener, or CDN fallback.
export function createWorkspaceAssets({ manifest, exchange, isClosed, onProgress = () => {} }) {
  const assets = new Map();
  const mapped = new Set();
  const urls = new Set();
  let moduleQueue = Promise.resolve();
  let activeReads = 0;
  let transferredBytes = 0;
  const waitingReads = [];
  async function readChunk(request) {
    if (activeReads >= 4) await new Promise(resolve => waitingReads.push(resolve));
    else activeReads += 1;
    try { assertOpen(); return await exchange(request); }
    finally {
      const next = waitingReads.shift();
      if (next) next();
      else activeReads -= 1;
    }
  }
  const originalFetch = window.fetch.bind(window);
  const assertOpen = () => { if (isClosed()) throw new Error('Burette workspace is closed.'); };
  const resolve = (path, base = 'shell/index.js') => {
    const url = new URL(path, `https://burette.invalid/${base}`);
    if (url.origin !== 'https://burette.invalid') throw new Error('External workspace assets are not allowed.');
    return url.pathname.replace(/^\/(?:__burette\/)?/u, '');
  };
  async function asset(path) {
    assertOpen();
    const entry = Object.hasOwn(manifest.assets, path) ? manifest.assets[path] : null;
    if (!entry) throw new Error(`Unknown workspace asset: ${path}`);
    if (!assets.has(path)) assets.set(path, (async () => {
      const chunkBytes = 192 * 1024;
      if (!Number.isSafeInteger(entry.packedBytes) || entry.packedBytes < 1 || entry.packedBytes > 24 * 1024 * 1024) throw new Error('Invalid workspace asset bounds.');
      // Offsets are known from the manifest; chunks need not
      // wait for the previous round trip. The workspace-wide pool stays at 4.
      const chunks = await Promise.all(Array.from({ length: Math.ceil(entry.packedBytes / chunkBytes) }, async (_, index) => {
        const offset = index * chunkBytes;
        assertOpen();
        const part = await readChunk({ asset: { path, offset } });
        assertOpen();
        const bytes = Uint8Array.from(atob(part.dataBase64), c => c.charCodeAt(0));
        const end = Math.min(offset + chunkBytes, entry.packedBytes);
        if (bytes.length !== end - offset) throw new Error('Workspace asset is incomplete.');
        // Native hosts may omit null fields on the terminal chunk.
        if ((part.nextOffset ?? null) !== (end < entry.packedBytes ? end : null)) throw new Error('Invalid workspace asset continuation.');
        transferredBytes += bytes.length;
        onProgress({ transferredBytes });
        return bytes;
      }));
      const buffer = await new Response(new Blob(chunks).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      if (buffer.byteLength !== entry.byteCount) throw new Error('Workspace asset size mismatch.');
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(value => value.toString(16).padStart(2, '0')).join('');
      if (digest !== entry.sha256) throw new Error('Workspace asset integrity check failed.');
      assertOpen();
      let contents = buffer;
      if (entry.resources?.length) {
        contents = new TextDecoder().decode(buffer);
        for (const resource of entry.resources) contents = contents.replaceAll(JSON.stringify(`burette-packaged:${resource}`), JSON.stringify(await asset(resource)));
      }
      if (entry.mimeType === 'text/css') {
        let css = new TextDecoder().decode(buffer);
        const references = [...css.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/gu)].filter(match => !match[1].startsWith('data:') && !match[1].startsWith('#'));
        for (const match of references) css = css.replace(match[0], `url("${await asset(resolve(match[1], path))}")`);
        contents = css;
      }
      assertOpen();
      const url = URL.createObjectURL(new Blob([contents], { type: entry.mimeType }));
      urls.add(url);
      return url;
    })().catch(error => { assets.delete(path); throw error; }));
    return assets.get(path);
  }
  async function importModule(path) {
    // Serialize import-map extension, but not module evaluation: a module may
    // itself await a lazy import while being evaluated.
    const prepare = moduleQueue.then(async () => {
      assertOpen();
      const needed = new Set();
      const visit = name => {
        if (needed.has(name) || mapped.has(name)) return;
        const entry = manifest.assets[name];
        if (!entry || entry.mimeType !== 'text/javascript') throw new Error(`Unknown workspace module: ${name}`);
        needed.add(name);
        entry.dependencies.forEach(visit);
      };
      visit(path);
      const imports = {};
      // readChunk owns the workspace-wide concurrency limit. Do not leave its
      // slots idle while a slow member of an arbitrary four-module batch ends.
      const names = [...needed];
      await Promise.all(names.map(async name => { imports[`burette:${name}`] = await asset(name); }));
      assertOpen();
      if (names.length) {
        const map = document.createElement('script');
        map.type = 'importmap';
        map.textContent = JSON.stringify({ imports });
        document.head.appendChild(map);
        names.forEach(name => mapped.add(name));
      }
      return asset(path);
    });
    moduleQueue = prepare.catch(() => {});
    return import(await prepare);
  }
  return {
    asset, importModule, resolve,
    importModuleAt: (base, path) => importModule(resolve(path, base)),
    moduleBase: path => `https://burette.invalid/${path}`,
    response: async path => originalFetch(await asset(path)),
    dispose() { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); assets.clear(); mapped.clear(); },
    snapshot: () => ({ loadedAssetCount: urls.size, loadedModuleCount: mapped.size }),
  };
}
