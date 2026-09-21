import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';

// A protocol/rendering fixture, deliberately not a claim of native-host support.
const frame = document.querySelector('iframe');
let exchangeCount = 0;
let renderedPlugin;
let theme = 'light';
let inlineWidth = '95vw';
const runtimeErrors = [];
frame.addEventListener('load', () => {
  const inspected = new WeakSet();
  const inspect = target => {
    if (inspected.has(target)) return;
    inspected.add(target);
    target.addEventListener('error', event => { if (event.message) runtimeErrors.push(event.message.slice(0, 500)); });
    target.addEventListener('unhandledrejection', event => runtimeErrors.push(String(event.reason?.stack || event.reason).slice(0, 1000)));
    target.addEventListener('securitypolicyviolation', event => runtimeErrors.push({
      kind: 'csp', directive: event.violatedDirective, blockedURI: event.blockedURI,
      sourceFile: event.sourceFile?.slice(0, 300), line: event.lineNumber,
      column: event.columnNumber, sample: event.sample?.slice(0, 160),
    }));
    const scan = () => target.document.querySelectorAll('iframe').forEach(child => { child.addEventListener('load', () => inspect(child.contentWindow), { once: true }); });
    new target.MutationObserver(scan).observe(target.document, { childList: true, subtree: true });
    scan();
  };
  inspect(frame.contentWindow);
});
const bridge = new AppBridge(null, { name: 'Burette test host', version: '1.0.0' }, { serverTools: {}, updateModelContext: { text: {}, image: {} } }, {
  hostContext: { displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'], theme: 'light' },
});
bridge.onupdatemodelcontext = async context => {
  let output = document.getElementById('selection-context');
  if (!output) {
    output = document.createElement('pre');
    output.id = 'selection-context';
    document.body.appendChild(output);
  }
  const images = context.content?.filter(item => item.type === 'image') || [];
  output.textContent = JSON.stringify({
    text: context.content?.filter(item => item.type === 'text').map(item => item.text),
    selection: context.structuredContent?.burette?.activeSelection?.residues || [],
    images: images.map(item => ({ mimeType: item.mimeType, base64Bytes: item.data.length })),
  });
  return {};
};
bridge.oncalltool = async request => {
  exchangeCount++;
  return (await fetch('/exchange', { method: 'POST', body: JSON.stringify(request.arguments) })).json();
};
for (const [label, action] of [
  ['Chat height 600', () => { frame.style.height = '600px'; }],
  ['Chat height 320', () => { frame.style.height = '320px'; }],
  ['Chat width 736', () => { inlineWidth = '736px'; frame.style.width = inlineWidth; }],
  ['Chat width 420', () => { inlineWidth = '420px'; frame.style.width = inlineWidth; }],
  ['Toggle host theme', () => { theme = theme === 'light' ? 'dark' : 'light'; bridge.setHostContext({ theme }); }],
  ['Simulate host pane close', () => bridge.setHostContext({ displayMode: 'inline' })],
  ['Inspect renderer lifetime', () => {
    const viewer = frame.contentWindow;
    const children = [...viewer.document.querySelectorAll('iframe')].map(child => child.contentWindow);
    renderedPlugin ||= viewer.BuretteViewer?.plugin || children.find(child => child.BuretteViewer?.plugin)?.BuretteViewer.plugin;
    let report = document.getElementById('lifetime-report');
    if (!report) { report = document.createElement('pre'); report.id = 'lifetime-report'; document.body.prepend(report); }
    report.textContent = JSON.stringify({ exchangeCount, viewport: { width: frame.clientWidth, height: frame.clientHeight }, canvases: [viewer, ...children].reduce((count, child) => count + child.document.querySelectorAll('canvas').length, 0),
      frames: children.length, assets: viewer.BuretteMcpWorkspace?.snapshot(), usedJSHeapBytes: viewer.performance.memory?.usedJSHeapSize,
      runtimeErrors: runtimeErrors.slice(-20),
      viewerPresent: Boolean(viewer.BuretteViewer), agentAttached: Boolean(viewer.BuretteAgent?._state.plugin),
      sourceRetained: Boolean(viewer.BuretteDataBytes), closed: viewer.BuretteViewerDisposed === true || viewer.BuretteMcpWorkspace?.closed === true,
      webglContextLost: renderedPlugin?.canvas3dContext?.webgl.gl.isContextLost() });
  }],
]) {
  const button = document.createElement('button');
  button.textContent = label;
  button.onclick = action;
  document.body.prepend(button);
}
bridge.onrequestdisplaymode = async ({ mode }) => {
  frame.style.width = mode === 'fullscreen' ? '95vw' : inlineWidth;
  frame.style.height = mode === 'fullscreen' ? '85vh' : '240px';
  bridge.setHostContext({ displayMode: mode, availableDisplayModes: ['inline', 'fullscreen'], theme });
  return { mode };
};
bridge.onsizechange = ({ width, height }) => {
  if (Number.isFinite(width) && width > 0) frame.style.width = `${width}px`;
  if (Number.isFinite(height) && height > 0) frame.style.height = `${height}px`;
};
bridge.oninitialized = async () => {
  await bridge.sendToolInput({ arguments: {} });
  await bridge.sendToolResult(await (await fetch('/result')).json());
};
await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow));
frame.src = '/viewer';
