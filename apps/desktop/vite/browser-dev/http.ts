import type { IncomingMessage, ServerResponse } from "node:http";

class RequestBodyTooLarge extends Error {
  constructor() {
    super("Request body exceeds the browser-dev size limit");
  }
}

// Allows base64 uploads up to the ordinary 75 MiB file limit.
const JSON_BODY_LIMIT = 128 * 1024 * 1024;

export async function readJsonBody(req: IncomingMessage, maxBytes = JSON_BODY_LIMIT) {
  if (Number(req.headers?.["content-length"]) > maxBytes) {
    req.resume();
    throw new RequestBodyTooLarge();
  }
  const chunks: Buffer[] = [];
  let byteCount = 0;
  // Keep the connection writable so the route can return 413 on overflow.
  const stream = req.iterator({ destroyOnReturn: false });
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteCount += bytes.length;
    if (byteCount > maxBytes) {
      req.resume();
      throw new RequestBodyTooLarge();
    }
    chunks.push(bytes);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) as Record<string, unknown> : {};
}

export function sendJson(res: ServerResponse, status: number, body: unknown, cacheControl?: string) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (cacheControl) res.setHeader("Cache-Control", cacheControl);
  res.end(JSON.stringify(body));
}

export function sendJsonError(res: ServerResponse, status: number, error: unknown, cacheControl?: string) {
  sendJson(res, error instanceof RequestBodyTooLarge ? 413 : status, { error: error instanceof Error ? error.message : String(error) }, cacheControl);
}
