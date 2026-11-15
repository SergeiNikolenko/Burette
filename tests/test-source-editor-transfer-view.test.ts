import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { EditorState } from "@codemirror/state";
import { captureSourceEditorView, registerSourceEditor, restoreSourceEditorView } from "../apps/desktop/src/lib/source-editing/view-state";

const browser = new Window({ url: "http://localhost" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
const { EditorView } = await import("@codemirror/view");

test("source transfer preserves reversed selection and scroll in the receiving CodeMirror editor", () => {
  const parent = document.createElement("div"); document.body.append(parent);
  const source = new EditorView({ parent, state: EditorState.create({ doc: "ATOM original\nATOM draft\n", selection: { anchor: 20, head: 5 } }) });
  const receiving = new EditorView({ parent, state: EditorState.create({ doc: source.state.doc }) });
  const unregister = registerSourceEditor("/source.pdb", source);
  try {
    source.scrollDOM.scrollTop = 120;
    source.scrollDOM.scrollLeft = 32;
    const snapshot = captureSourceEditorView("/source.pdb")!;
    restoreSourceEditorView(receiving, snapshot);
    expect({ anchor: receiving.state.selection.main.anchor, head: receiving.state.selection.main.head,
      scrollTop: receiving.scrollDOM.scrollTop, scrollLeft: receiving.scrollDOM.scrollLeft }).toEqual(snapshot);
    receiving.dispatch({ changes: { from: 0, to: receiving.state.doc.length, insert: "ATOM" } });
    restoreSourceEditorView(receiving, snapshot);
    expect(receiving.state.selection.main.anchor).toBe(4);
    unregister();
    expect(captureSourceEditorView("/source.pdb")).toBeUndefined();
  } finally { unregister(); source.destroy(); receiving.destroy(); parent.remove(); }
});
