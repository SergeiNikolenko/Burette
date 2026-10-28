import { plugin } from "bun";
import { afterAll, expect, mock, test } from "bun:test";
import { transformSync } from "@babel/core";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import React, { act, useLayoutEffect } from "react";
import type { ViewerDocument } from "../apps/desktop/src/types";

plugin({ name: "source-text-react-compiler", setup(build) {
  build.onLoad({ filter: /use-structure-source-text\.ts$/u }, ({ path }) => ({
    contents: transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false,
      parserOpts: { plugins: ["typescript"] }, plugins: [["babel-plugin-react-compiler", {}]] })!.code!, loader: "ts",
  }));
} });
const browser = new Window(), previous = new Map<string, PropertyDescriptor | undefined>();
Object.assign(browser, { __TAURI_INTERNALS__: {} });
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, HTMLIFrameElement: browser.HTMLIFrameElement, Node: browser.Node, Event: browser.Event,
  MutationObserver: browser.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
afterAll(() => { for (const [key, value] of previous) {
  if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key);
} });
type Read = { path: string; resolve: (text: string) => void; reject: (error: Error) => void };
const reads: Read[] = [];
const bridge = await import("@tauri-apps/api/core");
mock.module("@tauri-apps/api/core", () => ({ ...bridge, invoke: (command: string, args: { path: string }) => {
  if (command !== "read_structure_text") throw new Error(`Unexpected bridge command: ${command}`);
  return new Promise<string>((resolve, reject) => reads.push({ path: args.path, resolve, reject }));
} }));
const { createRoot } = await import("react-dom/client");
const { SourceEditingProvider } = await import("../apps/desktop/src/lib/source-editing/context");
const { adoptLogicalSource, releaseClosedScienceSessions } = await import("../apps/desktop/src/lib/science-session/state");
const { useStructureSourceText } = await import("../apps/desktop/src/lib/source-editing/use-structure-source-text");
const doc = (id = "a", runtimePath = "runtime-1") => ({ id, path: "/same-path.mol", runtimePath, title: "same-path.mol", extension: "mol" }) as ViewerDocument;
async function fixture() {
  reads.length = 0; releaseClosedScienceSessions(new Set());
  const host = browser.document.createElement("div"); browser.document.body.append(host); const root = createRoot(host);
  let current = { text: null as string | null, error: null as string | null };
  const committed: typeof current[] = [];
  function Probe({ document }: { document: ViewerDocument | null }) {
    const state = useStructureSourceText(document); current = state;
    useLayoutEffect(() => { committed.push(state); });
    return <output>{state.error ?? state.text ?? "pending"}</output>;
  }
  return { committed, current: () => current,
    async render(document: ViewerDocument | null, content?: string) {
      const value = { sessionForDocument: (candidate: ViewerDocument | null) => candidate && content !== undefined ? { documentId: candidate.id, content } : null };
      await act(async () => root.render(<SourceEditingProvider value={value as never}><Probe document={document} /></SourceEditingProvider>));
    }, async close() { await act(async () => root.unmount()); host.remove(); releaseClosedScienceSessions(new Set()); } };
}
const logical = (document: ViewerDocument, text: string) => adoptLogicalSource({ documentId: document.id, extension: "sdf", text }, "fixture-uuid", null, []);

test("compiled hook prioritizes unsaved draft over reactive logical MOLX source and bypasses filesystem", async () => {
  const f = await fixture(), document = { ...doc(), path: "/scene.molx", extension: "molx" };
  try {
    logical(document, "logical original"); await f.render(document, "draft");
    expect(f.current()).toEqual({ text: "draft", error: null }); expect(reads).toHaveLength(0);
    await act(async () => logical(document, "logical update"));
    expect(f.current().text).toBe("draft");
    await f.render(document); expect(f.current()).toEqual({ text: "logical update", error: null });
    await act(async () => logical(document, "restored later")); expect(f.current().text).toBe("restored later");
    expect(reads).toHaveLength(0);
  } finally { await f.close(); }
});

test("replacement identity at the same path masks old text immediately and rejects late reads/errors", async () => {
  const f = await fixture(), first = doc();
  try {
    await f.render(first); expect(reads.map(read => read.path)).toEqual([first.path]);
    await act(async () => reads[0].resolve("old source")); expect(f.current().text).toBe("old source");
    await f.render(first); expect(reads).toHaveLength(1);
    const count = f.committed.length; await f.render({ ...first, runtimePath: "runtime-2" });
    expect(f.committed.slice(count).every(state => state.text === null)).toBe(true);
    expect(reads).toHaveLength(2); await f.render(doc("replacement", "runtime-3"));
    await act(async () => reads[1].reject(new Error("obsolete failure")));
    expect(f.current()).toEqual({ text: null, error: null });
    await act(async () => reads[2].resolve("replacement source"));
    expect(f.current()).toEqual({ text: "replacement source", error: null });
    await f.render(null); expect(f.current()).toEqual({ text: null, error: null });
  } finally { await f.close(); }
});

test("a draft or restored logical source cancels pending file publication and errors stay scoped to current identity", async () => {
  const f = await fixture(), first = doc();
  try {
    await f.render(first); await f.render(first, "draft owns source");
    await act(async () => reads[0].resolve("late filesystem")); expect(f.current().text).toBe("draft owns source");
    await f.render(first); expect(reads).toHaveLength(2);
    await act(async () => logical(first, "restored owns source"));
    await act(async () => reads[1].reject(new Error("late filesystem error")));
    expect(f.current()).toEqual({ text: "restored owns source", error: null });
    await f.render(doc("other")); await act(async () => reads[2].reject(new Error("current read failed")));
    expect(f.current()).toEqual({ text: null, error: "current read failed" });
    await f.render(doc("third")); expect(f.current()).toEqual({ text: null, error: null });
    await act(async () => reads[3].resolve("third source")); expect(f.current().text).toBe("third source");
  } finally { await f.close(); }
});

test("a replacement document object at the same path and runtime cannot inherit old source text", async () => {
  const f = await fixture(), first = doc();
  try {
    await f.render(first); await act(async () => reads[0].resolve("before external reload"));
    await f.render({ ...first, byteCount: 999 });
    expect(f.current()).toEqual({ text: null, error: null });
    expect(reads).toHaveLength(2);
    // A replacement can have identical scalar metadata and still own different bytes.
    await f.render({ ...first, byteCount: 999 });
    await act(async () => reads[1].resolve("late replacement"));
    expect(f.current()).toEqual({ text: null, error: null });
    await act(async () => reads[2].resolve("latest replacement"));
    expect(f.current()).toEqual({ text: "latest replacement", error: null });
  } finally { await f.close(); }
});

for (const overlay of ["draft", "logical"] as const) for (const previousError of [false, true]) {
  test(`${overlay} removal hides the prior file ${previousError ? "error" : "text"} until a fresh read finishes`, async () => {
    const f = await fixture(), document = doc();
    try {
      await f.render(document);
      await act(async () => { if (previousError) reads[0].reject(new Error("obsolete file error")); else reads[0].resolve("old file text"); });
      expect(f.current()).toEqual(previousError ? { text: null, error: "obsolete file error" } : { text: "old file text", error: null });
      if (overlay === "draft") await f.render(document, "saved new source");
      else await act(async () => logical(document, "saved new source"));
      expect(f.current()).toEqual({ text: "saved new source", error: null });
      const committedBefore = f.committed.length;
      if (overlay === "draft") await f.render(document);
      else await act(async () => releaseClosedScienceSessions(new Set()));
      expect(reads).toHaveLength(2);
      expect(f.committed.slice(committedBefore).every(state => state.text === null && state.error === null)).toBe(true);
      expect(f.current()).toEqual({ text: null, error: null });
      await act(async () => reads[1].resolve("fresh file source"));
      expect(f.current()).toEqual({ text: "fresh file source", error: null });
    } finally { await f.close(); }
  });
}
