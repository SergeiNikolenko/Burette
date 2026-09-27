import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Called only after the shell has checked its session token and request origin.
// Generated files stay within that session; arbitrary download paths are never accepted.
export function createShellExports({ sessionDir, readJsonBody, sendJson }) {
  const entries = new Map();
  const types = { gif: 'image/gif', svg: 'image/svg+xml', png: 'image/png', pdf: 'application/pdf', tiff: 'image/tiff' };
  return async (req, res, method, url) => {
    if (method === 'POST' && url.pathname === '/__burette/xyzrender-export') {
      const input = await readJsonBody(req, 24 * 1024 * 1024);
      const encoded = input?.dataBase64 ?? input?.gifBase64;
      const format = input?.format ?? 'gif';
      if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) { sendJson(res, 400, { error: 'Invalid export file' }); return; }
      const bytes = Buffer.from(encoded, 'base64');
      const valid = format === 'gif' ? /^GIF8[79]a$/u.test(bytes.subarray(0, 6).toString()) && bytes.at(-1) === 59
        : format === 'png' ? bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
        : format === 'pdf' ? bytes.subarray(0, 5).toString() === '%PDF-'
        : format === 'tiff' ? ['49492a00', '4d4d002a'].includes(bytes.subarray(0, 4).toString('hex'))
        : format === 'svg' ? /<svg[\s>]/u.test(bytes.toString('utf8', 0, 2048)) : false;
      if (!valid || bytes.length < 14 || bytes.length > 16 * 1024 * 1024) { sendJson(res, 400, { error: 'Invalid export file or exceeds 16 MiB' }); return; }
      const name = String(input.name || 'molecule').replace(/[^a-zA-Z0-9._-]/gu, '_').slice(0, 100).replace(/\.(gif|svg|png|pdf|tiff)$/iu, '') + '.' + format;
      const id = randomUUID();
      const path = join(sessionDir, 'exports', `${id}-${name}`);
      // Reserve before yielding to disk I/O so concurrent requests obey the cap.
      if (entries.size >= 20) { sendJson(res, 429, { error: 'This session already contains 20 exports. Start another export session.' }); return; }
      entries.set(id, { path, name, mime: types[format], ready: false });
      try {
        await mkdir(join(sessionDir, 'exports'), { recursive: true });
        await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
        entries.get(id).ready = true;
      } catch (error) { entries.delete(id); throw error; }
      sendJson(res, 200, { path, name, downloadUrl: `/__burette/xyzrender-export/${id}` });
      return;
    }
    if (method === 'GET') {
      const entry = entries.get(url.pathname.slice('/__burette/xyzrender-export/'.length));
      if (!entry?.ready) { sendJson(res, 404, { error: 'Export not found.' }); return; }
      res.setHeader('Content-Type', entry.mime);
      res.setHeader('Content-Disposition', `attachment; filename="${entry.name}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      res.end(await readFile(entry.path));
      return;
    }
    sendJson(res, 405, { error: 'Method not allowed' });
  };
}
