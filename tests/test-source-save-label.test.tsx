import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import React, { type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TextFileDocument, ViewerDocument } from "../apps/desktop/src/types";
import type { SourceEditingView } from "../apps/desktop/src/lib/source-editing/context";
import { TextFileViewer } from "../apps/desktop/src/components/text-file-viewer";

const text: TextFileDocument = { id: "label", path: "/molecule.xyz", title: "molecule.xyz", extension: "xyz", language: "XYZ", byteCount: 24, content: "1\nmolecule\nC 0 0 0\n", truncated: false };
const document: ViewerDocument = { ...text, renderer: "molstar", runtimePath: "scene" };
const base: SourceEditingView = { sessionId: crypto.randomUUID(), documentId: document.id, path: document.path, content: text.content, status: "Modified", editable: true, dirty: true, saving: false, diagnostic: null, previewMode: "live", saveDisabledReason: null, sourcePreview: null };
type Props = NonNullable<ComponentProps<typeof TextFileViewer>["sourceEditing"]>;
// Exercise the actual private dock adapter expression without importing all dock panels/workers.
const dock = readFileSync(new URL("../apps/desktop/src/components/dock-panel.tsx", import.meta.url), "utf8");
const start = dock.indexOf("    const sourceEditingProps = "), end = dock.indexOf("      : undefined;", start);
if (start < 0 || end < 0) throw new Error("The dock source adapter moved; review this fixture.");
const expression = dock.slice(start + "    const sourceEditingProps = ".length, end + "      : undefined".length);
const compiled = new Bun.Transpiler({ loader: "ts" }).transformSync(`function adapt(activeDocument, document, sourceEditing, sourceSession) { return (${expression}); }`);
const adapt = new Function(`${compiled}; return adapt;`)() as (
  active: ViewerDocument, text: TextFileDocument, actions: { save: (target: ViewerDocument) => void }, session: SourceEditingView,
) => Props;
function render(session: SourceEditingView, save = (_target: ViewerDocument) => {}) {
  const props = adapt(document, text, { save }, session);
  const browser = new Window();
  browser.document.body.innerHTML = renderToStaticMarkup(<TextFileViewer document={text} sourceEditing={props} />);
  const button = [...browser.document.querySelectorAll("button")].find(button => /^Save/u.test(button.textContent ?? ""));
  if (!button) throw new Error("Missing source save control");
  return { button, props };
}

test("the dock forwards browser Save copy through the actual text toolbar and keeps its save target", async () => {
  const calls: ViewerDocument[] = [], view = render({ ...base, saveLabel: "Save copy" }, target => calls.push(target));
  expect([view.button.textContent, view.button.disabled]).toEqual(["Save copy", false]);
  await view.props.onSave?.();
  expect(calls).toEqual([document]);
});

test("native and older callers retain Save while clean, saving and scene-owned sources stay disabled", () => {
  for (const saveLabel of [undefined, "Save"] as const) {
    expect(render({ ...base, saveLabel }).button.textContent).toBe("Save");
  }
  for (const state of [{ dirty: false }, { saving: true }, { saveDisabledReason: "Saved with the scene: Export → Scene" }]) {
    const view = render({ ...base, saveLabel: "Save copy", ...state });
    expect([view.button.textContent, view.button.disabled]).toEqual(["Save copy", true]);
  }
});
