"use client";

const URL_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;
const URL_SCHEME_PATTERN = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const URL_BACKSLASH_PATTERN = /[\\\uFE68\uFF3C\u2216]/;
const URL_CONFUSABLE_DELIMITER_PATTERN =
  /[\u02D0\u0589\u05C3\u0703\u0704\u16EC\u1803\u1809\u205A\u2236\uA789\uFE13\uFE55\uFF1A\u2044\u2215\u2571\u27CB\u29F8\uFF0F]/;
const ALLOWED_LINK_PROTOCOLS = new Set(["http", "https", "mailto"]);

export function sanitizeMarkdownUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (URL_CONTROL_CHARACTER_PATTERN.test(trimmed)) return "";
  if (URL_BACKSLASH_PATTERN.test(trimmed)) return "";
  if (URL_CONFUSABLE_DELIMITER_PATTERN.test(trimmed)) return "";

  const decoded = decodeMarkdownUrl(trimmed).trim();
  if (!decoded || URL_CONTROL_CHARACTER_PATTERN.test(decoded)) return "";
  if (URL_BACKSLASH_PATTERN.test(decoded)) return "";
  if (URL_CONFUSABLE_DELIMITER_PATTERN.test(decoded)) return "";

  const decodedScheme = getMarkdownUrlScheme(decoded);
  const rawScheme = getMarkdownUrlScheme(trimmed);
  if (decodedScheme && decodedScheme !== rawScheme) return "";
  if (decodedScheme && !ALLOWED_LINK_PROTOCOLS.has(decodedScheme)) return "";

  if (trimmed.startsWith("#")) return trimmed;
  if (trimmed.startsWith("/")) return trimmed.startsWith("//") ? "" : trimmed;

  try {
    const url = new URL(trimmed, "https://retab.local");
    if (ALLOWED_LINK_PROTOCOLS.has(url.protocol.slice(0, -1))) {
      return rawScheme ? url.href : trimmed;
    }
  } catch {
    return "";
  }

  return "";
}

export function sanitizeMarkdownImageUrl(value: string) {
  const safeUrl = sanitizeMarkdownUrl(value);
  if (!safeUrl || safeUrl.startsWith("mailto:") || safeUrl.startsWith("#")) {
    return "";
  }
  if (isMarkdownSvgResourceUrl(safeUrl)) return "";
  return safeUrl;
}

export function sanitizeMarkdownMediaUrl(value: string) {
  // Image URLs already reject SVG resources, so media inherits that policy.
  return sanitizeMarkdownImageUrl(value);
}

function decodeMarkdownUrl(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getMarkdownUrlScheme(value: string) {
  return URL_SCHEME_PATTERN.exec(value)?.[1]?.toLowerCase() ?? null;
}

export function isMarkdownSvgResourceUrl(value: string) {
  const decoded = decodeMarkdownUrl(value).trim();

  try {
    const url = new URL(decoded, "https://retab.local");
    return /\.(?:svg|svgz)$/i.test(url.pathname);
  } catch {
    const pathname = decoded.split(/[?#]/, 1)[0] ?? decoded;
    return /\.(?:svg|svgz)$/i.test(pathname);
  }
}
