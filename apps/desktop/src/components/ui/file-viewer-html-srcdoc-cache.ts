import { lruGet, lruSet } from "./viewer-lru-cache";

const HTML_VIEWER_SRC_DOC_IDENTITIES_PER_CONTENT = 2;

const HTML_VIEWER_DOCUMENT_STYLE = `<style data-retab-html-viewer-padding>
html {
  background: white;
}
body {
  box-sizing: border-box;
  margin: 0;
  min-width: 0;
  padding: 1rem;
}
body > :first-child {
  margin-block-start: 0;
}
body > :last-child {
  margin-block-end: 0;
}
</style>`;

interface HtmlViewerSrcDocCacheEntry {
  readonly html: string;
  readonly srcDoc: string;
}

interface HtmlViewerSrcDocCacheBucket {
  readonly entries: HtmlViewerSrcDocCacheEntry[];
}

const htmlViewerSrcDocCache = new Map<string, HtmlViewerSrcDocCacheBucket>();
let htmlViewerSrcDocCacheHitsForTests = 0;
let htmlViewerSrcDocCacheMissesForTests = 0;

export function getHtmlViewerSrcDoc({
  contentKey,
  html,
}: {
  contentKey: string;
  html: string;
}) {
  const bucket = lruGet(htmlViewerSrcDocCache, contentKey);
  const cached = bucket?.entries.find((entry) => entry.html === html);

  if (cached) {
    htmlViewerSrcDocCacheHitsForTests += 1;
    return cached.srcDoc;
  }

  htmlViewerSrcDocCacheMissesForTests += 1;
  const srcDoc = createHtmlViewerSrcDoc(html);
  const entries = [...(bucket?.entries ?? []), { html, srcDoc }].slice(
    -HTML_VIEWER_SRC_DOC_IDENTITIES_PER_CONTENT,
  );

  lruSet(htmlViewerSrcDocCache, contentKey, { entries });
  return srcDoc;
}

export function clearHtmlViewerSrcDocCacheForTests() {
  htmlViewerSrcDocCache.clear();
  htmlViewerSrcDocCacheHitsForTests = 0;
  htmlViewerSrcDocCacheMissesForTests = 0;
}

export function htmlViewerSrcDocCacheStatsForTests() {
  let identities = 0;
  for (const bucket of htmlViewerSrcDocCache.values()) {
    identities += bucket.entries.length;
  }

  return {
    contentKeys: htmlViewerSrcDocCache.size,
    hits: htmlViewerSrcDocCacheHitsForTests,
    identities,
    misses: htmlViewerSrcDocCacheMissesForTests,
  };
}

function createHtmlViewerSrcDoc(html: string) {
  const headOpenTag = /<head(?:\s[^>]*)?>/i;
  const htmlOpenTag = /<html(?:\s[^>]*)?>/i;

  if (headOpenTag.test(html)) {
    return html.replace(
      headOpenTag,
      (tag) => `${tag}${HTML_VIEWER_DOCUMENT_STYLE}`,
    );
  }
  if (htmlOpenTag.test(html)) {
    return html.replace(
      htmlOpenTag,
      (tag) => `${tag}<head>${HTML_VIEWER_DOCUMENT_STYLE}</head>`,
    );
  }
  return `${HTML_VIEWER_DOCUMENT_STYLE}${html}`;
}
