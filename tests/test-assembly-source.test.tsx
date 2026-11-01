import { afterAll, expect, mock, test } from "bun:test";
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { transformSync } from "@babel/core";
import React, { act } from "react";
import { Window } from "happy-dom";
import type { ViewerDocument } from "../apps/desktop/src/types";
const compiled: string[] = [];
afterAll(() => { expect(compiled).toContain("owned-source-text.ts"); });
plugin({ name: "assembly-source-compiler", setup(build) { build.onLoad({ filter: /workbench\/(?:assembly-source|owned-source-text)\.ts$/u }, ({ path }) => {
  const contents = transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false, parserOpts: { plugins: ["typescript"] }, plugins: [["babel-plugin-react-compiler", {}]] })!.code!;
  if (path.endsWith("owned-source-text.ts")) expect(contents).toContain("react/compiler-runtime");
  compiled.push(path.split("/").pop()!);
  return { contents, loader: "ts" };
}); } });
const browser = new Window({ url: "http://localhost" });
const previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator, localStorage: browser.localStorage, IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
afterAll(async () => { for (const [key, value] of previous) { if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); } await browser.happyDOM.close(); });
let text = "source one", reads = 0;
const actualText = await import("../apps/desktop/src/lib/structure-text");
mock.module("../apps/desktop/src/lib/structure-text", () => ({ ...actualText, readStructureTextDocument: async () => { reads++; return { content: text, truncated: false, byteCount: text.length }; } }));
mock.module("../apps/desktop/src/lib/source-editing/context", () => ({ useSourceEditing: () => null }));
const { createRoot } = await import("react-dom/client");
const { useAssemblySourceText } = await import("../apps/desktop/src/lib/workbench/assembly-source");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const original = { id: "source", path: "/source.cif", title: "source.cif", extension: "cif", renderer: "molstar" } as ViewerDocument;
test("same-id same-path replacement rereads its own source instead of publishing the prior source", async () => {
  const host = browser.document.createElement("div"), root = createRoot(host as unknown as Element); browser.document.body.append(host);
  let observed: ReturnType<typeof useAssemblySourceText>;
  function Probe({ document }: { document: ViewerDocument }) { observed = useAssemblySourceText(document); return null; }
  text = "source one"; reads = 0; useMoleculeStore.setState({ documents: [original] });
  try {
    await act(async () => root.render(<Probe document={original} />));
    expect(observed!.text).toBe("source one");
    const replacement = { ...original }; text = "source two";
    await act(async () => { useMoleculeStore.setState({ documents: [replacement] }); root.render(<Probe document={replacement} />); });
    expect({ text: observed!.text, reads }).toEqual({ text: "source two", reads: 2 });
  } finally { await act(async () => root.unmount()); host.remove(); useMoleculeStore.setState({ documents: [] }); }
});
