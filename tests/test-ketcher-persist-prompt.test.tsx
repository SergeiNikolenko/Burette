import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MutationObserver", "getComputedStyle"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : (browser as any)[key] });
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const { registerKetcherAgentController, unregisterKetcherAgentController } = await import("../apps/desktop/src/lib/ketcher-agent");
const { KetcherPersistRequestPrompt } = await import("../apps/desktop/src/components/ketcher/persist-request");

const MOLFILE = "\n  Ketcher\n\n  1  0  0  0  0  0            999 V2000\n    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\nM  END\n";
const editor = {
  getKet: async () => "{}",
  getMolfile: async () => MOLFILE,
  getSmiles: async () => "C",
  setMolecule: async () => undefined,
  setMolfile: async () => undefined,
  subscribeChange: () => () => undefined,
};

function requestPersist(controller: ReturnType<typeof registerKetcherAgentController>, actionId: string) {
  return controller.execute({
    type: "control_ketcher",
    command: "request_persist",
    surfaceId: controller.surfaceId,
    actionId,
    expectedRevision: controller.snapshot().structureRevision,
    format: "mol",
    suggestedBasename: "nad",
  });
}

const buttonNamed = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll("button")].find((button) => button.textContent?.includes(label));

test("agent save requests wait for the user and write only after Save as", async () => {
  const controller = registerKetcherAgentController("tab-persist", editor, {});
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const writes: unknown[] = [];
  const onWrite = async (file: unknown) => {
    writes.push(file);
    return { status: "saved" as const, path: "/Users/me/nad.mol" };
  };
  await act(async () => { root.render(<KetcherPersistRequestPrompt tabId="tab-persist" onWrite={onWrite} />); });
  expect(container.textContent).toBe("");

  await act(async () => { await requestPersist(controller, "persist-1"); });
  expect(container.querySelector('[data-slot="alert"]')?.getAttribute("aria-label")).toBe("Agent save request");
  expect(container.textContent).toContain("Save as nad.mol (MOL)");
  expect(writes).toEqual([]);

  await act(async () => { buttonNamed(container, "Save as")!.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(writes).toEqual([{ fileName: "nad.mol", extension: "mol", text: MOLFILE }]);
  expect(controller.snapshot()).toMatchObject({ persistedRevision: 0, dirty: false, persistRequest: { status: "saved", savedPath: "/Users/me/nad.mol" } });
  expect(container.textContent).toBe("");

  await act(async () => { await requestPersist(controller, "persist-2"); });
  await act(async () => { buttonNamed(container, "Decline")!.click(); });
  expect(controller.getPersistRequest()?.status).toBe("cancelled");
  expect(writes).toHaveLength(1);
  expect(container.textContent).toBe("");

  await act(async () => { root.unmount(); });
  unregisterKetcherAgentController("tab-persist", controller);
});
