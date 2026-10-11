import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { GridDescriptorJobStatus } from "../apps/desktop/src/lib/descriptors";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MutationObserver", "getComputedStyle", "CustomEvent"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { GridDescriptorStatus } = await import("../apps/desktop/src/components/grid-descriptor-status");
const { GRID_DESCRIPTOR_JOB_EVENT } = await import("../apps/desktop/src/hooks/use-app-descriptors");
const initial: GridDescriptorJobStatus = { documentId: "series", status: "running", running: true, totalRows: 20, processedRows: 5, calculatedRows: 5, failedRows: 0, message: "internal runtime message", startedAtMs: 1 };
const publish = (patch: Partial<GridDescriptorJobStatus> = {}) => act(async () => {
  window.dispatchEvent(new CustomEvent(GRID_DESCRIPTOR_JOB_EVENT, { detail: { ...initial, ...patch } }));
});
async function fixture(run: (mount: HTMLDivElement, render: (id: string | null) => Promise<void>) => Promise<void>) {
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  try { await run(mount, id => act(async () => root.render(id ? <GridDescriptorStatus documentId={id} /> : null))); }
  finally { await act(async () => root.unmount()); mount.remove(); }
}

test("descriptor progress follows the active document, survives remounts, and names unknown totals correctly", async () => {
  await fixture(async (mount, render) => {
    await render("series"); await publish();
    expect(mount.textContent).toBe("Molecular propertiesCalculating…5 of 20");
    const progress = mount.querySelector('[role="progressbar"]')!;
    expect([progress.getAttribute("aria-label"), progress.getAttribute("aria-valuenow")]).toEqual(["Molecular properties", "25"]);
    await publish({ documentId: "other", processedRows: 17 });
    expect(mount.textContent).toContain("5 of 20");
    await render(null); await render("series"); expect(mount.textContent).toContain("5 of 20");
    await render("other"); expect(mount.textContent).toContain("17 of 20");
    await publish({ documentId: "other", totalRows: 0, processedRows: 0 });
    expect(mount.textContent).toBe("Molecular propertiesCalculating…");
    expect(mount.querySelector('[role="progressbar"]')?.hasAttribute("aria-valuenow")).toBe(false);
    await render("no-job"); expect(mount.textContent).toBe("");
  });
});

test("failed, cancelled and partial runs never masquerade as successful calculations or expose raw errors", async () => {
  await fixture(async (mount, render) => {
    await render("outcomes");
    const finish = (patch: Partial<GridDescriptorJobStatus>) => publish({ documentId: "outcomes", running: false, ...patch });
    await finish({ status: "failed", message: "Traceback /private/runtime/token" });
    expect(mount.textContent).toBe("Molecular propertiesFailed");
    expect(mount.querySelector('[role="progressbar"]')).toBeNull();
    await finish({ status: "cancelled" }); expect(mount.textContent).toBe("Molecular propertiesCancelled");
    await finish({ status: "completed", failedRows: 2 });
    expect(mount.textContent).toBe("Molecular propertiesCompleted with errors2 failed");
    await finish({ status: "completed", summary: { totalRows: 20, calculatedRows: 20, failedRows: 0, descriptorIdCount: 3, descriptorIds: ["mass", "logp", "tpsa"] } });
    expect(mount.textContent).toBe("Molecular propertiesCompleted3 columns added");
    await finish({ status: "idle" }); expect(mount.textContent).toBe("");
  });
});
