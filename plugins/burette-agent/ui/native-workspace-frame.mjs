// Each embedded component evaluates its modules in its own document. The
// parent supplies checked assets and transport, while the component owns UI.
async function startFrame(path, baseHref) {
  const parentBridge = window.parent.BuretteMcpWorkspace;
  const frameTheme = document.querySelector('meta[name="burette-frame-theme"]')?.content;
  if (frameTheme === 'dark' || frameTheme === 'light') {
    document.documentElement.classList.toggle('dark', frameTheme === 'dark');
    document.documentElement.classList.toggle('light', frameTheme === 'light');
    document.documentElement.style.colorScheme = frameTheme;
  }
  if (baseHref) Object.defineProperty(document, 'baseURI', { get: () => baseHref, configurable: true });
  const mapped = new Set();
  let queue = Promise.resolve();
  async function importModule(name) {
    const prepare = queue.then(async () => {
      const prepared = await parentBridge.prepareModule(name);
      const imports = Object.fromEntries(Object.entries(prepared.imports).filter(([key]) => !mapped.has(key)));
      if (Object.keys(imports).length) {
        const map = document.createElement('script');
        map.type = 'importmap';
        map.textContent = JSON.stringify({ imports });
        document.head.append(map);
        Object.keys(imports).forEach(key => mapped.add(key));
      }
      return prepared.url;
    });
    queue = prepare.catch(() => {});
    return import(await prepare);
  }
  window.BuretteMcpWorkspace = {
    ...parentBridge, importModule,
    importModuleAt: (base, name) => importModule(parentBridge.resolve(name, base)),
  };
  window.BuretteResolveRuntimeAsset = name => parentBridge.asset(parentBridge.resolve(name, path));
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, options) => {
    const url = new URL(input instanceof Request ? input.url : input, baseHref || document.baseURI);
    return url.origin === 'https://burette.invalid'
      ? parentBridge.response(parentBridge.resolve(url.href))
      : originalFetch(input, options);
  };
  for (const pending of document.querySelectorAll('script[data-burette-frame-script]')) {
    const name = pending.dataset.buretteFrameScript;
    if (pending.dataset.module === 'true') await importModule(name);
    else {
      const source = await parentBridge.asset(name);
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = source;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Could not load ${name}`));
        document.body.append(script);
      });
    }
  }
}

export async function prepareWorkspaceFrame(path, assets, hostOrigin) {
  const response = await assets.response(path);
  const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
  doc.querySelectorAll('base').forEach(node => node.remove());
  const baseHref = assets.moduleBase(path);
  const parentTheme = (typeof document !== 'undefined' && (document.documentElement?.dataset?.theme === 'dark' || document.documentElement?.dataset?.theme === 'light'))
    ? document.documentElement.dataset.theme
    : (typeof window !== 'undefined' && (window.BuretteMcpWorkspace?.theme === 'dark' || window.BuretteMcpWorkspace?.theme === 'light'))
      ? window.BuretteMcpWorkspace.theme
      : (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches)
        ? 'dark'
        : 'light';
  let parentBg = '';
  try {
    if (typeof getComputedStyle === 'function' && typeof document !== 'undefined' && document.documentElement) {
      parentBg = getComputedStyle(document.documentElement).getPropertyValue('--burette-host-background').trim();
    }
  } catch (_) {}
  if (!/^#[0-9a-f]{3,8}$|^rgba?\(/iu.test(parentBg)) parentBg = parentTheme === 'dark' ? '#181818' : '#ffffff';
  if (parentTheme === 'dark') doc.documentElement.classList.add('dark');
  const themeMeta = doc.createElement('meta');
  themeMeta.name = 'burette-frame-theme';
  themeMeta.content = parentTheme;
  doc.head.prepend(themeMeta);
  const themeStyle = doc.createElement('style');
  themeStyle.textContent = `html,body{color-scheme:${parentTheme};background:${parentBg}}`;
  doc.head.prepend(themeStyle);
  const origin = doc.createElement('meta');
  origin.name = 'burette-host-origin';
  origin.content = hostOrigin;
  doc.head.append(origin);
  for (const link of doc.querySelectorAll('link[rel="stylesheet"]')) {
    link.href = await assets.asset(assets.resolve(link.getAttribute('href'), path));
  }
  doc.querySelectorAll('link[rel="modulepreload"]').forEach(node => node.remove());
  for (const script of doc.querySelectorAll('script[src]')) {
    script.dataset.buretteFrameScript = assets.resolve(script.getAttribute('src'), path);
    script.dataset.module = String(script.type === 'module');
    script.type = 'application/burette-pending';
    script.removeAttribute('src');
  }
  const bootstrap = doc.createElement('script');
  bootstrap.type = 'module';
  bootstrap.textContent = `(${startFrame.toString()})(${JSON.stringify(path).replaceAll('<', '\\u003c')}, ${JSON.stringify(baseHref).replaceAll('<', '\\u003c')}).catch(error => {
    document.body.textContent = error.message;
    parent.postMessage({ source: 'burette-molecular-frame', type: 'error', value: { message: error.message } }, ${JSON.stringify(hostOrigin)});
  });`;
  doc.body.append(bootstrap);
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
