import './mcp-viewer-csp.mjs';
import { App } from '@modelcontextprotocol/ext-apps';

// Connect once, then give the authorized session to exactly one renderer.
// Hosts can retain the original tool-to-resource URI across plugin upgrades.
export async function connectViewer(name, initialize) {
  const app = new App({ name, version: '1.0.0' }, {}, { autoResize: false });
  let started = false;
  app.ontoolresult = async result => {
    if (started || !result._meta?.session) return;
    started = true;
    try { await initialize(app, result); }
    catch (error) {
      const status = document.getElementById('status');
      status.hidden = false;
      status.textContent = `Burette could not load: ${error.message}`;
    }
  };
  await app.connect();
  if (!started) await app.sendSizeChanged({ height: name === 'burette-native-workspace' ? 320 : 48 });
}
