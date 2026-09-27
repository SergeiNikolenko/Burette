import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { lookup } from "node:dns/promises";
import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import { isIP } from "node:net";
import { z } from "zod";

import { toolText } from "../../lib/tool-response.mjs";

const MAX_LENGTH = 20000;
const DEFAULT_LENGTH = 8000;
const MAX_RESPONSE_BYTES = 1000000;
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 3;

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
    const { response, url } = await requestPublicUrl(parsed.url, controller.signal);
    const contentType = String(response.headers["content-type"] || "");
    const { text: sourceText, truncated: sourceTruncated } = await readBoundedResponseText(response);
    const readableText = input.raw ? sourceText : readableFromResponseText(sourceText, contentType);
    const chunk = readableText.slice(startIndex, startIndex + maxLength);
    const nextStartIndex = startIndex + chunk.length < readableText.length ? startIndex + chunk.length : null;
    return {
      ok: true,
      tool: "fetch",
      url: url.href,
      status: response.statusCode,
      contentType,
      startIndex,
      maxLength,
      returnedLength: chunk.length,
      totalLength: readableText.length,
      truncated: sourceTruncated || nextStartIndex !== null,
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
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
    return { ok: false, error: { message: "Only http and https URLs are supported." } };
  }
  if (isBlockedHost(parsed.hostname)) {
    return { ok: false, error: { message: "Local, private, and link-local hosts are blocked." } };
  }
  return { ok: true, url: parsed };
}

function isBlockedHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  const family = isIP(host);
  if (family === 0) return false;
  if (family === 6) {
    // Normalize expanded literals before excluding mapped/translated and non-global ranges.
    const address = new URL(`http://[${host}]`).hostname.slice(1, -1);
    return !/^[23][0-9a-f]{3}:/u.test(address)
      || address.startsWith("2002:")
      || /^2001:(?:[0-1]?[0-9a-f]{1,2}|db8)?:/u.test(address)
      || address.startsWith("3fff:");
  }
  const [a, b, c] = host.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

async function requestPublicUrl(initialUrl, signal) {
  let url = initialUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    signal.throwIfAborted();
    const validated = validateFetchUrl(url.href);
    if (!validated.ok) throw new Error(validated.error.message);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await new Promise((resolve, reject) => {
          const onAbort = () => reject(signal.reason);
          signal.addEventListener("abort", onAbort, { once: true });
          lookup(hostname, { all: true, verbatim: true }).then(resolve, reject)
            .finally(() => signal.removeEventListener("abort", onAbort));
        });
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(({ address }) => !isIP(address) || isBlockedHost(address))) {
      throw new Error("Local, private, and link-local hosts are blocked.");
    }
    let response;
    for (const [index, address] of addresses.entries()) {
      try {
        response = await new Promise((resolve, reject) => {
          const request = (url.protocol === "https:" ? requestHttps : requestHttp)({
            protocol: url.protocol,
            hostname: address.address,
            family: address.family,
            port: url.port || (url.protocol === "https:" ? 443 : 80),
            path: `${url.pathname}${url.search}`,
            servername: isIP(hostname) ? undefined : hostname,
            signal,
            headers: {
              host: url.host,
              "user-agent": "Burette-Agent-Fetch/0.1",
              accept: "text/html, text/plain, application/json, application/xml, text/markdown;q=0.9, */*;q=0.5",
            },
          }, resolve);
          request.once("error", reject);
          request.end();
        });
        break;
      } catch (error) {
        if (signal.aborted || index === addresses.length - 1) throw error;
      }
    }
    if (![301, 302, 303, 307, 308].includes(response.statusCode) || !response.headers.location) {
      return { response, url };
    }
    response.destroy();
    if (redirects === MAX_REDIRECTS) throw new Error("Too many redirects.");
    url = new URL(response.headers.location, url);
  }
}

async function readBoundedResponseText(response) {
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  let truncated = false;
  for await (const value of response) {
    const remaining = MAX_RESPONSE_BYTES - received;
    text += decoder.decode(value.subarray(0, remaining), { stream: true });
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      truncated = true;
      response.destroy();
      break;
    }
  }
  text += decoder.decode();
  return { text, truncated };
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
      return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const value = Number.parseInt(code, 16);
      return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "";
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
