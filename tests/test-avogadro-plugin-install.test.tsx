import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "../apps/desktop/node_modules/fflate/esm/browser.js";
import { Window } from "happy-dom";
import React, { act } from "react";
import { readPluginManifest, parseToml } from "../apps/desktop/src/lib/extensions/avogadro-plugin-manifest";
import { createAvogadroPluginRunner, type InstalledAvogadroPlugin } from "../apps/desktop/src/lib/extensions/avogadro-plugin-runner";
import { createAvogadroCatalog } from "../apps/desktop/src/lib/extensions/avogadro-catalog";
import { parseAvogadroPluginIndex } from "../apps/desktop/src/lib/extensions/avogadro-plugin-index";

const archive = unzipSync(new Uint8Array(readFileSync(new URL("./fixtures/avogadro/avogadro-rdkit-82498e3a.zip", import.meta.url))));
const file = (name: string) => strFromU8(Object.entries(archive).find(([path]) => path.endsWith(`/${name}`))![1]);
const pyproject = file("pyproject.toml"), licenseText = file("LICENSE");
const savedText = readFileSync(new URL("../config/avogadro-plugin-index.snapshot.json", import.meta.url), "utf8");
const rdkit = parseAvogadroPluginIndex(JSON.parse(savedText)).plugins.find(plugin => plugin.name === "avogadro-rdkit")!;
const receipt: InstalledAvogadroPlugin = { name: rdkit.name, version: rdkit.version, commit: rdkit.commit, sha256: rdkit.archive.sha256,
  archiveBytes: 13716, files: 14, expandedBytes: 22375, pyproject, licenseText, prepared: false };

test("the real avogadro-rdkit pyproject declares its script and eight menu commands", () => {
  const manifest = readPluginManifest(pyproject)!;
  expect(manifest).toMatchObject({ name: "avogadro-rdkit", version: "0.3.0", script: "avogadro-rdkit", otherFeatures: {} });
  expect(manifest.commands.map(command => command.identifier)).toEqual(["standardize", "tautomer", "mmff94", "uff", "etkdg", "assign-stereo", "select-smarts", "insert-smiles"]);
  expect(manifest.commands.find(command => command.identifier === "etkdg")).toEqual({ identifier: "etkdg", label: "ETKDG Conformer", menuPath: ["Extensions", "RDKit"],
    inputFormat: "sdf", inputCjson: false, userOptions: "customization/etkdg_options.json" });
  expect(manifest.commands.find(command => command.identifier === "assign-stereo")?.inputCjson).toBe(true);
  expect(manifest.commands.find(command => command.identifier === "insert-smiles")?.menuPath).toEqual(["Build", "Insert"]);
});

test("the TOML subset reader keeps what it understands and skips the rest", () => {
  const document = parseToml([
    "[project]", 'name = "x" # trailing', "deps = [", '  "a",', '  "b",', "]", 'multi = """skipped"""', "pi = 3.5",
    "[tool.pixi.pypi-dependencies]", 'x = { path = ".", editable = true }',
    "[[tool.avogadro.energy-models]]", 'identifier = "one"', "[[tool.avogadro.energy-models]]", "identifier = 'two'",
  ].join("\n"));
  expect(document).toEqual({
    project: { name: "x", deps: ["a", "b"], pi: 3.5 },
    tool: { pixi: { "pypi-dependencies": { x: { path: ".", editable: true } } }, avogadro: { "energy-models": [{ identifier: "one" }, { identifier: "two" }] } },
  });
  expect(readPluginManifest('[project]\nname = "x"\n[project.scripts]\navogadro-x = "x:main"\navogadro-x-setup = "x:setup"\n[[tool.avogadro.energy-models]]\nidentifier = "e"\n'))
    .toEqual({ name: "x", version: undefined, script: "avogadro-x", commands: [], otherFeatures: { "energy-models": 1 } });
  expect(readPluginManifest("[tool]\nname = 'no project'")).toBeUndefined();
});

type Native = { command: string; args?: Record<string, unknown> };
function nativeShell() {
  const calls: Native[] = [], installed = new Map<string, InstalledAvogadroPlugin>();
  let next: ((args: Record<string, unknown>) => Promise<unknown>) | undefined;
  const call = async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
    calls.push({ command, args });
    if (command === "avogadro_plugins_installed") return [...installed.values()] as T;
    if (command === "avogadro_plugin_install") {
      const step = next; next = undefined;
      if (step) await step(args!);
      installed.set(receipt.name, receipt); return receipt as T;
    }
    if (command === "avogadro_plugin_remove") { installed.delete(args!.name as string); return undefined as T; }
    if (command === "avogadro_plugin_prepare") { const prepared = { ...receipt, prepared: true }; installed.set(receipt.name, prepared); return prepared as T; }
    return undefined as T;
  };
  return { call, calls, installed, failNextWith(message: string, gate?: Promise<void>) { next = async () => { await gate; throw message; }; } };
}

test("install, cancel, failure and removal become Jobs entries with fixed messages", async () => {
  const native = nativeShell(), runner = createAvogadroPluginRunner({ call: native.call });
  await runner.refresh();
  native.failNextWith("The downloaded plugin does not match the Avogadro plugin index");
  const failed = await runner.install(rdkit);
  expect(failed).toMatchObject({ status: "failed", plugin: "avogadro-rdkit", operation: "install",
    error: "The avogadro-rdkit download did not match the Avogadro plugin index. It was not installed." });

  let release!: () => void;
  native.failNextWith("Cancelled", new Promise<void>(resolve => { release = resolve; }));
  const pending = runner.install(rdkit);
  expect(runner.install(rdkit)).toBe(pending);
  const job = runner.getSnapshot().jobs[0];
  runner.cancel(job.id);
  expect(native.calls.at(-1)).toEqual({ command: "avogadro_plugin_cancel", args: { jobId: job.id } });
  expect(runner.getSnapshot().jobs[0].cancelable).toBe(false);
  release();
  expect((await pending)).toMatchObject({ status: "cancelled", error: undefined });
  expect(runner.getSnapshot().installed).toEqual([]);

  expect((await runner.install(rdkit))).toMatchObject({ status: "success", operation: "install" });
  expect(runner.getSnapshot().installed.map(plugin => plugin.name)).toEqual(["avogadro-rdkit"]);
  expect((await runner.install(rdkit)).operation).toBe("update");
  expect((await runner.remove("avogadro-rdkit")).status).toBe("success");
  expect(runner.getSnapshot().installed).toEqual([]);
  expect(native.calls.filter(entry => entry.command === "avogadro_plugin_install").map(entry => entry.args))
    .toEqual(Array(4).fill({ jobId: expect.any(String), name: "avogadro-rdkit", commit: rdkit.commit }));
});

const browser = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLIFrameElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "DOMRect", "CustomEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? browser : browser[key] });
}
previous.set("IS_REACT_ACT_ENVIRONMENT", Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterAll(() => { for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} });

test("Settings shows the license before installing, then the installed commands, license text and removal", async () => {
  const { createRoot } = await import("react-dom/client");
  const { ExtensionsSection } = await import("../apps/desktop/src/components/settings-panel/extensions-section");
  const { createResourceInstallRunner } = await import("../apps/desktop/src/lib/extensions/resource-install-runner");
  const { createResourceStore } = await import("../apps/desktop/src/lib/extensions/resource-store");
  const { IDBFactory } = await import("fake-indexeddb");
  const native = nativeShell(), plugins = createAvogadroPluginRunner({ call: native.call });
  const catalog = createAvogadroCatalog({ loadLive: async () => savedText });
  const resources = createResourceInstallRunner({ store: createResourceStore(new IDBFactory()) });
  await resources.refresh();
  const host = browser.document.createElement("div"); browser.document.body.append(host);
  const root = createRoot(host);
  const settle = () => act(async () => { await browser.happyDOM.waitUntilComplete(); });
  const finished = () => act(async () => {
    while (plugins.getSnapshot().jobs.some(job => job.status === "running")) await new Promise(resolve => setTimeout(resolve, 1));
    await new Promise(resolve => setTimeout(resolve, 1));
  });
  const byLabel = (label: string) => browser.document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const byText = (text: string) => Array.from(browser.document.querySelectorAll<HTMLButtonElement>("button")).find(node => node.textContent === text);
  const confirm = (text: string) => Array.from(browser.document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')).find(node => node.textContent === text)!;
  const search = async (query: string) => act(async () => {
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Search Avogadro plugins"]')!;
    Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")!.set!.call(input, query);
    input.dispatchEvent(new browser.Event("input", { bubbles: true }));
  });
  try {
    await act(async () => root.render(<ExtensionsSection catalog={catalog} plugins={plugins}
      extensions={{ ...resources.getSnapshot(), ...resources, openCrystalsStructure: async () => "" }} />));
    await settle();
    await search("rdkit");
    await act(async () => byLabel("Install avogadro-rdkit")!.click());
    const dialog = browser.document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("Install avogadro-rdkit 0.3.0?");
    expect(dialog.textContent).toContain("BSD-3-Clause");
    expect(dialog.textContent).toContain("github.com/ghutchis/avogadro-rdkit");
    expect(native.calls.some(entry => entry.command === "avogadro_plugin_install")).toBe(false);
    await act(async () => confirm("Install").click());
    await finished();
    expect(host.querySelector('li [role="status"]')?.textContent).toBe("Installed");

    await act(async () => byLabel("Set up avogadro-rdkit")!.click());
    expect(browser.document.querySelector('[role="alertdialog"]')?.textContent).toContain("runs the package's installer");
    expect(native.calls.some(entry => entry.command === "avogadro_plugin_prepare")).toBe(false);
    await act(async () => confirm("Set up").click());
    await finished();
    expect(host.querySelector('li [role="status"]')?.textContent).toBe("Ready");
    expect(byLabel("Set up avogadro-rdkit")).toBeNull();

    await act(async () => byLabel("avogadro-rdkit details")!.click());
    expect(host.textContent).toContain("RDKit › Standardize");
    expect(host.textContent).toContain("Select › Select by SMARTS");
    await act(async () => byText("View license")!.click());
    await settle();
    expect(browser.document.querySelector('[role="dialog"] pre')?.textContent).toBe(licenseText);
    await act(async () => browser.document.querySelector<HTMLElement>('[role="dialog"]')!.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await settle();

    native.failNextWith("connection reset");
    await search("multicharge");
    await act(async () => byLabel("Install avogadro-multicharge")!.click());
    await act(async () => confirm("Install").click());
    await finished();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("avogadro-multicharge could not be installed. Check the connection and try again.");
    await act(async () => byText("Dismiss")!.click());
    expect(host.querySelector('[role="alert"]')).toBeNull();

    await search("rdkit");
    await act(async () => byLabel("Remove avogadro-rdkit")!.click());
    expect(browser.document.querySelector('[role="alertdialog"]')?.textContent).toContain("Documents you opened or exported stay.");
    await act(async () => confirm("Remove").click());
    await finished();
    expect(byLabel("Install avogadro-rdkit")).not.toBeNull();
    expect(native.installed.size).toBe(0);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
