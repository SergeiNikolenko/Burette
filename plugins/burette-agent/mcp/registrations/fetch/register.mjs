import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { toolText } from "../../lib/tool-response.mjs";

const MAX_LENGTH = 20000;
const DEFAULT_LENGTH = 8000;
const MAX_RESPONSE_BYTES = 1000000;
const DEFAULT_TIMEOUT_MS = 15000;

export function registerFetch(server) {
  registerAppTool(
    server,
    "fetch",
    {
      title: "Fetch URL",
      description: "Fetch a public HTTP(S) URL for agent research and return bounded readable text.",
      inputSchema: {
        url: z.string().url(),
        max_length: z.number().int().min(100).max(MAX_LENGTH).default(DEFAULT_LENGTH).optional(),
        start_index: z.number().int().min(0).default(0).optional(),
        raw: z.boolean().default(false).optional(),
        timeout_ms: z.number().int().min(1000).max(30000).default(DEFAULT_TIMEOUT_MS).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: {
        ui: {
          visibility: ["model"],
        },
      },
    },
    async input => {
      const result = await fetchPublicUrl(input);
      if (!result.ok) {
        return {
          content: toolText(`fetch failed: ${result.error.message}`),
          structuredContent: result,
        };
      }
      return {
        content: toolText(`Fetched ${result.url} (${result.status}, ${result.contentType || "unknown content type"}).\n\n${result.text}`),
        structuredContent: result,
      };
    },
  );
}

async function fetchPublicUrl(input) {
  const maxLength = input.max_length ?? DEFAULT_LENGTH;
  const startIndex = input.start_index ?? 0;
  const timeoutMs = input.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const parsed = validateFetchUrl(input.url);
  if (!parsed.ok) return fetchError(input.url, parsed.error.message);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await globalThis.fetch(parsed.url.href, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Burette-Agent-Fetch/0.1",
        accept: "text/html, text/plain, application/json, application/xml, text/markdown;q=0.9, */*;q=0.5",
      },
    });
    const contentType = response.headers.get("content-type") || "";
    const sourceText = await readBoundedResponseText(response);
    const readableText = input.raw ? sourceText : readableFromResponseText(sourceText, contentType);
    const chunk = readableText.slice(startIndex, startIndex + maxLength);
    const nextStartIndex = startIndex + chunk.length < readableText.length ? startIndex + chunk.length : null;
    return {
      ok: true,
      tool: "fetch",
      url: response.url || parsed.url.href,
      status: response.status,
      contentType,
      startIndex,
      maxLength,
      returnedLength: chunk.length,
      totalLength: readableText.length,
      truncated: nextStartIndex !== null,
      nextStartIndex,
      text: chunk,
      error: null,
    };
  } catch (error) {
    return fetchError(parsed.url.href, error?.name === "AbortError" ? `Request timed out after ${timeoutMs} ms.` : error?.message || "Request failed.");
  } finally {
    clearTimeout(timeout);
  }
}

function validateFetchUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: { message: "Invalid URL." } };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: { message: "Only http and https URLs are supported." } };
  }
  if (isBlockedHost(parsed.hostname)) {
    return { ok: false, error: { message: "Local, private, and link-local hosts are blocked." } };
  }
  return { ok: true, url: parsed };
}

function isBlockedHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const parts = ipv4.slice(1).map(Number);
  if (parts.some(part => part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

async function readBoundedResponseText(response) {
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      break;
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

function readableFromResponseText(text, contentType) {
  if (/html/i.test(contentType) || /<html[\s>]/i.test(text) || /<body[\s>]/i.test(text)) {
    return htmlToText(text);
  }
  return normalizeWhitespace(decodeEntities(text));
}

function htmlToText(html) {
  return normalizeWhitespace(
    decodeEntities(
      html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
        .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "")
        .replace(/<\/?(h[1-6]|p|section|article|header|footer|main|aside|div|table|thead|tbody|tr)\b[^>]*>/gi, "\n\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<li\b[^>]*>/gi, "\n- ")
        .replace(/<\/(td|th)>/gi, "\t")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const value = Number(code);
      return Number.isFinite(value) ? String.fromCodePoint(value) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const value = Number.parseInt(code, 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : "";
    });
}

function normalizeWhitespace(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function fetchError(url, message) {
  return {
    ok: false,
    tool: "fetch",
    url,
    status: null,
    contentType: null,
    startIndex: null,
    maxLength: null,
    returnedLength: 0,
    totalLength: 0,
    truncated: false,
    nextStartIndex: null,
    text: "",
    error: { message },
  };
}
