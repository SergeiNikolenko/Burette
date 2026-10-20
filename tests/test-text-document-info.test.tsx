import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { TextFileDocument } from "../apps/desktop/src/types";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MouseEvent", "MutationObserver", "getComputedStyle"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { TextDocumentInfoPanel } = await import("../apps/desktop/src/components/text-document-info-panel");
const doc: TextFileDocument = { id: "report", title: "Report.md", path: "/workspace/Report.md", extension: "md", language: "Markdown", byteCount: 2048, content: "# Report", truncated: false };

test("file information preserves metadata/reveal/copy targets without exposing internal paths in the panel", async () => {
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  const calls: unknown[] = [];
  const actions = { showTextFileMetadata: (file: TextFileDocument) => { calls.push(["metadata", file]); }, revealPath: (path: string, label?: string) => { calls.push(["reveal", path, label]); }, copyPath: (path: string, label?: string) => { calls.push(["copy", path, label]); } };
  try {
    await act(async () => root.render(<TextDocumentInfoPanel document={doc} actions={actions} />));
    expect(mount.querySelector("h3")?.textContent).toBe("Report.md");
    expect(Array.from(mount.querySelectorAll("dt, dd"), el => el.textContent)).toEqual(["Language", "Markdown", "Size", "2.0 KB"]);
    expect(mount.textContent).not.toContain(doc.path); expect(mount.textContent).not.toContain("TEXT FILE");
    for (const button of mount.querySelectorAll<HTMLButtonElement>("button")) await act(async () => button.click());
    expect(calls).toEqual([["metadata", doc], ["reveal", doc.path, "file"], ["copy", doc.path, "file"]]);
    const next = { ...doc, id: "next", title: "Notes", path: "/workspace/Notes", extension: "", language: "", byteCount: 0, truncated: true };
    await act(async () => root.render(<TextDocumentInfoPanel document={next} actions={actions} />));
    expect(Array.from(mount.querySelectorAll("dt, dd"), el => el.textContent)).toEqual(["Size", "0 B", "Preview", "Partial"]);
    expect(mount.querySelector('[data-slot="badge"]')).toBeNull();
    const copy = Array.from(mount.querySelectorAll<HTMLButtonElement>("button")).find(el => el.textContent === "Copy path")!;
    await act(async () => copy.click()); expect(calls.at(-1)).toEqual(["copy", next.path, "file"]);
  } finally { await act(async () => root.unmount()); mount.remove(); }
});
