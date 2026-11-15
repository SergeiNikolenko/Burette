import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "../apps/desktop/node_modules/fflate/esm/browser.js";
import { Window } from "happy-dom";
import React, { act } from "react";
import { commandInput, readCommandOptions, readCommandOutput } from "../apps/desktop/src/lib/extensions/avogadro-command-io";
import { readPluginManifest } from "../apps/desktop/src/lib/extensions/avogadro-plugin-manifest";
import { availableCommands, commandMenuItems, requestAvogadroCommand } from "../apps/desktop/src/lib/extensions/avogadro-commands";
import type { InstalledAvogadroPlugin } from "../apps/desktop/src/lib/extensions/avogadro-plugin-runner";
import type { MolecularStructure } from "../apps/desktop/src/lib/molecular-workbench/molecular-graph";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/avogadro/${name}`, import.meta.url), "utf8");
const archive = unzipSync(new Uint8Array(readFileSync(new URL("./fixtures/avogadro/avogadro-rdkit-82498e3a.zip", import.meta.url))));
const packaged = (name: string) => strFromU8(Object.entries(archive).find(([path]) => path.endsWith(`/${name}`))![1]);
const manifest = readPluginManifest(packaged("pyproject.toml"))!;
const command = (identifier: string) => manifest.commands.find(entry => entry.identifier === identifier)!;
const plugin = (prepared: boolean): InstalledAvogadroPlugin => ({ name: "avogadro-rdkit", version: "0.3.0", commit: "82498e3a3cedc2d465ccdcd93cabec1b2505dc5a",
  sha256: "f93c4df5296eae7a52e482a3b334452adab1123d06330845db334879ceea9fa4", archiveBytes: 13716, files: 14, expandedBytes: 22375,
  pyproject: packaged("pyproject.toml"), licenseText: packaged("LICENSE"), prepared });
const water: MolecularStructure = {
  title: "water", graphSource: "explicit", graphComplete: true,
  atoms: [{ element: "O", x: 0, y: 0, z: 0 }, { element: "H", x: 0.96, y: 0, z: 0 }, { element: "H", x: -0.24, y: 0.93, z: 0 }],
  bonds: [{ a: 0, b: 1, order: 1 }, { a: 0, b: 2, order: 1 }],
  molfile: "water\n  Burette\n\n  3  2  0  0  0  0  0  0  0  0999 V2000\n    0.0000    0.0000    0.0000 O   0  0\n    0.9600    0.0000    0.0000 H   0  0\n   -0.2400    0.9300    0.0000 H   0  0\n  1  2  1  0\n  1  3  1  0\nM  END\n",
};

test("the package's own option files become typed fields with their defaults", () => {
  expect(readCommandOptions(packaged("etkdg_options.json"))).toEqual([
    { key: "conformers", label: "Conformers", type: "integer", value: 10, minimum: 1, maximum: 500, tooltip: "Number of ETKDG conformers to generate" },
    { key: "ff", label: "Force Field", type: "stringList", values: ["MMFF94", "UFF", "None"], value: "MMFF94", tooltip: "MMFF94 falls back to UFF for atoms without MMFF parameters" },
  ]);
  expect(readCommandOptions(packaged("smarts_options.json"))).toEqual([{ key: "SMARTS", label: "SMARTS Pattern", type: "string", value: "a" }]);
  expect(readCommandOptions('{"bad\\u0007key": {"type": "integer"}, "Processor Cores": {"type": "integer", "default": 2}, "x": {"type": "filePath"}, "flag": {"type": "boolean", "default": true}}'))
    .toEqual([{ key: "Processor Cores", label: "Processor Cores", type: "integer", value: 2 }, { key: "flag", label: "flag", type: "boolean", value: true }]);
});

test("command input carries the declared format, CJSON when asked, the selection and options", () => {
  const sdf = JSON.parse(commandInput(command("etkdg"), water, { conformers: 3, ff: "UFF" }, [1, 2]));
  expect(sdf).toEqual({ sdf: `${water.molfile}$$$$\n`, inputMoleculeFormat: "sdf", selectedAtoms: [1, 2], charge: 0, spin: 1, options: { conformers: 3, ff: "UFF" } });
  const stereo = JSON.parse(commandInput(command("assign-stereo"), water, {}));
  expect(stereo.cjson).toEqual({ chemicalJson: 1, atoms: { elements: { number: [8, 1, 1] }, coords: { "3d": [0, 0, 0, 0.96, 0, 0, -0.24, 0.93, 0] } },
    bonds: { connections: { index: [0, 1, 0, 2] }, order: [1, 1] } });
  expect(stereo.sdf).toBe(`${water.molfile}$$$$\n`);
});

test("recorded avogadro-rdkit answers open, select or report exactly as the protocol defines", () => {
  const optimized = readCommandOutput(fixture("rdkit-mmff94-caffeine.stdout.json"), 24);
  expect(optimized.molecule?.extension).toBe("sdf");
  expect(optimized.molecule?.text).toContain("M  END");
  expect(optimized).toMatchObject({ append: false, selectedAtoms: [], messages: [] });
  const conformers = readCommandOutput(fixture("rdkit-etkdg-caffeine.stdout.json"), 24);
  expect(conformers.molecule?.text.match(/\$\$\$\$/gu)?.length).toBe(3);
  expect(readCommandOutput(fixture("rdkit-select-smarts-caffeine.stdout.json"), 24)).toEqual({ append: true, selectedAtoms: [2, 3, 4, 5], messages: [] });
  // Out-of-range indices are dropped; library chatter before the JSON is ignored, as in Avogadro.
  expect(readCommandOutput('warning: slow\n{"selectedAtoms": [9, 1, 1, -2], "message": ["Done", "twice"]}', 3))
    .toEqual({ append: false, selectedAtoms: [1], messages: [{ kind: "message", text: "Done\ntwice" }] });
  const labelled = readCommandOutput(JSON.stringify({ moleculeFormat: "cjson", cjson: {
    chemicalJson: 1, atoms: { elements: { number: [6, 1] }, coords: { "3d": [0, 0, 0, 1.09, 0, 0] }, labels: ["(R)", ""] },
    bonds: { connections: { index: [0, 1] }, order: [1], labels: ["E"] },
  } }), 2);
  expect(labelled.molecule?.extension).toBe("sdf");
  expect(labelled.messages).toEqual([{ kind: "message", text: "C1 (R), Bond 1 E" }]);
  expect(readCommandOutput("", 1)).toEqual({ append: false, selectedAtoms: [], messages: [] });
  expect(() => readCommandOutput('{"moleculeFormat": "gro", "gro": "x"}', 1)).toThrow();
  expect(() => readCommandOutput("Traceback (most recent call last)", 1)).toThrow();
});

test("only prepared packages contribute commands, nested by Avogadro's menu placement", () => {
  expect(availableCommands([plugin(false)])).toEqual([]);
  const entries = availableCommands([plugin(true)]);
  expect(entries.map(entry => entry.path.join(" › "))).toEqual(["RDKit › Standardize", "RDKit › Canonical Tautomer", "RDKit › MMFF94 Optimize", "RDKit › UFF Optimize",
    "RDKit › ETKDG Conformer", "RDKit › Assign Stereochemistry", "Select › Select by SMARTS", "Build › Insert › SMILES (RDKit)"]);
  expect(entries.every(entry => entry.script === "avogadro-rdkit")).toBe(true);
  const ran: string[] = [];
  const [root] = commandMenuItems(entries, entry => ran.push(entry.command.identifier));
  expect(root.kind === "submenu" && root.items.map(item => item.text)).toEqual(["RDKit", "Select", "Build"]);
  const build = root.kind === "submenu" ? root.items[2] : undefined;
  const insert = build?.kind === "submenu" ? build.items[0] : undefined;
  expect(insert?.kind === "submenu" && insert.items.map(item => item.text)).toEqual(["SMILES (RDKit)"]);
  if (insert?.kind === "submenu" && insert.items[0].kind === "item") insert.items[0].action();
  expect(ran).toEqual(["insert-smiles"]);
});

const browser = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "HTMLSelectElement", "DocumentFragment", "NodeFilter", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "DOMRect", "CustomEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? browser : browser[key] });
}
previous.set("IS_REACT_ACT_ENVIRONMENT", Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterAll(() => { for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} });

test("a command with user options asks for them, validates numbers and can be cancelled without running", async () => {
  const { createRoot } = await import("react-dom/client");
  const { AvogadroCommandHost } = await import("../apps/desktop/src/components/workbench/avogadro-command-host");
  const { createAvogadroPluginRunner } = await import("../apps/desktop/src/lib/extensions/avogadro-plugin-runner");
  const calls: string[] = [];
  const runner = createAvogadroPluginRunner({ call: async <T,>(name: string, args?: Record<string, unknown>) => {
    calls.push(name);
    return (name === "avogadro_plugin_options" && args?.path === "customization/etkdg_options.json" ? packaged("etkdg_options.json") : undefined) as T;
  } });
  const host = browser.document.createElement("div"); browser.document.body.append(host);
  const root = createRoot(host);
  const entry = availableCommands([plugin(true)]).find(item => item.command.identifier === "etkdg")!;
  const document = { id: "doc", title: "caffeine.sdf" } as never;
  try {
    await act(async () => root.render(<AvogadroCommandHost runner={runner} actions={{ openStructureRecords: async () => [], runStructureViewerAction: async () => undefined }} />));
    await act(async () => { requestAvogadroCommand({ entry, document, selectedAtoms: [], selectionTruncated: false }); await new Promise(resolve => setTimeout(resolve, 5)); });
    const dialog = browser.document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector("h2")?.textContent).toBe("RDKit › ETKDG Conformer");
    const conformers = dialog.querySelector<HTMLInputElement>('input[aria-label="Conformers"]')!;
    expect(conformers.value).toBe("10");
    expect(dialog.querySelector<HTMLSelectElement>('select[aria-label="Force Field"]')!.value).toBe("MMFF94");
    const runButton = () => Array.from(browser.document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(button => button.textContent === "Run")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")!.set!.call(conformers, "900");
      conformers.dispatchEvent(new browser.Event("input", { bubbles: true }));
    });
    expect(runButton().disabled).toBe(true);
    await act(async () => Array.from(browser.document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(button => button.textContent === "Cancel")!.click());
    await act(async () => { await browser.happyDOM.waitUntilComplete(); });
    expect(browser.document.querySelector('[role="dialog"]')).toBeNull();
    expect(calls).toEqual(["avogadro_plugin_options"]);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
