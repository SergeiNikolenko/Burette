import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ViewerDownloadAction } from "../apps/desktop/src/lib/viewer-download-actions";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "SVGElement", "HTMLInputElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { FileViewerLoadingState, FileViewerEmptyState, FileViewerErrorState, FileViewerUnsupportedState } = await import("../apps/desktop/src/components/ui/file-viewer-state");
const { ViewerErrorBoundary, ViewerErrorState } = await import("../apps/desktop/src/components/ui/viewer-error");
const { PdfViewerFallback } = await import("../apps/desktop/src/components/ui/pdf-viewer-states");
const { ResourceError } = await import("../apps/desktop/src/lib/viewer-errors");
const fault = new ResourceError({ kind: "fetch_failed", message: "private /path?token=secret" });
async function fixture(run: (mount: HTMLDivElement, render: (content: React.ReactNode) => Promise<void>) => Promise<void>) {
  const mount = document.createElement("div"); mount.className = "app-shell"; document.body.append(mount);
  const root = createRoot(mount, { onCaughtError: () => {} });
  try { await run(mount, content => act(async () => root.render(content))); }
  finally { await act(async () => root.unmount()); mount.remove(); }
}
const button = (mount: Element, name: string) => Array.from(mount.querySelectorAll("button")).find(el => el.textContent === name)!;

test("loading and empty states announce one status without filler; document placeholders keep their geometry", async () => {
  await fixture(async (mount, render) => {
    await render(<FileViewerLoadingState />);
    expect(mount.querySelector('[aria-busy="true"]')?.getAttribute("role")).toBe("status");
    expect(mount.textContent).toBe("Loading…");
    await render(<FileViewerEmptyState />); expect(mount.textContent).toBe("No file selected");
    await render(<PdfViewerFallback bare fallbackPageSize={{ width: 16, height: 9 }} />);
    const page = mount.querySelector<HTMLElement>('[data-slot="pdf-page-skeleton"]')!;
    expect([page.style.aspectRatio, page.getAttribute("aria-hidden")]).toEqual(["16 / 9", "true"]);
    expect(page.className).toContain("motion-reduce:animate-none");
    await render(<FileViewerLoadingState title={null} icon={null}><div>Page placeholder</div></FileViewerLoadingState>);
    expect(mount.textContent).toBe("Page placeholder");
  });
});

test("both viewer error entry points preserve retry/download and never render raw diagnostics", async () => {
  for (const Component of [FileViewerErrorState, ViewerErrorState]) await fixture(async (mount, render) => {
    let retried = 0, downloaded = 0;
    const download: ViewerDownloadAction = { id: "original", label: "Download", fileName: "report.pdf", origin: "derived", getPayload: () => { downloaded++; return { kind: "none" }; } };
    await render(<Component error={fault} sourceKind="url" format="pdf" download={download} onRetry={() => retried++} />);
    expect(mount.querySelector('[role="alert"]')).not.toBeNull();
    expect(mount.innerHTML).not.toMatch(/private|token=secret/);
    expect(mount.textContent).toContain("Couldn't load this file.");
    await act(async () => button(mount, "Retry").click());
    await act(async () => mount.querySelector<HTMLButtonElement>('[aria-label="Download"]')!.click());
    expect([retried, downloaded]).toEqual([1, 1]);
    await render(<Component error={fault} sourceKind="url" retry="never" download={{ ...download, isDisabled: true }} onRetry={() => retried++} />);
    expect(mount.querySelectorAll("button")).toHaveLength(0);
  });
});

test("unsupported files offer only an available download, with custom descriptions preserved", async () => {
  await fixture(async (mount, render) => {
    const download: ViewerDownloadAction = { id: "source", label: "Save original", fileName: "report.bin", origin: "original", getPayload: () => ({ kind: "none" }) };
    await render(<FileViewerUnsupportedState fileName="report.bin" download={download} />);
    expect(mount.textContent).toContain("Preview unavailable"); expect(mount.textContent).toContain("report.bin");
    expect(mount.querySelectorAll("button")).toHaveLength(1);
    await render(<FileViewerUnsupportedState description="Open the original file to continue." download={download} showDownload={false} />);
    expect(mount.textContent).toContain("Open the original file to continue."); expect(mount.querySelectorAll("button")).toHaveLength(0);
  });
});

test("viewer boundaries recover on retry and reset when the document changes", async () => {
  await fixture(async (mount, render) => {
    let fails = true, retries = 0;
    function Document() { if (fails) throw fault; return <p>Report content</p>; }
    const tree = (key: string) => <ViewerErrorBoundary resetKey={key} format="pdf" sourceKind="url" onRetry={() => { fails = false; retries++; }}><Document /></ViewerErrorBoundary>;
    await render(tree("first")); await act(async () => button(mount, "Retry").click());
    expect([retries, mount.textContent]).toEqual([1, "Report content"]);
    fails = true; await render(tree("second")); expect(mount.querySelector('[role="alert"]')).not.toBeNull();
    fails = false; await render(tree("third")); expect(mount.textContent).toBe("Report content");
  });
});
