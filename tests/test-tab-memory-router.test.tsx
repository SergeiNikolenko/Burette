import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
const browser = new Window({ url: "http://localhost/?devFiles=sample.sdf" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MutationObserver", "localStorage"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { useNavigate, useLocation } = await import("react-router");
const { useMoleculeStore, getMoleculeSessionSnapshot } = await import("../apps/desktop/src/stores/molecule-store");
const { TabMemoryRouter } = await import("../apps/desktop/src/components/editor-area/tab-router");

test("router navigation shares tab history, session restore, and native Back/Forward without changing browser URL", async () => {
  const store = useMoleculeStore;
  store.getState().closeAllDocuments();
  store.getState().openSettingsSection("general");
  const tabId = store.getState().activeTabId!;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  function Probe() {
    const navigate = useNavigate();
    const location = useLocation();
    return <>
      <output>{location.pathname}</output>
      <button onClick={() => navigate("/settings/appearance")}>Appearance</button>
      <button onClick={() => navigate("/settings/keyboard", { replace: true })}>Keyboard</button>
      <button onClick={() => navigate(-1)}>Back</button>
      <button onClick={() => navigate(1)}>Forward</button>
    </>;
  }
  function Surface() {
    const tab = store(state => state.tabs.find(item => item.id === tabId)!);
    return <TabMemoryRouter tab={tab}><Probe /></TabMemoryRouter>;
  }
  const click = async (label: string) => act(async () => {
    Array.from(container.querySelectorAll("button")).find(button => button.textContent === label)!.click();
  });
  const route = () => container.querySelector("output")!.textContent;
  try {
    await act(async () => root.render(<Surface />));
    await click("Appearance");
    expect(route()).toBe("/settings/appearance");
    await click("Keyboard");
    expect(route()).toBe("/settings/keyboard");
    expect(store.getState().tabs.find(tab => tab.id === tabId)!.back).toEqual([{ kind: "settings", section: "general" }]);
    await act(async () => store.getState().navigateBack());
    expect(route()).toBe("/settings/general");
    await click("Forward");
    expect(route()).toBe("/settings/keyboard");
    const snapshot = getMoleculeSessionSnapshot(store.getState());
    await click("Back");
    await act(async () => store.getState().restoreSession(snapshot.tabs, snapshot.activeIndex));
    expect(route()).toBe("/settings/keyboard");
    expect(window.location.href).toBe("http://localhost/?devFiles=sample.sdf");
  } finally {
    await act(async () => root.unmount()); container.remove();
  }
});
