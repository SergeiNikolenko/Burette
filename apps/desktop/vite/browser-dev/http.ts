import type { IncomingMessage, ServerResponse } from "node:http";

export async function readJsonBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
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

export function sendJsonError(res: ServerResponse, status: number, error: unknown) {
  sendJson(res, status, { error: error instanceof Error ? error.message : String(error) });
}
