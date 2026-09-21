"use client";

import * as React from "react";
import type * as DOMPurify from "dompurify";
import type * as Marked from "marked";

import type { ViewerResource } from "@/lib/viewer-resource";
import { IframeDoc } from "@/components/file-thumbnail/renderers/layout";
import {
  cachedThumbnailResource,
  createThumbnailArtifactCache,
} from "@/components/file-thumbnail/thumbnail-cache";
import { withThumbnailFormatError } from "@/components/file-thumbnail/thumbnail-errors";
import {
  shortName,
  timedThumbnail,
} from "@/components/file-thumbnail/thumbnail-profile";
import { useThumbnailResource } from "@/components/file-thumbnail/thumbnail-resource";
import {
  getThumbnailText,
  thumbnailFileMeta,
  type ThumbnailFileMeta,
  type ThumbnailTextContent,
} from "@/components/file-thumbnail/thumbnail-text";

let mdLibs: Promise<[typeof Marked, typeof DOMPurify]> | null = null;

function loadMarkdown() {
  if (!mdLibs) mdLibs = Promise.all([import("marked"), import("dompurify")]);
  return mdLibs;
}

const MARKDOWN_THUMBNAIL_CACHE_MAX_ENTRIES = 64;

const markdownBodyCache = createThumbnailArtifactCache<string>({
  maxEntries: MARKDOWN_THUMBNAIL_CACHE_MAX_ENTRIES,
});

type MarkdownThumbnailColorScheme = "light" | "dark";

function getMarkdownBody(
  meta: ThumbnailFileMeta,
  content: ThumbnailTextContent,
  thumbnailKey: string,
): Promise<string> {
  return cachedThumbnailResource(markdownBodyCache, thumbnailKey, () =>
    withThumbnailFormatError(
      "markdown",
      "render_failed",
      meta.fileName,
      "Failed to render markdown thumbnail",
      () =>
        timedThumbnail(`markdown:total ${shortName(meta)}`, async () => {
          const [text, [{ marked }, DOMPurifyMod]] = await Promise.all([
            getThumbnailText(meta, content, thumbnailKey),
            loadMarkdown(),
          ]);
          const purifier = DOMPurifyMod as unknown as {
            default?: { sanitize?: (html: string) => string };
            sanitize?: (html: string) => string;
          };
          const sanitize = purifier.default?.sanitize ?? purifier.sanitize;
          if (!sanitize) throw new Error("DOMPurify sanitize unavailable");
          return sanitize(await marked.parse(text));
        }),
    ),
  );
}

function createMarkdownDoc(
  body: string,
  colorScheme: MarkdownThumbnailColorScheme,
) {
  return `<!doctype html><html data-color-scheme="${colorScheme}"><head><meta charset="utf-8"><style>
        :root{color-scheme:light;--md-bg:#ffffff;--md-fg:#0f172a;--md-muted:#f1f5f9;--md-border:#e2e8f0;--md-quote:#475569;--md-link:#4f46e5}
        :root[data-color-scheme="dark"]{color-scheme:dark;--md-bg:#111113;--md-fg:#e4e4e7;--md-muted:#1f2937;--md-border:#3f3f46;--md-quote:#a1a1aa;--md-link:#a5b4fc}
        html,body{min-height:100%;background:var(--md-bg)}
        body{margin:0;padding:18px;font:14px/1.6 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:var(--md-fg)}
        h1{font-size:1.6em;margin:.1em 0 .5em;border-bottom:1px solid var(--md-border);padding-bottom:.25em}
        h2{font-size:1.3em;margin:1em 0 .4em;border-bottom:1px solid var(--md-border);padding-bottom:.25em}
        h3{font-size:1.1em;margin:1em 0 .3em}
        p,ul,ol{margin:0 0 .8em}ul,ol{padding-left:1.4em}
        code{font-family:ui-monospace,SFMono-Regular,monospace;background:var(--md-muted);padding:.1em .35em;border-radius:4px;font-size:.85em}
        pre{background:var(--md-muted);padding:12px;border-radius:8px;overflow:hidden}pre code{background:none;padding:0}
        table{border-collapse:collapse;width:100%}td,th{border:1px solid var(--md-border);padding:4px 8px;text-align:left}
        a{color:var(--md-link)}blockquote{margin:0 0 .8em;padding-left:12px;border-left:3px solid var(--md-border);color:var(--md-quote)}
      </style></head><body>${body}</body></html>`;
}

function useMarkdownThumbnailColorScheme(): MarkdownThumbnailColorScheme {
  return React.useSyncExternalStore(
    subscribeMarkdownThumbnailColorScheme,
    getMarkdownThumbnailColorScheme,
    () => "light",
  );
}

function subscribeMarkdownThumbnailColorScheme(onChange: () => void) {
  if (
    typeof document === "undefined" ||
    typeof MutationObserver === "undefined"
  ) {
    return () => {};
  }

  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function getMarkdownThumbnailColorScheme(): MarkdownThumbnailColorScheme {
  if (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
  ) {
    return "dark";
  }
  return "light";
}

export function MarkdownFirstPage({
  resource,
  thumbnailKey,
}: {
  resource: ViewerResource;
  thumbnailKey: string;
}) {
  const colorScheme = useMarkdownThumbnailColorScheme();
  const body = useThumbnailResource(
    getMarkdownBody(
      thumbnailFileMeta(resource),
      resource.content,
      thumbnailKey,
    ),
  );
  return <IframeDoc html={createMarkdownDoc(body, colorScheme)} />;
}
