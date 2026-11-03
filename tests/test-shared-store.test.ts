import { expect, test } from "bun:test";
import { createStore } from "zustand/vanilla";
import { createJSONStorage, persist } from "zustand/middleware";
import { Window } from "happy-dom";
import { observeSharedStore, refreshSharedActions } from "../apps/desktop/src/stores/shared-store";

type State = {
  theme: string;
  roots: string[];
  setTheme: (theme: string) => void;
  addRoot: (root: string) => void;
};

test("production settings and shell actions merge external writes before mutation", async () => {
  const browser = new Window({ url: "http://localhost" });
  const previous = ["window", "localStorage"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: browser.localStorage });
  try {
    const { useSettingsStore } = await import("../apps/desktop/src/stores/settings-store");
    const { useShellStore } = await import("../apps/desktop/src/stores/shell-store");
    useSettingsStore.getState().setPreference("theme", "dark");
    const settings = JSON.parse(browser.localStorage.getItem("burette.shell")!);
    settings.state.preferences.theme = "light";
    browser.localStorage.setItem("burette.shell", JSON.stringify(settings));
    useSettingsStore.getState().setPreference("interfaceScale", 1.5);
    expect(useSettingsStore.getState().preferences.theme).toBe("light");
    expect(JSON.parse(browser.localStorage.getItem("burette.shell")!).state.preferences.interfaceScale).toBe(1.5);

    useShellStore.getState().addProjectRoot("/first");
    const shell = JSON.parse(browser.localStorage.getItem("burette.shell.ui")!);
    shell.state.projectRoots.push("/second");
    browser.localStorage.setItem("burette.shell.ui", JSON.stringify(shell));
    useShellStore.getState().togglePinnedProjectRoot("/second");
    useShellStore.getState().renameProjectRoot("/second", "Second");
    expect(JSON.parse(browser.localStorage.getItem("burette.shell.ui")!).state).toMatchObject({
      projectRoots: ["/first", "/second"], pinnedProjectRoots: ["/second"],
      projectNameOverrides: { "/second": "Second" },
    });
    browser.location.href = "http://localhost/?buretteWindow=workspace-preview-test";
    useShellStore.getState().addProjectRoot("/from-preview");
    expect(JSON.parse(browser.localStorage.getItem("burette.shell.ui")!).state.sidebarOpen).toBe(true);
    browser.location.href = "http://localhost/";
    browser.localStorage.setItem("burette.shell", JSON.stringify(settings));
    browser.dispatchEvent(new browser.StorageEvent("storage", {
      key: "burette.shell", storageArea: browser.localStorage,
    }));
    expect(useSettingsStore.getState().preferences.interfaceScale).toBe(1);
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await browser.happyDOM.close();
  }
});

test("shared actions preserve other window edits before storage events arrive", () => {
  const browser = new Window({ url: "http://localhost" });
  const storage = browser.localStorage;
  const makeStore = () => createStore<State>()(persist(
    refreshSharedActions<State>((set) => ({
      theme: "auto", roots: [],
      setTheme: (theme) => set({ theme }),
      addRoot: (root) => set((state) => ({ roots: [...state.roots, root] })),
    })),
    { name: "shared", storage: createJSONStorage(() => storage),
      partialize: ({ theme, roots }) => ({ theme, roots }) },
  ));
  const first = makeStore();
  const second = makeStore();
  first.getState().addRoot("/project-a");
  second.getState().setTheme("dark");
  first.getState().addRoot("/project-b");
  void second.persist.rehydrate();
  expect(JSON.parse(storage.getItem("shared")!).state).toEqual({
    theme: "dark", roots: ["/project-a", "/project-b"],
  });
  expect(second.getState().roots).toEqual(first.getState().roots);

  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  const stop = observeSharedStore(second);
  try {
    first.getState().setTheme("light");
    browser.dispatchEvent(new browser.StorageEvent("storage", {
      key: "shared", storageArea: storage,
    }));
    expect(second.getState().theme).toBe("light");
    first.getState().setTheme("dark");
    browser.dispatchEvent(new browser.Event("focus"));
    expect(second.getState().theme).toBe("dark");
    stop();
    first.getState().setTheme("auto");
    browser.dispatchEvent(new browser.Event("focus"));
    expect(second.getState().theme).toBe("dark");
  } finally {
    stop();
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("shared actions remain usable when persistence storage is unavailable", () => {
  const store = createStore<State>()(persist(refreshSharedActions((set) => ({
    theme: "auto", roots: [],
    setTheme: (theme) => set({ theme }),
    addRoot: (root) => set((state) => ({ roots: [...state.roots, root] })),
  })), { name: "unavailable", storage: createJSONStorage(() => { throw new Error("Storage unavailable"); }) }));
  store.getState().setTheme("dark");
  store.getState().addRoot("/local");
  expect(store.getState().theme).toBe("dark");
  expect(store.getState().roots).toEqual(["/local"]);
  expect(() => observeSharedStore(store)()).not.toThrow();
});
