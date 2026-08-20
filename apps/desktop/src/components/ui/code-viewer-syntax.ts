import type { ViewerResource } from "@/lib/viewer-resource";

import {
  type CodeSyntaxWorkerRequest,
  type CodeSyntaxWorkerResponse,
  type CodeTokenLeaf,
  shouldTokenizeCodeLine,
} from "./code-viewer-syntax-protocol";
import {
  ensureCodePrismLanguage,
  isCodePrismLanguageLoaded,
  isCodePrismLanguageSupported,
  tokenizeCodeLine,
} from "./code-viewer-syntax-prism";
import { createCodeSyntaxWorker } from "./code-viewer-syntax-worker";

export type { CodeTokenLeaf } from "./code-viewer-syntax-protocol";

export type CodeSyntax = {
  identity: string;
  destroy?: () => void;
  getLineVersion(line: string): number;
  getLineTokens(line: string): readonly CodeTokenLeaf[] | null;
  preload?: () => Promise<void>;
};

export type CodeSyntaxMode = "auto" | "main-thread" | "worker";

export type CodeSyntaxOptions = {
  deferTokens?: boolean;
  onTokensChanged?: () => void;
  syntaxMode?: CodeSyntaxMode;
  createWorker?: () => Worker;
};

const CODE_DEFERRED_TOKENIZE_BATCH_SIZE = 12;
const CODE_DEFERRED_TOKENIZE_BUDGET_MS = 6;
export const CODE_GLOBAL_TOKEN_CACHE_LIMIT = 1024;
const CODE_WORKER_TOKENIZE_BATCH_SIZE = 64;

type CodeSyntaxIdleWindow = Window &
  typeof globalThis & {
    cancelIdleCallback?: Window["cancelIdleCallback"];
    requestIdleCallback?: Window["requestIdleCallback"];
  };

type CodeSyntaxTaskHandle =
  | { kind: "idle"; id: number }
  | { kind: "timeout"; id: number };

type CodeSyntaxTaskDeadline = {
  timeRemaining?: () => number;
};

type CodeSyntaxNotifyHandle = { id: number };

type CodeSyntaxWorkerFactory = () => Worker;

type CodeSyntaxWorkerRelease = () => void;

type CodeSyntaxWorkerSubscription = {
  isReleased: boolean;
  onDone: () => void;
  onError: (line: string) => void;
  onTokens: (line: string, tokens: readonly CodeTokenLeaf[]) => void;
  pendingCount: number;
};

type CodeSyntaxWorkerJob = {
  key: string;
  languageId: string;
  line: string;
  status: "active" | "pending";
  subscribers: Set<CodeSyntaxWorkerSubscription>;
};

type CodeSyntaxWorkerBatch = {
  generation: number;
  jobs: CodeSyntaxWorkerJob[];
  languageId: string;
  requestId: number;
};

type CodeSyntaxWorkerSlot = {
  activeBatch: CodeSyntaxWorkerBatch | null;
  worker: Worker;
};

type CodeSyntaxWorkerPool = {
  createWorker: CodeSyntaxWorkerFactory;
  dispatchHandle: CodeSyntaxTaskHandle | null;
  jobsByKey: Map<string, CodeSyntaxWorkerJob>;
  maxWorkers: number;
  pendingJobs: Map<string, CodeSyntaxWorkerJob>;
  requestId: number;
  slots: CodeSyntaxWorkerSlot[];
};

const globalTokenCache = new Map<string, readonly CodeTokenLeaf[]>();
const globalWorkerPoolsByFactory = new WeakMap<
  CodeSyntaxWorkerFactory,
  CodeSyntaxWorkerPool
>();
const globalWorkerPools = new Set<CodeSyntaxWorkerPool>();
const CODE_GLOBAL_WORKER_POOL_SIZE = 2;

// File extension -> Prism language id. Prism does not map extensions to
// languages, so the viewer keeps the small explicit map.
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  json: "json",
  json5: "json",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  py: "python",
  yaml: "yaml",
  yml: "yaml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  go: "go",
  rs: "rust",
  java: "java",
  md: "markdown",
  markdown: "markdown",
  css: "css",
  html: "markup",
  htm: "markup",
  xml: "markup",
  svg: "markup",
};

// MIME -> Prism language id, used only for inline sources with no extension.
const LANGUAGE_BY_MIME: Record<string, string> = {
  "application/json": "json",
  "text/javascript": "javascript",
  "application/javascript": "javascript",
  "text/typescript": "typescript",
  "application/typescript": "typescript",
  "text/x-python": "python",
  "application/x-python": "python",
  "text/yaml": "yaml",
  "application/yaml": "yaml",
  "application/x-yaml": "yaml",
  "text/x-sh": "bash",
  "application/x-sh": "bash",
  "application/sql": "sql",
  "text/markdown": "markdown",
  "text/css": "css",
  "text/html": "markup",
  "application/xml": "markup",
  "text/xml": "markup",
};

export const CODE_VIEWER_SYNTAX_STYLE = `
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

export function createCodeSyntax(
  resource: ViewerResource,
  options: CodeSyntaxOptions = {},
): CodeSyntax {
  const detectedLanguageId = codeLanguageId(resource);
  if (!detectedLanguageId || !isCodePrismLanguageSupported(detectedLanguageId)) {
    return {
      identity: "plain",
      getLineVersion: () => 0,
      getLineTokens: () => null,
    };
  }
  const languageId = detectedLanguageId;

  const tokenVersions = new Map<string, number>();
  const asyncTokenSnapshots = new Map<string, readonly CodeTokenLeaf[]>();
  const pendingLines = new Set<string>();
  const workerReleases = new Set<CodeSyntaxWorkerRelease>();
  const workerFactory = options.createWorker ?? createCodeSyntaxWorker;
  const useWorker = shouldUseWorker(options);
  let flushHandle: CodeSyntaxTaskHandle | null = null;
  let notifyHandle: CodeSyntaxNotifyHandle | null = null;
  let grammarPromise: Promise<void> | null = null;
  let isGrammarReady = isCodePrismLanguageLoaded(languageId);
  let isGrammarFailed = false;
  let isWorkerFailed = false;
  let isDestroyed = false;
  let hasPendingTokenChanges = false;

  if (!useWorker) {
    void preloadMainThreadGrammar();
  }

  return {
    destroy,
    getLineVersion,
    getLineTokens,
    identity: languageId,
    preload: preloadMainThreadGrammar,
  };

  function destroy() {
    isDestroyed = true;
    pendingLines.clear();
    cancelFlush();
    cancelNotification();
    for (const releaseWorker of workerReleases) {
      releaseWorker();
    }
    workerReleases.clear();
  }

  function getLineVersion(line: string) {
    return tokenVersions.get(line) ?? 0;
  }

  function getLineTokens(line: string) {
    if (isDestroyed) return null;
    if (!shouldTokenizeCodeLine(line) || isGrammarFailed) return null;

    const cachedTokens = getGlobalLineTokens(languageId, line);
    if (cachedTokens) return cachedTokens;

    if (!shouldTokenizeInWorker() && isGrammarReady && !options.deferTokens) {
      const tokens = tokenizeCodeLine(languageId, line);
      if (tokens) {
        return setGlobalLineTokens(languageId, line, tokens);
      }
    }

    pendingLines.add(line);
    scheduleTokenization();
    return null;
  }

  function scheduleTokenization() {
    if (isDestroyed || pendingLines.size === 0) return;
    if (shouldTokenizeInWorker()) {
      scheduleWorkerTokenization();
      return;
    }
    scheduleMainThreadTokenization();
  }

  function scheduleWorkerTokenization() {
    if (!shouldTokenizeInWorker() || flushHandle) return;
    flushHandle = scheduleCodeSyntaxTask(() => {
      flushHandle = null;
      flushWorkerTokenBatch();
    });
  }

  function flushWorkerTokenBatch() {
    if (!shouldTokenizeInWorker() || isDestroyed) return;

    const lines = takePendingLines(CODE_WORKER_TOKENIZE_BATCH_SIZE);
    if (lines.length === 0) return;

    const uncachedLines: string[] = [];
    let didCacheTokens = false;
    for (const line of lines) {
      const cachedTokens = getGlobalLineTokens(languageId, line);
      if (cachedTokens) {
        didCacheTokens =
          cacheAsyncLineTokens(line, cachedTokens) || didCacheTokens;
      } else {
        uncachedLines.push(line);
      }
    }
    if (didCacheTokens) queueTokenChangeNotification();
    if (uncachedLines.length === 0) {
      scheduleTokenization();
      return;
    }

    let didFinishWorkerRequest = false;
    let releaseWorker: CodeSyntaxWorkerRelease | null = null;
    releaseWorker = requestCodeSyntaxWorkerTokens({
      createWorker: workerFactory,
      languageId,
      lines: uncachedLines,
      onDone: () => {
        didFinishWorkerRequest = true;
        if (releaseWorker) workerReleases.delete(releaseWorker);
        scheduleTokenization();
      },
      onError: (line) => {
        if (isDestroyed) return;
        isWorkerFailed = true;
        pendingLines.add(line);
        scheduleMainThreadTokenization();
      },
      onTokens: (line, tokens) => {
        if (isDestroyed) return;
        if (cacheAsyncLineTokens(line, tokens)) queueTokenChangeNotification();
      },
    });
    if (!didFinishWorkerRequest) workerReleases.add(releaseWorker);
    scheduleTokenization();
  }

  function scheduleMainThreadTokenization() {
    if (isDestroyed || flushHandle || isGrammarFailed) return;
    if (!isGrammarReady) {
      void preloadMainThreadGrammar();
      return;
    }
    flushHandle = scheduleCodeSyntaxTask(flushMainThreadTokenBatch);
  }

  async function preloadMainThreadGrammar() {
    if (shouldTokenizeInWorker() || isGrammarReady || isGrammarFailed) return;
    if (!grammarPromise) {
      grammarPromise = ensureCodePrismLanguage(languageId)
        .then(() => {
          if (isDestroyed) return;
          isGrammarReady = true;
          scheduleMainThreadTokenization();
        })
        .catch(() => {
          if (isDestroyed) return;
          isGrammarFailed = true;
          pendingLines.clear();
        });
    }
    await grammarPromise;
  }

  function flushMainThreadTokenBatch(deadline?: CodeSyntaxTaskDeadline) {
    flushHandle = null;
    if (isDestroyed || isGrammarFailed || !isGrammarReady) return;

    const startedAt = codeSyntaxNow();
    let processedLineCount = 0;
    while (pendingLines.size > 0) {
      const pendingLine = pendingLines.values().next().value;
      if (pendingLine == null) break;
      pendingLines.delete(pendingLine);

      const cachedTokens = getGlobalLineTokens(languageId, pendingLine);
      if (cachedTokens) {
        hasPendingTokenChanges =
          cacheAsyncLineTokens(pendingLine, cachedTokens) ||
          hasPendingTokenChanges;
      } else {
        const tokens = tokenizeCodeLine(languageId, pendingLine);
        if (tokens) {
          hasPendingTokenChanges =
            cacheAsyncLineTokens(pendingLine, tokens) || hasPendingTokenChanges;
        }
      }

      processedLineCount += 1;
      if (
        shouldYieldDeferredTokenization({
          deadline,
          processedLineCount,
          startedAt,
        })
      ) {
        break;
      }
    }

    if (pendingLines.size > 0) {
      scheduleMainThreadTokenization();
      return;
    }

    if (hasPendingTokenChanges) {
      hasPendingTokenChanges = false;
      queueTokenChangeNotification();
    }
  }

  function takePendingLines(limit: number) {
    const lines: string[] = [];
    for (const line of pendingLines) {
      pendingLines.delete(line);
      lines.push(line);
      if (lines.length >= limit) break;
    }
    return lines;
  }

  function cacheAsyncLineTokens(
    line: string,
    tokens: readonly CodeTokenLeaf[],
  ) {
    const cachedTokens = setGlobalLineTokens(languageId, line, tokens);
    const previousTokens = asyncTokenSnapshots.get(line);
    if (
      previousTokens &&
      areCodeTokenLeavesEqual(previousTokens, cachedTokens)
    ) {
      return false;
    }

    asyncTokenSnapshots.set(line, cachedTokens);
    tokenVersions.set(line, (tokenVersions.get(line) ?? 0) + 1);
    return true;
  }

  function shouldTokenizeInWorker() {
    return useWorker && !isWorkerFailed;
  }

  function queueTokenChangeNotification() {
    if (isDestroyed || notifyHandle) return;
    notifyHandle = scheduleCodeSyntaxNotification(() => {
      notifyHandle = null;
      if (!isDestroyed) options.onTokensChanged?.();
    });
  }

  function cancelFlush() {
    if (!flushHandle) return;
    cancelCodeSyntaxTask(flushHandle);
    flushHandle = null;
  }

  function cancelNotification() {
    if (!notifyHandle) return;
    cancelCodeSyntaxNotification(notifyHandle);
    notifyHandle = null;
  }
}

export function clearCodeSyntaxGlobalTokenCacheForTests() {
  globalTokenCache.clear();
  for (const pool of globalWorkerPools) {
    cancelCodeSyntaxWorkerPoolDispatch(pool);
    for (const slot of pool.slots) {
      slot.worker.terminate();
    }
    pool.slots = [];
    pool.pendingJobs.clear();
    pool.jobsByKey.clear();
  }
}

function shouldUseWorker(options: CodeSyntaxOptions) {
  if (options.syntaxMode === "main-thread") return false;
  if (options.syntaxMode === "worker") return true;
  return typeof Worker !== "undefined";
}

function getGlobalLineTokens(languageId: string, line: string) {
  const key = codeGlobalTokenCacheKey(languageId, line);
  const tokens = globalTokenCache.get(key);
  if (!tokens) return null;

  globalTokenCache.delete(key);
  globalTokenCache.set(key, tokens);
  return tokens;
}

function setGlobalLineTokens(
  languageId: string,
  line: string,
  tokens: readonly CodeTokenLeaf[],
) {
  const key = codeGlobalTokenCacheKey(languageId, line);
  const cachedTokens = getGlobalLineTokens(languageId, line);
  if (cachedTokens && areCodeTokenLeavesEqual(cachedTokens, tokens)) {
    return cachedTokens;
  }

  globalTokenCache.delete(key);
  globalTokenCache.set(key, tokens);
  while (globalTokenCache.size > CODE_GLOBAL_TOKEN_CACHE_LIMIT) {
    const firstKey = globalTokenCache.keys().next().value;
    if (firstKey === undefined) return tokens;
    globalTokenCache.delete(firstKey);
  }
  return tokens;
}

function codeGlobalTokenCacheKey(languageId: string, line: string) {
  return `${languageId}\0${line}`;
}

function requestCodeSyntaxWorkerTokens({
  createWorker,
  languageId,
  lines,
  onDone,
  onError,
  onTokens,
}: {
  createWorker: CodeSyntaxWorkerFactory;
  languageId: string;
  lines: readonly string[];
  onDone: () => void;
  onError: (line: string) => void;
  onTokens: (line: string, tokens: readonly CodeTokenLeaf[]) => void;
}): CodeSyntaxWorkerRelease {
  const pool = getCodeSyntaxWorkerPool(createWorker);
  const subscription: CodeSyntaxWorkerSubscription = {
    isReleased: false,
    onDone,
    onError,
    onTokens,
    pendingCount: 0,
  };
  const jobs: CodeSyntaxWorkerJob[] = [];

  for (const line of lines) {
    const cachedTokens = getGlobalLineTokens(languageId, line);
    if (cachedTokens) {
      onTokens(line, cachedTokens);
      continue;
    }

    const key = codeGlobalTokenCacheKey(languageId, line);
    let job = pool.jobsByKey.get(key);
    if (!job) {
      job = {
        key,
        languageId,
        line,
        status: "pending",
        subscribers: new Set(),
      };
      pool.jobsByKey.set(key, job);
      pool.pendingJobs.set(key, job);
    }
    job.subscribers.add(subscription);
    subscription.pendingCount += 1;
    jobs.push(job);
  }

  if (subscription.pendingCount === 0) {
    onDone();
    return () => undefined;
  }

  dispatchCodeSyntaxWorkerPool(pool);

  return () => {
    if (subscription.isReleased) return;
    subscription.isReleased = true;
    for (const job of jobs) {
      releaseCodeSyntaxWorkerSubscription(pool, job, subscription);
    }
  };
}

function getCodeSyntaxWorkerPool(createWorker: CodeSyntaxWorkerFactory) {
  let pool = globalWorkerPoolsByFactory.get(createWorker);
  if (!pool) {
    pool = {
      createWorker,
      dispatchHandle: null,
      jobsByKey: new Map(),
      maxWorkers:
        createWorker === createCodeSyntaxWorker
          ? CODE_GLOBAL_WORKER_POOL_SIZE
          : 1,
      pendingJobs: new Map(),
      requestId: 0,
      slots: [],
    };
    globalWorkerPoolsByFactory.set(createWorker, pool);
    globalWorkerPools.add(pool);
  }
  return pool;
}

function scheduleCodeSyntaxWorkerPoolDispatch(pool: CodeSyntaxWorkerPool) {
  if (pool.pendingJobs.size === 0 || pool.dispatchHandle) return;
  pool.dispatchHandle = scheduleCodeSyntaxTask(() => {
    pool.dispatchHandle = null;
    dispatchCodeSyntaxWorkerPool(pool);
  });
}

function cancelCodeSyntaxWorkerPoolDispatch(pool: CodeSyntaxWorkerPool) {
  if (!pool.dispatchHandle) return;
  cancelCodeSyntaxTask(pool.dispatchHandle);
  pool.dispatchHandle = null;
}

function dispatchCodeSyntaxWorkerPool(pool: CodeSyntaxWorkerPool) {
  while (pool.pendingJobs.size > 0) {
    const slot = getIdleCodeSyntaxWorkerSlot(pool);
    if (!slot) return;

    const jobs = takeCodeSyntaxWorkerJobs(pool, CODE_WORKER_TOKENIZE_BATCH_SIZE);
    if (jobs.length === 0) return;

    pool.requestId += 1;
    const requestId = pool.requestId;
    const languageId = jobs[0]?.languageId ?? "";
    const batch: CodeSyntaxWorkerBatch = {
      generation: requestId,
      jobs,
      languageId,
      requestId,
    };
    slot.activeBatch = batch;

    const request: CodeSyntaxWorkerRequest = {
      type: "tokenize",
      generation: batch.generation,
      languageId,
      lines: jobs.map((job) => job.line),
      requestId,
    };
    slot.worker.postMessage(request);
  }
}

function getIdleCodeSyntaxWorkerSlot(pool: CodeSyntaxWorkerPool) {
  const idleSlot = pool.slots.find((slot) => !slot.activeBatch);
  if (idleSlot) return idleSlot;
  if (pool.slots.length >= pool.maxWorkers) return null;

  try {
    const slot: CodeSyntaxWorkerSlot = {
      activeBatch: null,
      worker: pool.createWorker(),
    };
    slot.worker.onmessage = (event: MessageEvent<CodeSyntaxWorkerResponse>) => {
      handleCodeSyntaxWorkerPoolMessage(pool, slot, event.data);
    };
    slot.worker.onerror = () => {
      handleCodeSyntaxWorkerPoolFailure(pool, slot);
    };
    slot.worker.onmessageerror = () => {
      handleCodeSyntaxWorkerPoolFailure(pool, slot);
    };
    pool.slots.push(slot);
    return slot;
  } catch {
    failPendingCodeSyntaxWorkerJobs(pool);
    return null;
  }
}

function takeCodeSyntaxWorkerJobs(
  pool: CodeSyntaxWorkerPool,
  limit: number,
) {
  const firstJob = pool.pendingJobs.values().next().value;
  if (!firstJob) return [];

  const jobs: CodeSyntaxWorkerJob[] = [];
  for (const job of pool.pendingJobs.values()) {
    if (job.languageId !== firstJob.languageId) continue;
    pool.pendingJobs.delete(job.key);
    job.status = "active";
    jobs.push(job);
    if (jobs.length >= limit) break;
  }
  return jobs;
}

function handleCodeSyntaxWorkerPoolMessage(
  pool: CodeSyntaxWorkerPool,
  slot: CodeSyntaxWorkerSlot,
  message: CodeSyntaxWorkerResponse,
) {
  const batch = slot.activeBatch;
  if (
    !batch ||
    message.generation !== batch.generation ||
    message.languageId !== batch.languageId ||
    message.requestId !== batch.requestId
  ) {
    return;
  }

  slot.activeBatch = null;

  if (message.type === "error") {
    terminateCodeSyntaxWorkerSlot(pool, slot);
    finishCodeSyntaxWorkerJobsWithError(pool, batch.jobs);
    scheduleCodeSyntaxWorkerPoolDispatch(pool);
    return;
  }

  const resultsByLine = new Map(
    message.results.map((result) => [result.line, result.tokens] as const),
  );

  for (const job of batch.jobs) {
    pool.jobsByKey.delete(job.key);
    const tokens = resultsByLine.get(job.line) ?? null;
    if (tokens) setGlobalLineTokens(job.languageId, job.line, tokens);
    for (const subscriber of job.subscribers) {
      if (!subscriber.isReleased && tokens) {
        subscriber.onTokens(job.line, tokens);
      }
      completeCodeSyntaxWorkerSubscription(subscriber);
    }
    job.subscribers.clear();
  }

  dispatchCodeSyntaxWorkerPool(pool);
}

function handleCodeSyntaxWorkerPoolFailure(
  pool: CodeSyntaxWorkerPool,
  slot: CodeSyntaxWorkerSlot,
) {
  const batch = slot.activeBatch;
  slot.activeBatch = null;
  terminateCodeSyntaxWorkerSlot(pool, slot);
  if (batch) finishCodeSyntaxWorkerJobsWithError(pool, batch.jobs);
  scheduleCodeSyntaxWorkerPoolDispatch(pool);
}

function terminateCodeSyntaxWorkerSlot(
  pool: CodeSyntaxWorkerPool,
  slot: CodeSyntaxWorkerSlot,
) {
  slot.worker.terminate();
  pool.slots = pool.slots.filter((candidate) => candidate !== slot);
}

function failPendingCodeSyntaxWorkerJobs(pool: CodeSyntaxWorkerPool) {
  const jobs = Array.from(pool.pendingJobs.values());
  pool.pendingJobs.clear();
  finishCodeSyntaxWorkerJobsWithError(pool, jobs);
}

function finishCodeSyntaxWorkerJobsWithError(
  pool: CodeSyntaxWorkerPool,
  jobs: readonly CodeSyntaxWorkerJob[],
) {
  for (const job of jobs) {
    pool.jobsByKey.delete(job.key);
    pool.pendingJobs.delete(job.key);
    for (const subscriber of job.subscribers) {
      if (!subscriber.isReleased) subscriber.onError(job.line);
      completeCodeSyntaxWorkerSubscription(subscriber);
    }
    job.subscribers.clear();
  }
}

function releaseCodeSyntaxWorkerSubscription(
  pool: CodeSyntaxWorkerPool,
  job: CodeSyntaxWorkerJob,
  subscriber: CodeSyntaxWorkerSubscription,
) {
  job.subscribers.delete(subscriber);
  if (job.subscribers.size > 0 || job.status === "active") return;
  pool.pendingJobs.delete(job.key);
  pool.jobsByKey.delete(job.key);
}

function completeCodeSyntaxWorkerSubscription(
  subscriber: CodeSyntaxWorkerSubscription,
) {
  if (subscriber.isReleased) return;
  subscriber.pendingCount -= 1;
  if (subscriber.pendingCount <= 0) {
    subscriber.isReleased = true;
    subscriber.onDone();
  }
}

function scheduleCodeSyntaxTask(
  callback: (deadline?: CodeSyntaxTaskDeadline) => void,
): CodeSyntaxTaskHandle {
  const browserWindow = window as CodeSyntaxIdleWindow;
  if (browserWindow.requestIdleCallback) {
    return {
      kind: "idle",
      id: browserWindow.requestIdleCallback(callback, { timeout: 80 }),
    };
  }

  return {
    kind: "timeout",
    id: browserWindow.setTimeout(() => callback(), 0),
  };
}

function cancelCodeSyntaxTask(handle: CodeSyntaxTaskHandle) {
  const browserWindow = window as CodeSyntaxIdleWindow;
  if (handle.kind === "idle") {
    browserWindow.cancelIdleCallback?.(handle.id);
    return;
  }
  browserWindow.clearTimeout(handle.id);
}

function scheduleCodeSyntaxNotification(
  callback: () => void,
): CodeSyntaxNotifyHandle {
  return { id: window.setTimeout(callback, 0) };
}

function cancelCodeSyntaxNotification(handle: CodeSyntaxNotifyHandle) {
  window.clearTimeout(handle.id);
}

function areCodeTokenLeavesEqual(
  first: readonly CodeTokenLeaf[],
  second: readonly CodeTokenLeaf[],
) {
  if (first === second) return true;
  if (first.length !== second.length) return false;
  for (let index = 0; index < first.length; index += 1) {
    const firstLeaf = first[index];
    const secondLeaf = second[index];
    if (
      firstLeaf?.kind !== secondLeaf?.kind ||
      firstLeaf?.text !== secondLeaf?.text
    ) {
      return false;
    }
  }
  return true;
}

function shouldYieldDeferredTokenization({
  deadline,
  processedLineCount,
  startedAt,
}: {
  deadline?: CodeSyntaxTaskDeadline;
  processedLineCount: number;
  startedAt: number;
}) {
  if (processedLineCount <= 0) return false;
  if (deadline?.timeRemaining && deadline.timeRemaining() <= 1) return true;
  if (processedLineCount >= CODE_DEFERRED_TOKENIZE_BATCH_SIZE) return true;
  return codeSyntaxNow() - startedAt >= CODE_DEFERRED_TOKENIZE_BUDGET_MS;
}

function codeSyntaxNow() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function codeLanguageId(resource: ViewerResource): string | null {
  const extension = resource.fileName.toLowerCase().split(".").pop();
  const byExtension = extension ? LANGUAGE_BY_EXTENSION[extension] : undefined;
  if (byExtension) return byExtension;

  const mimeType = resource.content.mimeType
    ?.toLowerCase()
    .split(";")[0]
    .trim();
  return (mimeType && LANGUAGE_BY_MIME[mimeType]) ?? null;
}
