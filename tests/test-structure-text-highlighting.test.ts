import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { EditorState } from "@codemirror/state";
import { EditorView, type DecorationSet, type ViewPlugin } from "@codemirror/view";
import { structureTextHighlighting } from "../apps/desktop/src/components/text-file-viewer/structure-text-highlighting";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}

for (const [extension, filename, expectedAtomLabels] of [
  ["sdf", "caffeine.sdf", ["O", "N", "C", "H"]],
  ["mol2", "water.mol2", ["OH", "HH1", "HH2"]],
] as const) {
  test(`${extension} source editor keeps atom and numeric highlighting active after edits`, () => {
    const content = readFileSync(new URL(`../samples/structures/small-molecules/${filename}`, import.meta.url), "utf8");
    const extensionValue = structureTextHighlighting(extension);
    const plugin = (extensionValue as ViewPlugin<{ decorations: DecorationSet }>[])[0];
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({ state: EditorState.create({ doc: content, extensions: extensionValue }), parent });
    const highlighted = () => {
      const decorations = view.plugin(plugin)?.decorations;
      expect(decorations).toBeDefined();
      const atoms: string[] = [];
      const numbers: string[] = [];
      decorations!.between(0, view.state.doc.length, (from, to, value) => {
        const text = view.state.doc.sliceString(from, to);
        if (value.spec.class === "cm-structure-atom") atoms.push(text);
        if (value.spec.class === "cm-structure-number") numbers.push(text);
      });
      return { atoms, numbers };
    };
    try {
      expect(highlighted().atoms).toEqual(expect.arrayContaining([...expectedAtomLabels]));
      expect(highlighted().numbers.length).toBeGreaterThan(expectedAtomLabels.length * 3);
      const coordinate = extension === "sdf" ? "0.4700" : "4.0130";
      const from = content.indexOf(coordinate);
      view.dispatch({ changes: { from, to: from + coordinate.length, insert: "9.1234" } });
      expect(highlighted().atoms).toEqual(expect.arrayContaining([...expectedAtomLabels]));
      expect(highlighted().numbers).toContain("9.1234");
    } finally {
      view.destroy();
      parent.remove();
    }
  });
}
