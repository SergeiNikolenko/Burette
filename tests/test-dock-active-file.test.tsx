import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import type { ShellActions, ShellViewState } from "../apps/desktop/src/components/types";
import type { ViewerDocument, TextFileDocument } from "../apps/desktop/src/types";
const { renderToStaticMarkup } = await import("react-dom/server");
const { DockPanel } = await import("../apps/desktop/src/components/dock-panel");

const molecule = (id: string) => ({ id, title: `${id}.sdf`, path: `/${id}.sdf`, extension: "sdf", renderer: "molstar", runtimePath: "<html></html>", byteCount: 10 }) as ViewerDocument;
const a = molecule("a"), b = molecule("b");
const state = {
  documents: [a, b], textDocuments: [], activeDocument: a, activeTab: { location: { kind: "file", path: a.path, documentId: a.id } },
  rightDockTabs: [{ id: "files", kind: "files" }], bottomDockTabs: [{ id: "files", kind: "files" }],
  rightDockActiveTab: "files", bottomDockActiveTab: "files", rightDockOpen: true, bottomDockOpen: true,
  rightDockDocumentId: null, bottomDockDocumentId: null, rightDockTool: null, bottomDockTool: null,
  dockDroppedStructures: [], hoveredGridRows: {}, visibleDocuments: [a, b],
} as unknown as ShellViewState;

function render(patch: Partial<ShellViewState> = {}) {
  const shell = document.createElement("div");
  shell.innerHTML = renderToStaticMarkup(<DockPanel area="right" state={{ ...state, ...patch }} actions={{} as ShellActions} />);
  return shell;
}

test("Files follows the active structure, while an explicit pin keeps its read-only preview", () => {
  for (const [patch, expected] of [[{}, "a"], [{ activeDocument: b }, "b"], [{ rightDockDocumentId: "a", activeDocument: b }, "a"]] as const) {
    const shell = render(patch);
    expect(shell.querySelector('iframe[data-read-only="true"]')?.getAttribute("data-document-id")).toBe(expected);
    expect(shell.querySelector('[role="tablist"][aria-label="right dock files"] [aria-selected="true"]')?.textContent).toBe(`${expected}.sdf`);
    expect(shell.querySelector('[role="tab"][aria-label="Files"]')?.getAttribute("draggable")).toBe("true");
    expect(shell.textContent).not.toContain("No file selected");
  }
});

test("a missing explicit pin never falls back to another open structure", () => {
  const shell = render({ rightDockDocumentId: "removed" });
  expect(shell.querySelector("iframe")).toBeNull();
  expect(shell.textContent).toContain("No file selected");
  expect(shell.querySelector('[role="tab"][aria-label="Files"]')?.getAttribute("draggable")).toBe("false");
});


test("hidden automatic previews do not mount another renderer; pinned previews keep their state", () => {
  expect(render({ rightDockOpen: false }).querySelector("iframe")).toBeNull();
  expect(render({ rightDockOpen: false, rightDockDocumentId: "b" }).querySelector("iframe")?.getAttribute("data-document-id")).toBe("b");
});

test("Files follows active text and respects an explicit text pin", () => {
  const text: TextFileDocument = { id: "notes", title: "notes.txt", path: "/notes.txt", extension: "txt", language: "text", byteCount: 5, content: "notes", truncated: false };
  for (const pin of [false, true]) {
    const shell = render({ textDocuments: [text], activeDocument: pin ? a : null,
      rightDockDocumentId: pin ? text.id : null,
      activeTab: { location: pin ? { kind: "file", path: a.path, documentId: a.id } : { kind: "text-file", path: text.path, documentId: text.id } } as ShellViewState["activeTab"],
    });
    expect(shell.querySelector("iframe")).toBeNull();
    expect(shell.querySelector(".text-file-title")?.textContent).toBe(text.title);
    expect(shell.querySelector('[role="tablist"][aria-label="right dock files"] [aria-selected="true"]')?.textContent).toBe(text.title);
  }
});

test("Info follows active text and preserves an explicit text pin instead of showing an empty structure panel", () => {
  const text: TextFileDocument = { id: "report", title: "report.md", path: "/report.md", extension: "md", language: "markdown", byteCount: 1024, content: "# Report", truncated: false };
  for (const pinned of [false, true]) {
    const shell = render({ textDocuments: [text], activeDocument: pinned ? a : null,
      rightDockTabs: [{ id: "info", kind: "inspector" }], rightDockActiveTab: "inspector",
      rightDockDocumentId: pinned ? text.id : null,
      activeTab: { location: pinned ? { kind: "file", path: a.path, documentId: a.id } : { kind: "text-file", path: text.path, documentId: text.id } } as ShellViewState["activeTab"],
    });
    expect(shell.querySelector('[aria-label="File information"] h3')?.textContent).toBe(text.title);
    expect(Array.from(shell.querySelectorAll('[aria-label="File information"] button'), el => el.textContent)).toEqual(["Show metadata", "Reveal file", "Copy path"]);
    expect(shell.textContent).not.toContain("No structure selected");
  }
});

test("Info recognizes document pages without inventing metadata or overriding a pinned text file", () => {
  for (const extension of ["md", "pdf", "docx", "xlsx"]) {
    const shell = render({ activeDocument: null, rightDockTabs: [{ id: "info", kind: "inspector" }], rightDockActiveTab: "inspector",
      activeTab: { location: { kind: "document", path: `/reports/Report.${extension}` } } as ShellViewState["activeTab"],
    });
    const info = shell.querySelector('[aria-label="File information"]')!;
    expect(info.querySelector("h3")?.textContent).toBe(`Report.${extension}`);
    expect(info.querySelector('[data-slot="badge"]')?.textContent).toBe(extension.toUpperCase());
    expect(Array.from(info.querySelectorAll("button"), el => el.textContent)).toEqual(["Reveal file", "Copy path"]);
    expect(info.querySelector("dl")).toBeNull();
    expect(shell.textContent).not.toContain("No structure selected");
  }
  const text: TextFileDocument = { id: "notes", title: "Notes.txt", path: "/notes.txt", extension: "txt", language: "text", byteCount: 5, content: "notes", truncated: false };
  const pinned = render({ textDocuments: [text], rightDockDocumentId: text.id, activeDocument: null,
    rightDockTabs: [{ id: "info", kind: "inspector" }], rightDockActiveTab: "inspector",
    activeTab: { location: { kind: "document", path: "/Report.pdf" } } as ShellViewState["activeTab"],
  });
  expect(pinned.querySelector('[aria-label="File information"] h3')?.textContent).toBe("Notes.txt");
});


test("shared empty panels expose the existing open action without an explanatory caption", async () => {
  const { createRoot } = await import("react-dom/client");
  const { PanelEmptyState } = await import("../apps/desktop/src/components/ui/panel-empty-state");
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  let opened = 0;
  try {
    await act(async () => root.render(<PanelEmptyState title="No file selected" icon={<span />} action={{ label: "Open file", run: () => opened++ }} />));
    expect(mount.querySelector('[data-slot="empty-description"]')).toBeNull();
    await act(async () => mount.querySelector('button')!.click());
    expect(opened).toBe(1);
    await act(async () => root.render(<PanelEmptyState title="Sketch source" icon={<span />} description="Use Export to view the sketch source." />));
    expect(mount.querySelector("button")).toBeNull();
    expect(mount.querySelector('[data-slot="empty-description"]')?.textContent).toBe("Use Export to view the sketch source.");
  } finally { await act(async () => root.unmount()); mount.remove(); }
});
