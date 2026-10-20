import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act, type ReactNode } from "react";
import type { ViewerSource } from "../apps/desktop/src/lib/viewer-source";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MouseEvent", "MutationObserver", "getComputedStyle"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let native = true;
const requests: { command: string; payload: unknown; resolve: (bytes: ArrayBuffer) => void; reject: (error: unknown) => void }[] = [];
mock.module("@tauri-apps/api/core", () => ({ invoke: (command: string, payload: unknown) => new Promise<ArrayBuffer>((resolve, reject) => requests.push({ command, payload, resolve, reject })) }));
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => native }));
mock.module("../apps/desktop/src/lib/browser-dev-documents", () => ({ readBrowserDevVirtualTextDocument: (path: string) => path === "/virtual.md" ? "# Report" : null }));
const rendered: ViewerSource[] = [];
const pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
// Document parsing has its own integration checks. Here the real surface and
// IPC lifecycle run with a renderer that records exactly which source it gets.
mock.module("../apps/desktop/src/components/ui/file-viewer", () => ({
  ...Object.fromEntries(["FileViewer", "FileViewerContent", "FileViewerControls", "FileViewerDocument", "FileViewerHeader", "FileViewerInset", "FileViewerMeta", "FileViewerSidebar", "FileViewerSidebarTrigger", "FileViewerTitle", "FileViewerViewport"].map(name => [name, pass])),
  FileViewerProvider: ({ source }: { source: ViewerSource }) => { rendered.push(source); return <article>{source.fileName}</article>; },
}));
mock.module("../apps/desktop/src/components/ui/pdf-viewer", () => ({ PdfViewerPages: pass, PdfViewerProvider: pass, PdfViewerThumbnails: pass }));
const { createRoot } = await import("react-dom/client");
const { DocumentSurface } = await import("../apps/desktop/src/components/document-page");

async function withSurface(run: (mount: HTMLDivElement, render: (path: string) => Promise<void>) => Promise<void>) {
  native = true; requests.length = 0; rendered.length = 0;
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  try { await run(mount, async path => { await act(async () => root.render(<DocumentSurface path={path} />)); }); }
  finally { await act(async () => root.unmount()); mount.remove(); }
}

test("native read failure is private, retryable, and replaced by the loaded file", async () => withSurface(async (mount, render) => {
  await render("/private/Report.pdf");
  expect(mount.querySelector('[role="status"]')?.textContent).toBe("Loading…");
  expect(requests.map(({ command, payload }) => ({ command, payload }))).toEqual([{ command: "read_document_file", payload: { path: "/private/Report.pdf" } }]);
  await act(async () => requests[0].reject(new Error("EACCES /private/Report.pdf IPC internal error")));
  expect(mount.querySelector('[role="alert"]')?.textContent).toBe("Could not open fileRetry");
  expect(mount.textContent).not.toMatch(/private|EACCES|IPC/);
  await act(async () => mount.querySelector<HTMLButtonElement>("button")!.click());
  expect(mount.querySelector('[role="alert"]')).toBeNull();
  expect(mount.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(requests).toHaveLength(2);
  await act(async () => requests[1].resolve(new ArrayBuffer(8)));
  expect(mount.textContent).toBe("Report.pdf");
  expect(rendered.at(-1)).toMatchObject({ kind: "blob", fileName: "Report.pdf", identityKey: "/private/Report.pdf" });
  const source = rendered.at(-1)!;
  expect(source.kind === "blob" && source.blob.type).toBe("application/pdf");
}));

test("changing files never renders stale bytes and ignores late reads", async () => withSurface(async (mount, render) => {
  await render("/first.pdf");
  await act(async () => requests[0].resolve(new ArrayBuffer(1)));
  rendered.length = 0;
  await render("/second.pdf");
  expect(rendered).toEqual([]);
  expect(mount.textContent).toBe("Loading…");
  await render("/first.pdf");
  expect(rendered).toEqual([]);
  await act(async () => requests[1].reject("Late second-file failure"));
  expect(mount.textContent).toBe("Loading…");
  await act(async () => requests[2].resolve(new ArrayBuffer(3)));
  expect(rendered.map(source => source.identityKey)).toEqual(["/first.pdf"]);
}));

test("browser files and virtual documents bypass native reads and switch immediately", async () => withSurface(async (_mount, render) => {
  native = false;
  await render("/space name.md");
  await render("/virtual.md");
  expect(rendered).toEqual([
    { kind: "url", url: "/__burette/read-file?path=%2Fspace%20name.md", fileName: "space name.md", identityKey: "/space name.md" },
    { kind: "text", text: "# Report", fileName: "virtual.md", identityKey: "/virtual.md" },
  ]);
  expect(requests).toEqual([]);
}));
