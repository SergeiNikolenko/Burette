import './mcp-viewer-csp.mjs';
import { App } from '@modelcontextprotocol/ext-apps';

// Connect once, then give the authorized session to exactly one renderer.
// Hosts can retain the original tool-to-resource URI across plugin upgrades.
export async function connectViewer(name, initialize) {
  const app = new App({ name, version: '1.0.0' }, {}, { autoResize: false });
  let started = false;
  const fail = message => {
    const status = document.getElementById('status');
    status.hidden = false;
    status.textContent = `Burette could not load: ${message}`;
  };
  app.ontoolresult = async result => {
    if (started) return;
    // Host entrypoints (the Codex file viewer) call the opener themselves, so
    // its error result is the only place the user can see why nothing opened.
    if (!result._meta?.session) {
      if (result.isError) fail(result.content?.find(item => item.type === 'text')?.text || 'the file could not be opened.');
      return;
    }
    started = true;
    try { await initialize(app, result); }
    catch (error) { fail(error.message); }
  };
  await app.connect();
  if (!started) await app.sendSizeChanged({ height: name === 'burette-native-workspace' ? 320 : 48 });
}
