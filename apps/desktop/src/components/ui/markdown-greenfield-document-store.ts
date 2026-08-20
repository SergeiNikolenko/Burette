"use client";

import * as React from "react";

import {
  createMarkdownGreenfieldDocument,
  freezeMarkdownGreenfieldDocument,
  markdownGreenfieldDocumentTextKey,
  type MarkdownGreenfieldDocument,
} from "./markdown-greenfield-document";

export const MARKDOWN_GREENFIELD_ASYNC_DOCUMENT_MIN_CHARS = 60_000;
export const MARKDOWN_GREENFIELD_DOCUMENT_WORKER_LOCAL_STORAGE_KEY =
  "retab:markdown-document-worker";
export const MARKDOWN_GREENFIELD_DOCUMENT_WORKER_SEARCH_PARAM =
  "markdownDocumentWorker";

const MARKDOWN_GREENFIELD_DOCUMENT_WORKER_READY_TIMEOUT_MS = 800;
const MARKDOWN_GREENFIELD_DOCUMENT_ENTRY_CACHE_LIMIT = 16;

type MarkdownIdleWindow = Window &
  typeof globalThis & {
    requestIdleCallback?: Window["requestIdleCallback"];
  };

type MarkdownDocumentState =
  | { status: "failed"; error: Error }
  | { status: "pending" }
  | { status: "ready"; document: MarkdownGreenfieldDocument };

type MarkdownDocumentEntry = {
  key: string;
  listeners: Set<() => void>;
  started: boolean;
  state: MarkdownDocumentState;
  text: string;
};

type MarkdownDocumentWorkerRequest = {
  id: number;
  text: string;
  type: "parse";
};

type MarkdownDocumentWorkerResponse =
  | {
      type: "ready";
    }
  | {
      document: MarkdownGreenfieldDocument;
      id: number;
      ok: true;
      type: "result";
    }
  | {
      failure: "clone_failed" | "parse_failed";
      id: number;
      message: string;
      ok: false;
      type: "result";
    };

const markdownDocumentEntries = new Map<string, MarkdownDocumentEntry>();
let nextMarkdownDocumentWorkerRequestId = 1;

export function useMarkdownGreenfieldDocument(text: string) {
  const shouldLoadAsync =
    text.length >= MARKDOWN_GREENFIELD_ASYNC_DOCUMENT_MIN_CHARS;
  const syncDocument = React.useMemo(
    () => (shouldLoadAsync ? null : createMarkdownGreenfieldDocument(text)),
    [shouldLoadAsync, text],
  );
  const entry = React.useMemo(
    () => (shouldLoadAsync ? getMarkdownDocumentEntry(text) : null),
    [shouldLoadAsync, text],
  );
  const asyncState = React.useSyncExternalStore(
    React.useCallback(
      (onStoreChange) => {
        if (!entry) return () => {};
        entry.listeners.add(onStoreChange);
        startMarkdownDocumentEntry(entry);
        return () => {
          entry.listeners.delete(onStoreChange);
        };
      },
      [entry],
    ),
    React.useCallback(() => entry?.state ?? null, [entry]),
    () => null,
  );

  if (syncDocument) return syncDocument;
  if (!asyncState || asyncState.status === "pending") return null;
  if (asyncState.status === "failed") throw asyncState.error;
  return asyncState.document;
}

function getMarkdownDocumentEntry(text: string) {
  const key = markdownGreenfieldDocumentTextKey(text);
  const existing = markdownDocumentEntries.get(key);
  if (existing?.text === text) return existing;

  const entry: MarkdownDocumentEntry = {
    key,
    listeners: new Set(),
    started: false,
    state: { status: "pending" },
    text,
  };
  markdownDocumentEntries.set(key, entry);
  evictMarkdownDocumentEntries(key);
  return entry;
}

function evictMarkdownDocumentEntries(currentKey: string) {
  for (const [key, entry] of markdownDocumentEntries) {
    if (
      markdownDocumentEntries.size <=
      MARKDOWN_GREENFIELD_DOCUMENT_ENTRY_CACHE_LIMIT
    ) {
      return;
    }
    if (key === currentKey || entry.listeners.size > 0) continue;
    markdownDocumentEntries.delete(key);
  }
}

function startMarkdownDocumentEntry(entry: MarkdownDocumentEntry) {
  if (entry.started || entry.state.status !== "pending") return;
  entry.started = true;

  if (typeof Worker !== "undefined" && isMarkdownDocumentWorkerEnabled()) {
    try {
      startMarkdownDocumentWorker(entry);
      return;
    } catch {
      startMarkdownDocumentFallback(entry);
      return;
    }
  }

  startMarkdownDocumentFallback(entry);
}

function startMarkdownDocumentWorker(entry: MarkdownDocumentEntry) {
  const worker = new Worker(
    new URL("./markdown-greenfield-document.worker.ts", import.meta.url),
    { type: "module" },
  );
  const id = nextMarkdownDocumentWorkerRequestId++;
  let isSettled = false;

  const fallBackToMainThread = () => {
    if (isSettled) return;
    isSettled = true;
    window.clearTimeout(readyTimeoutId);
    if (!isCurrentMarkdownDocumentEntry(entry)) {
      worker.terminate();
      return;
    }
    worker.terminate();
    startMarkdownDocumentFallback(entry);
  };
  const readyTimeoutId = window.setTimeout(() => {
    fallBackToMainThread();
  }, MARKDOWN_GREENFIELD_DOCUMENT_WORKER_READY_TIMEOUT_MS);

  worker.onmessage = (event: MessageEvent<unknown>) => {
    const message = markdownDocumentWorkerResponseFromValue(event.data);
    if (!message) {
      fallBackToMainThread();
      return;
    }

    if (message.type === "ready") {
      window.clearTimeout(readyTimeoutId);
      try {
        worker.postMessage({
          id,
          text: entry.text,
          type: "parse",
        } satisfies MarkdownDocumentWorkerRequest);
      } catch {
        fallBackToMainThread();
      }
      return;
    }
    if (message.id !== id || isSettled) {
      return;
    }
    isSettled = true;
    window.clearTimeout(readyTimeoutId);
    worker.terminate();
    if (!isCurrentMarkdownDocumentEntry(entry)) return;
    if (message.ok) {
      publishMarkdownDocumentState(entry, {
        document: freezeMarkdownGreenfieldDocument(message.document),
        status: "ready",
      });
      return;
    }
    if (message.failure === "clone_failed") {
      startMarkdownDocumentFallback(entry);
      return;
    }
    publishMarkdownDocumentState(entry, {
      error: new Error(message.message),
      status: "failed",
    });
  };
  worker.onerror = fallBackToMainThread;
  worker.onmessageerror = fallBackToMainThread;
}

function startMarkdownDocumentFallback(entry: MarkdownDocumentEntry) {
  scheduleMarkdownDocumentTask(() => {
    if (!isCurrentMarkdownDocumentEntry(entry)) return;
    try {
      publishMarkdownDocumentState(entry, {
        document: createMarkdownGreenfieldDocument(entry.text),
        status: "ready",
      });
    } catch (error) {
      publishMarkdownDocumentState(entry, {
        error:
          error instanceof Error
            ? error
            : new Error("Could not parse Markdown."),
        status: "failed",
      });
    }
  });
}

function scheduleMarkdownDocumentTask(callback: () => void) {
  if (typeof window === "undefined") return;
  const browserWindow = window as MarkdownIdleWindow;
  const runWhenIdle = () => {
    if (browserWindow.requestIdleCallback) {
      browserWindow.requestIdleCallback(callback, { timeout: 120 });
      return;
    }
    browserWindow.setTimeout(callback, 0);
  };

  if (browserWindow.requestAnimationFrame) {
    browserWindow.requestAnimationFrame(() => {
      browserWindow.setTimeout(runWhenIdle, 0);
    });
    return;
  }
  browserWindow.setTimeout(runWhenIdle, 0);
}

function publishMarkdownDocumentState(
  entry: MarkdownDocumentEntry,
  state: MarkdownDocumentState,
) {
  if (!isCurrentMarkdownDocumentEntry(entry)) return;
  entry.state = state;
  for (const listener of entry.listeners) listener();
}

function isCurrentMarkdownDocumentEntry(entry: MarkdownDocumentEntry) {
  const current = markdownDocumentEntries.get(entry.key);
  return current === entry && current.text === entry.text;
}

function isMarkdownDocumentWorkerEnabled() {
  if (typeof window === "undefined") return false;
  const urlFlag = readMarkdownDocumentWorkerSearchFlag(window.location.search);
  if (urlFlag != null) return urlFlag;
  return readMarkdownDocumentWorkerStorageFlag() ?? true;
}

function readMarkdownDocumentWorkerSearchFlag(search: string) {
  try {
    const value = new URLSearchParams(search).get(
      MARKDOWN_GREENFIELD_DOCUMENT_WORKER_SEARCH_PARAM,
    );
    return markdownDocumentWorkerFlagValue(value);
  } catch {
    return null;
  }
}

function readMarkdownDocumentWorkerStorageFlag() {
  try {
    return markdownDocumentWorkerFlagValue(
      window.localStorage.getItem(
        MARKDOWN_GREENFIELD_DOCUMENT_WORKER_LOCAL_STORAGE_KEY,
      ),
    );
  } catch {
    return null;
  }
}

function markdownDocumentWorkerFlagValue(value: string | null) {
  if (value == null) return null;
  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
    case "worker":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
    case "main":
      return false;
    default:
      return null;
  }
}

function markdownDocumentWorkerResponseFromValue(
  value: unknown,
): MarkdownDocumentWorkerResponse | null {
  if (!value || typeof value !== "object") return null;
  const response = value as Partial<MarkdownDocumentWorkerResponse>;
  if (response.type === "ready") return { type: "ready" };
  if (response.type !== "result" || typeof response.id !== "number") {
    return null;
  }
  if (response.ok === true && response.document) {
    return response as MarkdownDocumentWorkerResponse;
  }
  if (
    response.ok === false &&
    (response.failure === "clone_failed" ||
      response.failure === "parse_failed") &&
    typeof response.message === "string"
  ) {
    return response as MarkdownDocumentWorkerResponse;
  }
  return null;
}
