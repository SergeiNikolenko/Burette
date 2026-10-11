import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act, useState } from "react";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MutationObserver", "getComputedStyle", "localStorage"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { ErrorBoundary } = await import("../apps/desktop/src/components/error-boundary");
const { useSettingsStore, getSettingsStoreSnapshot } = await import("../apps/desktop/src/stores/settings-store");

function FragileScreen() {
  const [failed, setFailed] = useState(false);
  if (failed) throw new Error("Private rendering failure at /private/workspace");
  return <button onClick={() => setFailed(true)}>Working screen</button>;
}

test("root recovery uses current appearance, hides raw errors and remounts the failed screen", async () => {
  const saved = getSettingsStoreSnapshot();
  const originalError = console.error; const logs: unknown[][] = [];
  console.error = (...args: unknown[]) => { logs.push(args); };
  const mount = document.createElement("div"); document.body.append(mount);
  const root = createRoot(mount, { onCaughtError() {} });
  try {
    useSettingsStore.getState().setPreference("theme", "light");
    await act(async () => root.render(<ErrorBoundary><FragileScreen /></ErrorBoundary>));
    for (const theme of ["light", "dark"] as const) {
      await act(async () => {
        useSettingsStore.getState().setPreference("theme", theme);
        mount.querySelector<HTMLButtonElement>("button")!.click();
      });
      const fallback = mount.querySelector<HTMLDivElement>('[role="alert"]')!;
      expect(fallback.dataset.effectiveTheme).toBe(theme);
      expect(fallback.textContent).toBe("Something went wrongTry again");
      expect(mount.textContent).not.toContain("Private rendering failure");
      expect(mount.querySelector("pre")).toBeNull();
      expect(mount.querySelectorAll("button")).toHaveLength(1);
      await act(async () => mount.querySelector<HTMLButtonElement>("button")!.click());
      expect(mount.textContent).toBe("Working screen");
      expect(mount.querySelector('[role="alert"]')).toBeNull();
      expect(useSettingsStore.getState().preferences.theme).toBe(theme);
    }
    expect(logs.filter(args => args[0] === "[ErrorBoundary]")).toHaveLength(2);
    expect(logs.some(args => args[1] instanceof Error && args[1].message.includes("/private/workspace"))).toBe(true);
  } finally {
    await act(async () => root.unmount()); mount.remove();
    useSettingsStore.getState().restoreSnapshot(saved); console.error = originalError;
  }
});

test("the recovery screen follows appearance changes even while App is unmounted", async () => {
  const saved = getSettingsStoreSnapshot(); const originalError = console.error; console.error = () => {};
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount, { onCaughtError() {} });
  try {
    useSettingsStore.getState().setPreference("theme", "light");
    await act(async () => root.render(<ErrorBoundary><FragileScreen /></ErrorBoundary>));
    await act(async () => mount.querySelector<HTMLButtonElement>("button")!.click());
    await act(async () => {
      useSettingsStore.getState().setPreference("theme", "dark");
      useSettingsStore.getState().setPreference("themeDarkBackground", "#242424");
    });
    const fallback = mount.querySelector<HTMLDivElement>('[role="alert"]')!;
    expect(fallback.dataset.effectiveTheme).toBe("dark");
    expect(fallback.style.getPropertyValue("--bg-base")).toBe("#242424");
    expect(mount.textContent).toBe("Something went wrongTry again");
  } finally {
    await act(async () => root.unmount()); mount.remove();
    useSettingsStore.getState().restoreSnapshot(saved); console.error = originalError;
  }
});
