import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { runMcpAppOperation } from '../scripts/mcp-app-session.mjs';

// Start explicitly with Bun, then inspect the printed URL with the built-in Browser.
const session = await runMcpAppOperation({ operation: 'open', file: new URL('../samples/structures/proteins/1htb.pdb', import.meta.url).pathname });
const bundle = await Bun.build({ entrypoints: [new URL('./fixtures/local-viewer-host.mjs', import.meta.url).pathname], target: 'browser', format: 'esm' });
if (!bundle.success) throw new Error(bundle.logs.join('\n'));
const hostJs = await bundle.outputs[0].text();
const server = createServer(async (request, response) => {
  try {
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><meta charset="utf-8"><title>Burette MCP App protocol fixture</title><h1>MCP App test host — not native Codex</h1><iframe title="Burette" style="width:95vw;height:520px" sandbox="allow-scripts allow-same-origin"></iframe><script type="module" src="/host.js"></script>');
    } else if (request.url === '/host.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(hostJs);
    } else if (request.url === '/viewer') {
      response.setHeader('Content-Type', 'text/html');
      response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline' blob:; img-src data: blob:; font-src data:; connect-src 'none'; worker-src blob:");
      response.end(await readFile(new URL('../plugins/burette-agent/assets/local-viewer.html', import.meta.url), 'utf8'));
    } else if (request.url === '/result') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ content: [], _meta: { session: { sessionId: session.sessionId, token: session.token } } }));
    } else if (request.url === '/exchange' && request.method === 'POST') {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 128 * 1024) throw new Error('Fixture request too large.');
      }
      const payload = await runMcpAppOperation({ ...JSON.parse(body), operation: 'exchange' });
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ content: [], _meta: { payload } }));
    } else { response.writeHead(404).end(); }
  } catch (error) { response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ isError: true, content: [{ type: 'text', text: error.message }] })); }
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`, sessionId: session.sessionId, surface: 'protocol-test-host' })));
