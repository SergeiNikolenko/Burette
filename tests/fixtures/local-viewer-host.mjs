import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';

// A protocol/rendering fixture, deliberately not a claim of native-host support.
const frame = document.querySelector('iframe');
const bridge = new AppBridge(null, { name: 'Burette test host', version: '1.0.0' }, { serverTools: {} }, {
  hostContext: { displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'], theme: 'light' },
});
bridge.oncalltool = async request => (await fetch('/exchange', { method: 'POST', body: JSON.stringify(request.arguments) })).json();
bridge.onrequestdisplaymode = async ({ mode }) => {
  frame.style.height = mode === 'fullscreen' ? '85vh' : '520px';
  bridge.setHostContext({ displayMode: mode, availableDisplayModes: ['inline', 'fullscreen'], theme: 'light' });
  return { mode };
};
bridge.oninitialized = async () => {
  await bridge.sendToolInput({ arguments: {} });
  await bridge.sendToolResult(await (await fetch('/result')).json());
};
await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow));
frame.src = '/viewer';
