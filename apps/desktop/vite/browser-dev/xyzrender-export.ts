import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ViteDevServer } from "vite";
import { readJsonBody, sendJson, sendJsonError } from "./http";

// Keep a real file as well as an HTTP attachment: embedded browsers may not
// implement blob downloads. URLs are bounded to exports created by this server.
export function registerXyzrenderExportRoute(server: ViteDevServer) {
  const exports = new Map<string, { path: string; name: string; mime: string }>();
  server.middlewares.use("/__burette/xyzrender-export", async (req, res) => {
    try {
      if (req.method === "POST") {
        const body = await readJsonBody(req, 24 * 1024 * 1024);
        const format = typeof body.format === 'string' ? body.format : 'gif';
        const bytes = Buffer.from(typeof body.dataBase64 === 'string' ? body.dataBase64 : typeof body.gifBase64 === 'string' ? body.gifBase64 : '', 'base64');
        const types: Record<string, string> = { gif: 'image/gif', svg: 'image/svg+xml', png: 'image/png', pdf: 'application/pdf', tiff: 'image/tiff' };
        const valid = format === 'gif' ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString()) && bytes.at(-1) === 59
          : format === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
          : format === 'pdf' ? bytes.subarray(0, 5).toString() === '%PDF-'
          : format === 'tiff' ? ['49492a00', '4d4d002a'].includes(bytes.subarray(0, 4).toString('hex'))
          : format === 'svg' ? /<svg[\s>]/.test(bytes.toString('utf8', 0, 2048)) : false;
        if (!valid || bytes.length < 14 || bytes.length > 16 * 1024 * 1024) { sendJson(res, 400, { error: 'Invalid export file' }); return; }
        const name = String(body.name || 'molecule').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100).replace(/\.(gif|svg|png|pdf|tiff)$/i, '') + '.' + format;
        const directory = await mkdtemp(join(tmpdir(), "burette-gif-export-"));
        const path = join(directory, name);
        await writeFile(path, bytes);
        const id = randomUUID();
        exports.set(id, { path, name, mime: types[format] });
        if (exports.size > 20) exports.delete(exports.keys().next().value!);
        sendJson(res, 200, { path, name, downloadUrl: `/__burette/xyzrender-export/${id}` });
        return;
      }
      if (req.method === "GET") {
        const id = (req.url || "").split("?")[0].replace(/^\//, "");
        const entry = exports.get(id);
        if (!entry) { sendJson(res, 404, { error: "Export not found. Save the GIF again." }); return; }
        res.setHeader("Content-Type", entry.mime);
        res.setHeader("Content-Disposition", `attachment; filename="${entry.name}"`);
        res.setHeader("Cache-Control", "no-store");
        res.end(await readFile(entry.path));
        return;
      }
      sendJson(res, 405, { error: "Method not allowed" });
    } catch (error) { sendJsonError(res, 500, error); }
  });
}
