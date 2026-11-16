import assert from "node:assert/strict";
import { afterAll } from "bun:test";
import type { ViewerDocument } from "../apps/desktop/src/types";
import type { StructureDragRecord } from "../apps/desktop/src/lib/structure-drag";
import type { ScientificDocument } from "../apps/desktop/src/lib/molecular-workbench/scientific-types";
import { readFileSync } from "node:fs";
import { plugin } from "bun";
import { transformSync } from "@babel/core";
import { Window, type HTMLElement as BrowserElement } from "happy-dom";
import React, { act } from "react";

// The app build runs apps/desktop/src through the React Compiler (vite.config.ts); compile the
// download button and the import owner the same way so memoization matches the shipped bundle.
plugin({
  name: "react-compiler",
  setup(build) {
    build.onLoad({ filter: /apps\/desktop\/src\/(lib\/workbench\/scientific-source-state\.ts|components\/browser-structure-download\.tsx)$/ }, ({ path }) => {
      const tsx = path.endsWith(".tsx");
      // Like the build's Babel pass: the compiler reads TypeScript; types are stripped afterwards.
      const compiled = transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false,
        parserOpts: { plugins: tsx ? ["typescript", "jsx"] : ["typescript"] }, plugins: [["babel-plugin-react-compiler", {}]] });
      if (!compiled?.code) throw new Error("Compiler returned no code");
      assert.match(compiled.code, /react\/compiler-runtime/u, `${path} was compiled`);
      return { contents: compiled.code, loader: tsx ? "tsx" : "ts" };
    });
  },
});

const window = new Window({ url: "http://localhost/" });
const previous = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({
  window, self: window, document: window.document, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement,
  SVGElement: window.SVGElement, DocumentFragment: window.DocumentFragment, MutationObserver: window.MutationObserver,
  CustomEvent: window.CustomEvent, Event: window.Event, KeyboardEvent: window.KeyboardEvent, MouseEvent: window.MouseEvent,
  PointerEvent: window.PointerEvent, navigator: window.navigator, localStorage: window.localStorage,
  requestAnimationFrame: (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0), cancelAnimationFrame: (id: ReturnType<typeof window.setTimeout>) => window.clearTimeout(id),
  getComputedStyle: window.getComputedStyle.bind(window), ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
})) {
  previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
}
previous.set("IS_REACT_ACT_ENVIRONMENT", Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterAll(async () => { await window.happyDOM.close(); for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} });

const { test } = await import("bun:test");
const { createRoot } = await import("react-dom/client");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { writeBrowserDevVirtualTextDocument } = await import("../apps/desktop/src/lib/browser-dev-documents");
const { openScientificFiles } = await import("../apps/desktop/src/lib/workbench/open");
const { BrowserStructureDownload } = await import("../apps/desktop/src/components/browser-structure-download");

const molden = "[Molden Format]\n[Atoms] AU\nH 1 1 0 0 0\n[GTO]\n1 0\ns 1 1.00\n1.0D+00 1.0\n[MO]\nEne= -0.7\nSpin= Alpha\nOccup= 1\n1 1.0\n";

test("the shipped download button turns into the Geometry/Original menu once its open claims the import", async () => {
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  let finish!: () => void;
  const settled = new Promise<void>((resolve) => { finish = resolve; });
  // As in the app: the document is added and its header button renders before the open call returns.
  const opening = openScientificFiles({ openStructureRecords: async ([record]: StructureDragRecord[]) => {
    const path = `burette-ketcher://compiled/${record.path}`;
    writeBrowserDevVirtualTextDocument(path, record.text);
    const document: ViewerDocument = { id: "compiled-doc", title: record.path, path, runtimePath: path, byteCount: new TextEncoder().encode(record.text).length, extension: "xyz", renderer: "molstar" };
    useMoleculeStore.setState((state) => ({ documents: [...state.documents, document] }));
    await act(async () => root.render(<BrowserStructureDownload file={{ path, label: record.path }} document={document} />));
    await settled;
    return [document];
  } }, [new File([molden], "same.molden")]);
  try {
    for (let attempt = 0; attempt < 50 && !host.querySelector<BrowserElement>('[aria-label="Download file"]'); attempt++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    assert.equal(host.querySelector<BrowserElement>('[aria-label="Download file"]')!.getAttribute("aria-haspopup"), null, "a plain button before the import is claimed");
    await act(async () => { finish(); await opening; });
    assert.equal(host.querySelector<BrowserElement>('[aria-label="Download file"]')!.getAttribute("aria-haspopup"), "menu");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
