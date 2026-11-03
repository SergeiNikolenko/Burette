import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
const browser = new Window({ url: "http://localhost/" });
for (const key of ["window", "document", "HTMLElement", "Element", "Node", "CSS", "MessageEvent", "localStorage"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { captureNativeGridTab, restoreNativeGridTab } = await import("../apps/desktop/src/components/workspace-panes/native-grid-window");
const { isGridDocumentCloseTransitionActive } = await import("../apps/desktop/src/lib/window-mutation-barrier");

test("grid handoff freezes capture and checks loaded baseline before applying edits", async () => {
  const frame = document.createElement("iframe");
  frame.className = "viewer-iframe"; frame.dataset.documentId = "grid"; frame.dataset.renderer = "grid2d";
  document.body.append(frame);
  const requests: string[] = [];
  let version = "original-index-hash";
  mockIPC((command, args) => {
    if (command !== "grid_transfer_source_version") throw new Error(`Unexpected command ${command}`);
    expect(args).toEqual({ documentId: "grid" });
    return version;
  });
  const target = frame.contentWindow!;
  target.postMessage = (message: any) => {
    requests.push(message.body.type);
    const requestId = message.body.requestId;
    if (!requestId) return;
    queueMicrotask(() => window.dispatchEvent(new MessageEvent("message", {
      source: target,
      data: { source: "burette-grid", body: message.body.type === "gridCloseTransitionChanged"
        ? { type: "gridCloseTransitionAcknowledged", requestId, active: true }
        : { type: "gridWindowResult", requestId, ok: true, snapshot: "serialized live edits" } },
    })));
  };
  useMoleculeStore.setState({ documents: [{ id: "grid", path: "/collection.csv", renderer: "grid2d" } as any] });
  try {
    const captured = await captureNativeGridTab({ id: "tab", location: { kind: "file", documentId: "grid", path: "/collection.csv" }, back: [], forward: [] });
    expect(captured.value).toEqual({ sourceVersion: "original-index-hash", snapshot: "serialized live edits" });
    expect(isGridDocumentCloseTransitionActive("grid")).toBe(true);
    captured.release();
    expect(isGridDocumentCloseTransitionActive("grid")).toBe(false);
    version = "changed-before-transfer";
    await expect(restoreNativeGridTab("grid", captured.value)).rejects.toThrow("source file changed");
    expect(requests).not.toContain("gridWindowRestore");
    version = captured.value.sourceVersion;
    await restoreNativeGridTab("grid", captured.value);
    expect(requests.at(-1)).toBe("gridWindowRestore");
  } finally { frame.remove(); clearMocks(); }
});
