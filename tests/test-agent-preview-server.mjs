#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, request } from 'node:http';

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function waitForReady(child) {
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const start = stdout.indexOf('{');
    const end = stdout.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(stdout.slice(start, end + 1));
    }
    if (child.exitCode != null) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`agent-preview did not become ready. stdout=${stdout} stderr=${stderr}`);
}

const port = await freePort();
const child = spawn(process.execPath, ['scripts/agent-preview.mjs', 'samples/mini.pdb', '--port', String(port)], {
  stdio: ['ignore', 'pipe', 'pipe']
});

try {
  const ready = await waitForReady(child);
  assert.equal(ready.ok, true);
  assert.match(ready.url, new RegExp(`^http://127\\.0\\.0\\.1:${port}/index\\.html\\?token=`));

  const base = `http://127.0.0.1:${port}`;
  const htmlWithoutToken = await get(`${base}/index.html`);
  assert.equal(htmlWithoutToken.statusCode, 403);

  const dataWithoutToken = await get(`${base}/preview-data.js`);
  assert.equal(dataWithoutToken.statusCode, 403);

  const configWithoutToken = await get(`${base}/preview-config.js`);
  assert.equal(configWithoutToken.statusCode, 403);

  const staticAgent = await get(`${base}/burette-agent.js`);
  assert.equal(staticAgent.statusCode, 200);
  assert.match(staticAgent.body, /window\.BurreteAgent/);

  const htmlWithToken = await get(ready.url);
  assert.equal(htmlWithToken.statusCode, 200);
  const cookie = htmlWithToken.headers['set-cookie']?.find(value => value.startsWith('BurreteAgentPreviewToken='));
  assert.ok(cookie, 'authorized HTML response should set the preview token cookie');

  const cookieHeader = cookie.split(';')[0];
  const dataWithCookie = await get(`${base}/preview-data.js`, { Cookie: cookieHeader });
  assert.equal(dataWithCookie.statusCode, 200);
  assert.match(dataWithCookie.body, /^window\.BurreteDataBase64 = "/);

  const configWithCookie = await get(`${base}/preview-config.js`, { Cookie: cookieHeader });
  assert.equal(configWithCookie.statusCode, 200);
  assert.match(configWithCookie.body, /^window\.BurreteConfig = /);

  console.log('agent-preview server tests passed');
} finally {
  child.kill('SIGTERM');
}
