import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { readJsonBody, sendJson, sendJsonError } from "../apps/desktop/vite/browser-dev/http.ts";
const server = createServer(async (req, res) => {
  try { sendJson(res, 200, await readJsonBody(req, 32)); }
  catch (error) { sendJsonError(res, 500, error); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const send = (chunks, headers = {}) => new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: server.address().port, method: "POST", headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on("error", reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
  assert.deepEqual(await send(['{"ok":true}']), { status: 200, body: { ok: true } });
  assert.equal((await send(['{"large":"', "x".repeat(40), '"}'])).status, 413);
  assert.equal((await send(['{"large":"' + "x".repeat(40) + '"}'], { "Content-Length": "52" })).status, 413);
} finally { await new Promise((resolve) => server.close(resolve)); }
console.log("browser-dev HTTP body limit tests passed");
