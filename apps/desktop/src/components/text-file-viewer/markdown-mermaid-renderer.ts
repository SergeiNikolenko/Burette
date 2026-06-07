import { renderMermaidSVG } from "beautiful-mermaid";

const SVG_CACHE_LIMIT = 50;
const svgCache = new Map<string, string>();

export interface RenderResult {
  svg: string;
  error?: undefined;
}

export interface RenderError {
  svg?: undefined;
  error: string;
}

const RENDER_OPTIONS = {
  bg: "var(--bg-base)",
  fg: "var(--fg-base)",
  transparent: true,
} as const;

function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, "");
}

function cacheGet(key: string): string | undefined {
  const cached = svgCache.get(key);
  if (cached === undefined) return undefined;
  svgCache.delete(key);
  svgCache.set(key, cached);
  return cached;
}

function cacheSet(key: string, value: string): void {
  if (svgCache.has(key)) svgCache.delete(key);
  svgCache.set(key, value);
  while (svgCache.size > SVG_CACHE_LIMIT) {
    const oldest = svgCache.keys().next().value;
    if (oldest === undefined) break;
    svgCache.delete(oldest);
  }
}

export function renderMermaid(source: string): RenderResult | RenderError {
  const cached = cacheGet(source);
  if (cached !== undefined) return { svg: cached };

  try {
    const svg = sanitizeSvg(renderMermaidSVG(source, RENDER_OPTIONS));
    cacheSet(source, svg);
    return { svg };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export function clearMermaidCache() {
  svgCache.clear();
}
