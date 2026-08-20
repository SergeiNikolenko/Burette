"use client";

import * as React from "react";

import {
  ensureCodePrismLanguage,
  tokenizeCodeLine as tokenizePrismCodeLine,
} from "./code-viewer-syntax-prism";
import { shouldTokenizeCodeLine } from "./code-viewer-syntax-protocol";
import { markdownCodeTokensToHtml } from "./markdown-greenfield-code-highlight-html";
import {
  MARKDOWN_CODE_HIGHLIGHT_BATCH_SIZE,
  MARKDOWN_CODE_HIGHLIGHT_CACHE_LIMIT,
  MARKDOWN_CODE_HIGHLIGHT_RENDERER_VERSION,
  type MarkdownCodeHighlightLineRequest,
  type MarkdownCodeHighlightLineResult,
  type MarkdownCodeHighlightWorkerRequest,
  type MarkdownCodeHighlightWorkerResponse,
} from "./markdown-greenfield-code-highlight-protocol";

export const MARKDOWN_CODE_HIGHLIGHT_STYLES = `
.cv-token-comment { color: var(--cv-token-comment, #6e7781); font-style: italic; }
.cv-token-property,
.cv-token-tag,
.cv-token-attr-name,
.cv-token-symbol { color: var(--cv-token-property, #0550ae); }
.cv-token-string,
.cv-token-char,
.cv-token-attr-value,
.cv-token-url,
.cv-token-regex { color: var(--cv-token-string, #0a7d33); }
.cv-token-number { color: var(--cv-token-number, #b5690c); }
.cv-token-keyword,
.cv-token-boolean,
.cv-token-null,
.cv-token-constant,
.cv-token-atrule,
.cv-token-important { color: var(--cv-token-keyword, #8250df); }
.cv-token-function,
.cv-token-class-name,
.cv-token-builtin { color: var(--cv-token-function, #8250df); }
.cv-token-variable { color: var(--cv-token-variable, #953800); }
.cv-token-punctuation,
.cv-token-operator { color: var(--cv-token-punctuation, color-mix(in oklab, var(--foreground) 55%, transparent)); }
.dark .cv-token-comment { color: var(--cv-token-comment, #8b949e); }
.dark .cv-token-property,
.dark .cv-token-tag,
.dark .cv-token-attr-name,
.dark .cv-token-symbol { color: var(--cv-token-property, #6cb6ff); }
.dark .cv-token-string,
.dark .cv-token-char,
.dark .cv-token-attr-value,
.dark .cv-token-url,
.dark .cv-token-regex { color: var(--cv-token-string, #8ddb8c); }
.dark .cv-token-number { color: var(--cv-token-number, #e3b341); }
.dark .cv-token-keyword,
.dark .cv-token-boolean,
.dark .cv-token-null,
.dark .cv-token-constant,
.dark .cv-token-atrule,
.dark .cv-token-important { color: var(--cv-token-keyword, #dcbdfb); }
.dark .cv-token-function,
.dark .cv-token-class-name,
.dark .cv-token-builtin { color: var(--cv-token-function, #d2a8ff); }
.dark .cv-token-variable { color: var(--cv-token-variable, #ffa657); }
`;

type MarkdownCodeLineHtmlRequest = MarkdownCodeHighlightLineRequest & {
  highlightPattern: string;
  key: string;
  languageId: string;
};

type MarkdownCodeHighlightTaskHandle =
  | { id: number; kind: "idle" }
  | { id: number; kind: "timeout" };

type MarkdownCodeHighlightIdleWindow = Window &
  typeof globalThis & {
    cancelIdleCallback?: Window["cancelIdleCallback"];
    requestIdleCallback?: Window["requestIdleCallback"];
  };

const resolvedMarkdownCodeLineHtml = new Map<string, string | null>();
const pendingMarkdownCodeLineHtml = new Map<
  string,
  MarkdownCodeLineHtmlRequest
>();
const markdownCodeLineHtmlSubscribers = new Map<string, Set<() => void>>();
const activeWorkerRequests = new Map<
  number,
  readonly MarkdownCodeLineHtmlRequest[]
>();

let markdownCodeHighlightFlushHandle: MarkdownCodeHighlightTaskHandle | null =
  null;
let markdownCodeHighlightWorker: Worker | null = null;
let isMarkdownCodeHighlightWorkerFailed = false;
let markdownCodeHighlightRequestId = 0;

export function isSafeHighlightedCodeLine(line: number) {
  return Number.isInteger(line) && line > 0 && line <= 100_000;
}

export function normalizeCodeLanguage(language: string | null) {
  const value = (language ?? "text").toLowerCase();
  const aliases: Record<string, string> = {
    bash: "shell",
    docker: "dockerfile",
    javascript: "js",
    jsonc: "json",
    md: "markdown",
    patch: "diff",
    rb: "ruby",
    "shell-session": "shell",
    terminal: "shell",
    typescript: "ts",
    yml: "yaml",
  };
  return aliases[value] ?? value;
}

export function diffLineKind(line: string) {
  if (line.startsWith("+") && !line.startsWith("+++")) return "add";
  if (line.startsWith("-") && !line.startsWith("---")) return "remove";
  return null;
}

export function renderCodeLine({
  fallbackLanguage,
  line,
  lineHtml,
  pattern,
}: {
  fallbackLanguage: string;
  line: string;
  lineHtml: string | undefined;
  pattern: string;
}) {
  if (lineHtml !== undefined) {
    return (
      <span
        data-pretext-code-line-html=""
        dangerouslySetInnerHTML={{ __html: lineHtml }}
      />
    );
  }
  if (!pattern) return renderFallbackCodeTokens(line || " ", fallbackLanguage);
  const index = line.indexOf(pattern);
  if (index < 0) return renderFallbackCodeTokens(line || " ", fallbackLanguage);
  return (
    <>
      {renderFallbackCodeTokens(line.slice(0, index), fallbackLanguage)}
      <span data-highlighted-chars="">{pattern}</span>
      {renderFallbackCodeTokens(
        line.slice(index + pattern.length),
        fallbackLanguage,
      )}
    </>
  );
}

export function useMarkdownCodeLineHtml({
  end,
  highlightPattern,
  language,
  sourceLines,
  start,
}: {
  end: number;
  highlightPattern: string;
  language: string;
  sourceLines: readonly string[];
  start: number;
}) {
  const requests = React.useMemo(
    () =>
      createMarkdownCodeLineHtmlRequests({
        end,
        highlightPattern,
        language,
        sourceLines,
        start,
      }),
    [end, highlightPattern, language, sourceLines, start],
  );
  const subscribe = React.useCallback(
    (onStoreChange: () => void) => {
      for (const request of requests) {
        let subscribers = markdownCodeLineHtmlSubscribers.get(request.key);
        if (!subscribers) {
          subscribers = new Set();
          markdownCodeLineHtmlSubscribers.set(request.key, subscribers);
        }
        subscribers.add(onStoreChange);
        ensureMarkdownCodeLineHtml(request);
      }
      return () => {
        for (const request of requests) {
          const subscribers = markdownCodeLineHtmlSubscribers.get(request.key);
          if (!subscribers) continue;
          subscribers.delete(onStoreChange);
          if (!subscribers.size) {
            markdownCodeLineHtmlSubscribers.delete(request.key);
          }
        }
      };
    },
    [requests],
  );
  const getSnapshot = React.useCallback(
    () =>
      requests
        .map((request) =>
          resolvedMarkdownCodeLineHtml.has(request.key) ? "1" : "0",
        )
        .join(""),
    [requests],
  );
  const resolvedVersion = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => "",
  );

  return React.useMemo(() => {
    void resolvedVersion;
    const htmlByIndex = new Map<number, string>();
    for (const request of requests) {
      const html = resolvedMarkdownCodeLineHtml.get(request.key);
      if (typeof html === "string") htmlByIndex.set(request.index, html);
    }
    return htmlByIndex;
  }, [requests, resolvedVersion]);
}

function createMarkdownCodeLineHtmlRequests({
  end,
  highlightPattern,
  language,
  sourceLines,
  start,
}: {
  end: number;
  highlightPattern: string;
  language: string;
  sourceLines: readonly string[];
  start: number;
}) {
  const languageId = prismLanguageForMarkdownCode(language);
  if (!languageId) return [];

  const requests: MarkdownCodeLineHtmlRequest[] = [];
  const boundedStart = Math.max(0, Math.min(start, sourceLines.length));
  const boundedEnd = Math.max(boundedStart, Math.min(end, sourceLines.length));
  for (let index = boundedStart; index < boundedEnd; index += 1) {
    const line = sourceLines[index] ?? "";
    requests.push({
      highlightPattern,
      index,
      key: markdownCodeLineHtmlKey({
        highlightPattern,
        languageId,
        line,
      }),
      languageId,
      line,
    });
  }
  return requests;
}

function ensureMarkdownCodeLineHtml(request: MarkdownCodeLineHtmlRequest) {
  if (
    resolvedMarkdownCodeLineHtml.has(request.key) ||
    pendingMarkdownCodeLineHtml.has(request.key)
  ) {
    return;
  }
  pendingMarkdownCodeLineHtml.set(request.key, request);
  scheduleMarkdownCodeHighlightFlush();
}

function scheduleMarkdownCodeHighlightFlush() {
  if (markdownCodeHighlightFlushHandle) return;
  markdownCodeHighlightFlushHandle = scheduleMarkdownCodeHighlightTask(() => {
    markdownCodeHighlightFlushHandle = null;
    flushPendingMarkdownCodeHighlights();
  });
}

function flushPendingMarkdownCodeHighlights() {
  const firstRequest = pendingMarkdownCodeLineHtml.values().next().value;
  if (!firstRequest) return;

  const requests: MarkdownCodeLineHtmlRequest[] = [];
  for (const request of pendingMarkdownCodeLineHtml.values()) {
    if (
      request.languageId !== firstRequest.languageId ||
      request.highlightPattern !== firstRequest.highlightPattern
    ) {
      continue;
    }
    pendingMarkdownCodeLineHtml.delete(request.key);
    requests.push(request);
    if (requests.length >= MARKDOWN_CODE_HIGHLIGHT_BATCH_SIZE) break;
  }

  if (requests.length === 0) return;
  if (canUseMarkdownCodeHighlightWorker()) {
    requestMarkdownCodeHighlightWorker(requests);
  } else {
    void highlightMarkdownCodeLinesOnMainThread(requests);
  }
  if (pendingMarkdownCodeLineHtml.size > 0)
    scheduleMarkdownCodeHighlightFlush();
}

function canUseMarkdownCodeHighlightWorker() {
  return (
    !isMarkdownCodeHighlightWorkerFailed &&
    typeof Worker !== "undefined" &&
    typeof window !== "undefined"
  );
}

function requestMarkdownCodeHighlightWorker(
  requests: readonly MarkdownCodeLineHtmlRequest[],
) {
  const worker = getMarkdownCodeHighlightWorker();
  if (!worker) {
    void highlightMarkdownCodeLinesOnMainThread(requests);
    return;
  }

  markdownCodeHighlightRequestId += 1;
  const requestId = markdownCodeHighlightRequestId;
  activeWorkerRequests.set(requestId, requests);
  const firstRequest = requests[0]!;
  const request: MarkdownCodeHighlightWorkerRequest = {
    generation: MARKDOWN_CODE_HIGHLIGHT_RENDERER_VERSION,
    highlightPattern: firstRequest.highlightPattern,
    languageId: firstRequest.languageId,
    lines: requests.map(({ index, line }) => ({ index, line })),
    requestId,
    type: "highlight",
  };
  worker.postMessage(request);
}

function getMarkdownCodeHighlightWorker() {
  if (markdownCodeHighlightWorker) return markdownCodeHighlightWorker;
  try {
    markdownCodeHighlightWorker = new Worker(
      new URL(
        "./markdown-greenfield-code-highlight.worker.ts",
        import.meta.url,
      ),
      { type: "module" },
    );
    markdownCodeHighlightWorker.onmessage = (
      event: MessageEvent<MarkdownCodeHighlightWorkerResponse>,
    ) => handleMarkdownCodeHighlightWorkerMessage(event.data);
    markdownCodeHighlightWorker.onerror = () =>
      failMarkdownCodeHighlightWorker();
    markdownCodeHighlightWorker.onmessageerror = () =>
      failMarkdownCodeHighlightWorker();
    return markdownCodeHighlightWorker;
  } catch {
    isMarkdownCodeHighlightWorkerFailed = true;
    return null;
  }
}

function handleMarkdownCodeHighlightWorkerMessage(
  message: MarkdownCodeHighlightWorkerResponse,
) {
  const requests = activeWorkerRequests.get(message.requestId);
  if (
    !requests ||
    message.generation !== MARKDOWN_CODE_HIGHLIGHT_RENDERER_VERSION
  ) {
    return;
  }
  activeWorkerRequests.delete(message.requestId);
  if (message.type === "error") {
    resolveMarkdownCodeLineHtmlRequests(
      requests.map((request) => ({ html: null, index: request.index })),
      requests,
    );
    return;
  }
  resolveMarkdownCodeLineHtmlRequests(message.results, requests);
}

function failMarkdownCodeHighlightWorker() {
  const activeRequests = Array.from(activeWorkerRequests.values()).flat();
  activeWorkerRequests.clear();
  markdownCodeHighlightWorker?.terminate();
  markdownCodeHighlightWorker = null;
  isMarkdownCodeHighlightWorkerFailed = true;
  if (activeRequests.length) {
    void highlightMarkdownCodeLinesOnMainThread(activeRequests);
  }
}

async function highlightMarkdownCodeLinesOnMainThread(
  requests: readonly MarkdownCodeLineHtmlRequest[],
) {
  const firstRequest = requests[0];
  if (!firstRequest) return;
  try {
    await ensureCodePrismLanguage(firstRequest.languageId);
    resolveMarkdownCodeLineHtmlRequests(
      requests.map((request) => ({
        html: shouldTokenizeCodeLine(request.line)
          ? markdownCodeTokensToHtml({
              highlightPattern: request.highlightPattern,
              line: request.line,
              tokens: tokenizePrismCodeLine(request.languageId, request.line),
            })
          : null,
        index: request.index,
      })),
      requests,
    );
  } catch {
    resolveMarkdownCodeLineHtmlRequests(
      requests.map((request) => ({ html: null, index: request.index })),
      requests,
    );
  }
}

function resolveMarkdownCodeLineHtmlRequests(
  results: readonly MarkdownCodeHighlightLineResult[],
  requests: readonly MarkdownCodeLineHtmlRequest[],
) {
  const requestsByIndex = new Map(
    requests.map((request) => [request.index, request] as const),
  );
  const resolvedKeys: string[] = [];
  for (const result of results) {
    const request = requestsByIndex.get(result.index);
    if (!request) continue;
    resolvedMarkdownCodeLineHtml.set(request.key, result.html);
    resolvedKeys.push(request.key);
  }
  trimMarkdownCodeLineHtmlCache();
  notifyMarkdownCodeLineHtmlSubscribers(resolvedKeys);
}

function notifyMarkdownCodeLineHtmlSubscribers(keys: readonly string[]) {
  const subscribers = new Set<() => void>();
  for (const key of keys) {
    for (const subscriber of markdownCodeLineHtmlSubscribers.get(key) ?? []) {
      subscribers.add(subscriber);
    }
  }
  for (const subscriber of subscribers) subscriber();
}

function trimMarkdownCodeLineHtmlCache() {
  while (
    resolvedMarkdownCodeLineHtml.size > MARKDOWN_CODE_HIGHLIGHT_CACHE_LIMIT
  ) {
    const oldestKey = resolvedMarkdownCodeLineHtml.keys().next().value;
    if (oldestKey === undefined) break;
    resolvedMarkdownCodeLineHtml.delete(oldestKey);
  }
}

function scheduleMarkdownCodeHighlightTask(callback: () => void) {
  if (typeof window === "undefined") {
    const id = setTimeout(callback, 0) as unknown as number;
    return { id, kind: "timeout" as const };
  }
  const browserWindow = window as MarkdownCodeHighlightIdleWindow;
  if (browserWindow.requestIdleCallback) {
    return {
      id: browserWindow.requestIdleCallback(callback, { timeout: 120 }),
      kind: "idle" as const,
    };
  }
  return {
    id: browserWindow.setTimeout(callback, 0),
    kind: "timeout" as const,
  };
}

export function resetMarkdownCodeHighlightForTests() {
  resolvedMarkdownCodeLineHtml.clear();
  pendingMarkdownCodeLineHtml.clear();
  markdownCodeLineHtmlSubscribers.clear();
  activeWorkerRequests.clear();
  if (markdownCodeHighlightFlushHandle) {
    cancelMarkdownCodeHighlightTask(markdownCodeHighlightFlushHandle);
  }
  markdownCodeHighlightFlushHandle = null;
  markdownCodeHighlightWorker?.terminate();
  markdownCodeHighlightWorker = null;
  isMarkdownCodeHighlightWorkerFailed = false;
  markdownCodeHighlightRequestId = 0;
}

function cancelMarkdownCodeHighlightTask(
  handle: MarkdownCodeHighlightTaskHandle,
) {
  if (typeof window === "undefined") {
    clearTimeout(handle.id);
    return;
  }
  const browserWindow = window as MarkdownCodeHighlightIdleWindow;
  if (handle.kind === "idle") {
    browserWindow.cancelIdleCallback?.(handle.id);
    return;
  }
  browserWindow.clearTimeout(handle.id);
}

function markdownCodeLineHtmlKey({
  highlightPattern,
  languageId,
  line,
}: {
  highlightPattern: string;
  languageId: string;
  line: string;
}) {
  return [
    MARKDOWN_CODE_HIGHLIGHT_RENDERER_VERSION,
    languageId,
    highlightPattern,
    line,
  ].join("\0");
}

function prismLanguageForMarkdownCode(language: string) {
  const aliases: Record<string, string> = {
    dockerfile: "dockerfile",
    js: "javascript",
    shell: "bash",
    ts: "typescript",
  };
  const languageId = aliases[language] ?? language;
  if (languageId === "text" || languageId === "plaintext") return "";
  return languageId;
}

function renderFallbackCodeTokens(line: string, language: string) {
  const tokens = tokenizeFallbackCodeLine(line, language);
  if (!tokens.length) return " ";
  return tokens.map((token, index) =>
    token.kind === "plain" ? (
      <React.Fragment key={index}>{token.value}</React.Fragment>
    ) : (
      <span
        key={index}
        className={codeTokenClassName(token.kind)}
        data-pretext-code-token={token.kind}
      >
        {token.value}
      </span>
    ),
  );
}

type CodeToken = {
  kind: "comment" | "keyword" | "literal" | "number" | "plain" | "string";
  value: string;
};

function tokenizeFallbackCodeLine(line: string, language: string): CodeToken[] {
  if (!line) return [];
  if (language === "diff") return tokenizeDiffLine(line);
  if (language === "json") return tokenizeJsonLikeLine(line);
  if (language === "yaml") return tokenizeYamlLine(line);
  if (
    language === "js" ||
    language === "jsx" ||
    language === "ts" ||
    language === "tsx"
  ) {
    return tokenizeCStyleLine(line);
  }
  if (
    language === "shell" ||
    language === "bash" ||
    language === "dockerfile"
  ) {
    return tokenizeShellLine(line);
  }
  return [{ kind: "plain", value: line }];
}

function tokenizeCStyleLine(line: string): CodeToken[] {
  const commentIndex = line.indexOf("//");
  const codePart = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
  const commentPart = commentIndex >= 0 ? line.slice(commentIndex) : "";
  return [
    ...tokenizeByPattern(
      codePart,
      /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:as|async|await|break|case|catch|class|const|continue|default|do|else|export|extends|false|finally|for|from|function|if|import|in|instanceof|interface|let|new|null|of|return|satisfies|switch|throw|true|try|type|typeof|undefined|var|while|yield)\b|\b\d+(?:\.\d+)?\b)/g,
      classifyCStyleToken,
    ),
    ...(commentPart ? [{ kind: "comment" as const, value: commentPart }] : []),
  ];
}

function classifyCStyleToken(value: string): CodeToken["kind"] {
  if (/^["'`]/.test(value)) return "string";
  if (/^\d/.test(value)) return "number";
  if (/^(?:true|false|null|undefined)$/.test(value)) return "literal";
  return "keyword";
}

function tokenizeJsonLikeLine(line: string): CodeToken[] {
  return tokenizeByPattern(
    line,
    /("(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)/gi,
    (value) => {
      if (/^"/.test(value)) return "string";
      if (/^(?:true|false|null)$/i.test(value)) return "literal";
      return "number";
    },
  );
}

function tokenizeYamlLine(line: string): CodeToken[] {
  const commentIndex = line.indexOf("#");
  const codePart = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
  const commentPart = commentIndex >= 0 ? line.slice(commentIndex) : "";
  return [
    ...tokenizeByPattern(
      codePart,
      /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?\b)/gi,
      (value) => {
        if (/^["']/.test(value)) return "string";
        if (/^(?:true|false|null)$/i.test(value)) return "literal";
        return "number";
      },
    ),
    ...(commentPart ? [{ kind: "comment" as const, value: commentPart }] : []),
  ];
}

function tokenizeShellLine(line: string): CodeToken[] {
  const commentIndex = line.search(/(^|\s)#/);
  const codePart = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
  const commentPart = commentIndex >= 0 ? line.slice(commentIndex) : "";
  return [
    ...tokenizeByPattern(
      codePart,
      /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:cd|cp|curl|echo|export|git|grep|mkdir|mv|node|npm|pnpm|rm|sed|test|yarn)\b)/g,
      (value) => (/^["']/.test(value) ? "string" : "keyword"),
    ),
    ...(commentPart ? [{ kind: "comment" as const, value: commentPart }] : []),
  ];
}

function tokenizeDiffLine(line: string): CodeToken[] {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return [{ kind: "literal", value: line }];
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return [{ kind: "comment", value: line }];
  }
  return [{ kind: "plain", value: line }];
}

function tokenizeByPattern(
  line: string,
  pattern: RegExp,
  classify: (value: string) => CodeToken["kind"],
): CodeToken[] {
  const tokens: CodeToken[] = [];
  let cursor = 0;
  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      tokens.push({ kind: "plain", value: line.slice(cursor, index) });
    }
    const value = match[0];
    tokens.push({ kind: classify(value), value });
    cursor = index + value.length;
  }
  if (cursor < line.length) {
    tokens.push({ kind: "plain", value: line.slice(cursor) });
  }
  return tokens;
}

function codeTokenClassName(kind: CodeToken["kind"]) {
  switch (kind) {
    case "comment":
      return "text-muted-foreground italic";
    case "keyword":
      return "font-semibold text-sky-700 dark:text-sky-300";
    case "literal":
      return "text-purple-700 dark:text-purple-300";
    case "number":
      return "text-amber-700 dark:text-amber-300";
    case "string":
      return "text-emerald-700 dark:text-emerald-300";
    default:
      return "";
  }
}
