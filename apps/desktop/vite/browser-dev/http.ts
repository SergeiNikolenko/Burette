import type { IncomingMessage, ServerResponse } from "node:http";
import type { ViteDevServer } from "vite";

// configureServer hooks run before Vite's Host/CORS middleware. These routes
// can write files and start local programs, so CORS alone cannot protect them
// from a cross-origin form or no-cors fetch.
export function registerBrowserDevRequestGuard(server: ViteDevServer) {
  server.middlewares.use("/__burette", (req, res, next) => {
    const address = server.httpServer?.address();
    const port = address && typeof address === "object" ? address.port : 0;
    const protocol = server.config.server.https ? "https" : "http";
    const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
    const host = req.headers.host;
    const origin = req.headers.origin;
    const remote = req.socket.remoteAddress;
    if (!port || !host || !hosts.has(host)
      || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote ?? "")
      || (origin !== undefined && origin !== `${protocol}://${host}`)
      || req.headers["sec-fetch-site"] === "cross-site") {
      sendJson(res, 403, { error: "Browser-dev operations require a local, same-origin request." }, "no-store");
      return;
    }
    // CLI clients do not send Origin; same-origin browser GETs may omit it too.
    next();
  });
}

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
  const chunks = await new Promise<Buffer[]>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let byteCount = 0;
    const cleanup = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("aborted", onAborted);
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onAborted = () => onError(new Error("Request body was aborted"));
    const onEnd = () => { cleanup(); resolve(chunks); };
    const onData = (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteCount += bytes.length;
      if (byteCount > maxBytes) {
        cleanup();
        chunks.length = 0;
        // Drain without buffering or destroying the request. Destroying an
        // async iterator can break the next request on this keep-alive socket.
        req.resume();
        reject(new RequestBodyTooLarge());
        return;
      }
      chunks.push(bytes);
    };
    req.on("data", onData);
    req.once("end", onEnd);
    req.once("error", onError);
    req.once("aborted", onAborted);
  });
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
  // The response may finish before the rejected upload is drained. Do not
  // reuse that connection for a subsequent request.
  if (error instanceof RequestBodyTooLarge) {
    res.shouldKeepAlive = false;
    res.setHeader("Connection", "close");
  }
  sendJson(res, error instanceof RequestBodyTooLarge ? 413 : status, { error: error instanceof Error ? error.message : String(error) }, cacheControl);
}
