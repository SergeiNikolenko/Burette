import assert from "node:assert/strict";
import { Agent, createServer, request } from "node:http";
import { readJsonBody, sendJson, sendJsonError } from "../apps/desktop/vite/browser-dev/http.ts";
const agent = new Agent({ keepAlive: true, maxSockets: 1 });
const server = createServer(async (req, res) => {
  try { sendJson(res, 200, await readJsonBody(req, 32)); }
  catch (error) { sendJsonError(res, 500, error); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let requestIndex = 0;
try {
  const send = (chunks, headers = {}) => new Promise((resolve, reject) => {
    const index = ++requestIndex;
    const req = request({ host: "127.0.0.1", port: server.address().port, method: "POST", agent, headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("error", reject);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch { reject(new Error(`Request ${index}: HTTP ${res.statusCode} for ${JSON.stringify(headers)} / ${chunks.map(chunk => chunk.length).join(",")}: expected JSON, received ${JSON.stringify(body)}`)); }
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error("HTTP request timed out")));
    req.on("error", reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
  assert.deepEqual(await send(['{"ok":true}']), { status: 200, body: { ok: true } });
  assert.equal((await send(['{"large":"', "x".repeat(40), '"}'])).status, 413);
  assert.deepEqual(await send(['{"ok":true}']), { status: 200, body: { ok: true } });
  assert.equal((await send(['{"large":"' + "x".repeat(40) + '"}'], { "Content-Length": "52" })).status, 413);
  assert.deepEqual(await send(['{"ok":true}']), { status: 200, body: { ok: true } });
} finally { agent.destroy(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
console.log("browser-dev HTTP body limit tests passed");
