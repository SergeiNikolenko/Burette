import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ShellActions } from "../apps/desktop/src/components/types";
import type { ViewerDocument } from "../apps/desktop/src/types";

const browser = new Window();
for (const key of ["CSS", "window", "document", "navigator", "DocumentFragment", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { StructureInfoPanel } = await import("../apps/desktop/src/components/structure-info-panel");
const { DEFAULT_CONFORMER_SETTINGS, DEFAULT_XTB_SETTINGS } = await import("../apps/desktop/src/lib/chemistry-settings");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");

// Info reads the same frame store as Plots and Vibrations, so opening it after the
// player moved still knows the trajectory the toolbar shows.
test("Info opened after a frame change follows the shared active frame", async () => {
  const scene = { id: "info-frame-scene", title: "Docking scene", path: "/scene/docking", extension: "pdb", renderer: "molstar",
    dockingRequest: { receptorPath: "/scene/topology.pdb", ligandPaths: ["/scene/run.xtc"], syntheticTopology: true } } as ViewerDocument;
  window.dispatchEvent(new CustomEvent("burette:trajectory-frame-changed", { detail: {
    documentId: scene.id, frameIndex: 1, frameCount: 3, globalFrameIndex: 11, segmentStartFrame: 10, sourcePath: "/scene/run.xtc",
  } }));
  const props: React.ComponentProps<typeof StructureInfoPanel> = {
    document: scene, gridFilterModel: null, dockDrops: [], conformerStatus: null, conformerSettings: DEFAULT_CONFORMER_SETTINGS,
    viewerLigandSelection: null, structureOverlayMode: "all", xtbStatus: null, xtbSettings: DEFAULT_XTB_SETTINGS, xtbJobs: [],
    preferences: defaultPreferences, isBrowserDev: true,
    actions: { runStructureViewerAction: () => {} } as unknown as ShellActions,
  };
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  try {
    await act(async () => root.render(<StructureInfoPanel {...props} />));
    // The frame controls come only from the frame report, which arrived before Info mounted.
    expect(mount.querySelector(".trajectory-smoothing-card")).not.toBeNull();
    await act(async () => root.render(<StructureInfoPanel {...props} document={{ ...scene, id: "info-frame-unreported" }} />));
    expect(mount.querySelector(".trajectory-smoothing-card")).toBeNull();
  } finally {
    await act(async () => root.unmount()); mount.remove();
  }
});
