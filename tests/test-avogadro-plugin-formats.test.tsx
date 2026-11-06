import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import React, { act } from "react";
import { readCjsonGraph } from "../apps/desktop/src/lib/molecular-workbench/cjson-graph";
import { readCommandOptions } from "../apps/desktop/src/lib/extensions/avogadro-command-io";
import { availableFormats, formatsForPath, openWithAvogadroFormat } from "../apps/desktop/src/lib/extensions/avogadro-formats";
import { availableGenerators, generatorInput, readGeneratorOutput, replaceKeywords } from "../apps/desktop/src/lib/extensions/avogadro-input-generators";
import { readPluginManifest } from "../apps/desktop/src/lib/extensions/avogadro-plugin-manifest";
import { createAvogadroPluginRunner, type InstalledAvogadroPlugin } from "../apps/desktop/src/lib/extensions/avogadro-plugin-runner";

// Recorded from the real packages at the pinned commits (OpenChemistry/avogadro-cclib cf5f13ba,
// OpenChemistry/avogenerators 965ea630) run through pixi with the stdin these modules write.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/avogadro/${name}`, import.meta.url), "utf8");
const installed = (name: string, pyproject: string): InstalledAvogadroPlugin => ({ name, version: "1.0.0", commit: "0".repeat(40), sha256: "0".repeat(64),
  archiveBytes: 1, files: 1, expandedBytes: 1, pyproject, licenseText: null, prepared: true });
const cclib = installed("avogadro-cclib", fixture("avogadro-cclib-cf5f13ba.pyproject.toml"));
const generators = installed("avogadro-generators", fixture("avogadro-generators-965ea630.pyproject.toml"));
const water = {
  atoms: [{ element: "O", x: 0, y: 0, z: 0.1173 }, { element: "H", x: 0, y: 0.7572, z: -0.4692 }, { element: "H", x: 0, y: -0.7572, z: -0.4692 }],
  bonds: [{ a: 0, b: 1, order: 1 as const }, { a: 0, b: 2, order: 1 as const }],
};

test("the real packages declare one reader and eleven input generators", () => {
  expect(readPluginManifest(cclib.pyproject)).toMatchObject({ script: "avogadro-cclib", commands: [], generators: [], otherFeatures: {},
    formats: [{ identifier: "cclib", name: "cclib", extensions: ["out", "log", "adfout", "g16", "g09", "g03", "g98", "fchk"], outputFormat: "cjson", inputMode: "string" }] });
  const manifest = readPluginManifest(generators.pyproject)!;
  expect(manifest.generators.map(entry => entry.programName)).toEqual(["Dalton", "GAMESS-UK", "Gaussian", "MOLPRO", "MOPAC", "NWChem", "ORCA", "Psi", "PySCF", "Q-Chem", "TeraChem"]);
  expect(manifest.generators.find(entry => entry.identifier === "orca")).toEqual({ identifier: "orca", programName: "ORCA", inputFormat: "cjson", periodic: false,
    userOptions: "src/avogadro_generators/orca/options.toml" });
  expect(manifest.otherFeatures).toEqual({});
  expect(formatsForPath(availableFormats([cclib, generators]), "/runs/Water.LOG").map(entry => entry.id)).toEqual(["avogadro-cclib:cclib"]);
  expect(formatsForPath(availableFormats([cclib]), "/runs/water.xyz")).toEqual([]);
  expect(availableGenerators([{ ...generators, prepared: false }])).toEqual([]);
});

test("generator options keep Avogadro's spaced keys, tabs and empty list entries, from JSON and TOML", () => {
  const gaussian = readCommandOptions(fixture("generators-gaussian-options.json"), "src/avogadro_generators/gaussian/options.json");
  expect(gaussian.find(option => option.key === "Calculation Type")).toEqual({ key: "Calculation Type", label: "Calculation Type", type: "stringList",
    values: ["Single Point", "Equilibrium Geometry", "Frequencies"], value: "Equilibrium Geometry", tab: "Standard" });
  const orca = readCommandOptions(fixture("generators-orca-options.toml"), "src/avogadro_generators/orca/options.toml");
  expect(orca.find(option => option.key === "Processor Cores")).toEqual({ key: "Processor Cores", label: "Number of Processes", type: "integer", value: 1, minimum: 1, tab: "Basic" });
  // The empty first entry is ORCA's "no auxiliary basis"; dropping it would shift the default to def2/JK.
  expect(orca.find(option => option.values?.includes?.("def2/JK"))?.value).toBe("");
  expect([...new Set(orca.map(option => option.tab))]).toEqual(["Basic", "SCF", "Basis", "Electric Properties"]);
});

test("keywords become Burette coordinate blocks, and a file offering both forms keeps the chosen one", () => {
  const options = Object.fromEntries(readCommandOptions(fixture("generators-gaussian-options.json")).map(option => [option.key, option.value]));
  expect(JSON.parse(generatorInput(water, options))).toMatchObject({ charge: 0, spin: 1, selectedAtoms: [], options: { Theory: "B3LYP", Basis: "6-31G(d)" },
    cjson: { atoms: { elements: { number: [8, 1, 1] } }, bonds: { connections: { index: [0, 1, 0, 2] } } } });
  const cartesian = readGeneratorOutput(fixture("generators-gaussian-water.stdout.json"), water, options);
  expect(cartesian.mainFile).toBe("water.gjf");
  expect(cartesian.files[0].text).toBe("%NProcShared=8\n%mem=28GB\n%Chk=water.chk\n#p B3LYP/6-31G(d) Opt\n\n \n\n0 1\n"
    + "O      0.000000    0.000000    0.117300\nH      0.000000    0.757200   -0.469200\nH      0.000000   -0.757200   -0.469200\n\n");
  const zmatrix = readGeneratorOutput(fixture("generators-gaussian-water.stdout.json"), water, { ...options, Coordinates: "Z-Matrix / Internal" }).files[0].text;
  expect(zmatrix).toContain("0 1\n O  \n H    1     0.957776\n H    1     0.957776  2   104.479839\n\n");
  expect(zmatrix).not.toContain("0.757200");
  // ORCA writes only the padded Z-matrix it was asked for; Dalton returns two files.
  expect(readGeneratorOutput(fixture("generators-orca-zmatrix-water.stdout.json"), water, { Coordinates: "Z-Matrix" }).files[0].text)
    .toContain("* int 0 1\n    O    0  0  0     0.000000     0.000000     0.000000\n    H    1  0  0     0.957776     0.000000     0.000000\n    H    1  2  0     0.957776   104.479839     0.000000\n*");
  expect(readGeneratorOutput(fixture("generators-dalton-water.stdout.json"), water, {}).files.map(file => file.name)).toEqual(["water.dal", "water.mol"]);
  expect(replaceKeywords("$$atomCount$$ atoms, $$bondCount$$ bonds\n  $$zmat:S$$\n$$coords:S$$", water, { Coordinates: "Cartesian" })).toBe("3 atoms, 2 bonds\nO  \nH  \nH  ");
  expect(() => readGeneratorOutput('{"files": [{"filename": "../x", "contents": ""}]}', water, {})).toThrow();
  expect(() => readGeneratorOutput('{"files": [{"filename": "x.in", "filePath": "/etc/hosts"}]}', water, {})).toThrow();
});

test("a reader sends the file text with --read and opens the CJSON it prints next to the file", async () => {
  const calls: Record<string, unknown>[] = [];
  const runner = createAvogadroPluginRunner({ call: async <T,>(command: string, args?: Record<string, unknown>) => {
    if (command === "avogadro_plugin_run") { calls.push(args!); return `Parsing...\n${fixture("cclib-read-water-mp2.stdout.cjson")}` as T; }
    return [] as T;
  } });
  const opened: unknown[] = [];
  const [entry] = availableFormats([cclib]);
  const documents = await openWithAvogadroFormat(entry, "/runs/water_mp2.log", { openStructureRecords: async records => { opened.push(...records); return [{ id: "new" }] as never; } },
    { runner, readText: async () => "Gaussian log text" });
  expect(documents).toHaveLength(1);
  expect(calls).toEqual([expect.objectContaining({ name: "avogadro-cclib", script: "avogadro-cclib", identifier: "cclib", operation: "read", input: "Gaussian log text" })]);
  expect(opened).toEqual([{ path: "water_mp2.cjson", inputExtension: "cjson", text: fixture("cclib-read-water-mp2.stdout.cjson") }]);
  // Burette's own CJSON reader takes cclib's document as is.
  expect(readCjsonGraph("water_mp2.cjson", fixture("cclib-read-water-mp2.stdout.cjson")).structure.atoms.map(atom => atom.element)).toEqual(["O", "H", "H"]);
  const failing = createAvogadroPluginRunner({ call: async <T,>(command: string) => { if (command === "avogadro_plugin_run") throw new Error("exit 1"); return [] as T; } });
  await expect(openWithAvogadroFormat(entry, "/runs/a.log", { openStructureRecords: async () => [] }, { runner: failing, readText: async () => "x" })).rejects.toThrow("cclib could not read a.log.");
});

const browser = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "HTMLSelectElement", "HTMLTextAreaElement", "DocumentFragment", "NodeFilter", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "DOMRect", "CustomEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? browser : browser[key] });
}
previous.set("IS_REACT_ACT_ENVIRONMENT", Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterAll(() => { for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} });

test("the plugin form shows the generator's options and its preview, and regenerates when an option changes", async () => {
  const { createRoot } = await import("react-dom/client");
  const { PluginInputForm } = await import("../apps/desktop/src/components/workbench/plugin-input-form");
  const inputs: Record<string, unknown>[] = [];
  const runner = createAvogadroPluginRunner({ call: async <T,>(command: string, args?: Record<string, unknown>) => {
    if (command === "avogadro_plugin_options") return fixture("generators-gaussian-options.json") as T;
    if (command === "avogadro_plugin_run") { inputs.push(JSON.parse(args!.input as string).options); return fixture("generators-gaussian-water.stdout.json") as T; }
    return [] as T;
  } });
  const entry = availableGenerators([generators]).find(item => item.generator.identifier === "gaussian")!;
  const host = browser.document.createElement("div"); browser.document.body.append(host);
  const root = createRoot(host);
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 500)); });
  try {
    await act(async () => root.render(<PluginInputForm entry={entry} document={{ id: "doc", title: "water.xyz" } as never} molecule={water} runner={runner}
      actions={{ saveKetcherExportFile: async () => ({ status: "cancelled" }) }} />));
    await settle();
    expect([...host.querySelectorAll('[aria-label="Option group"] button')].map(button => button.textContent)).toEqual(["Standard", "Alternate"]);
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Filename Base"]')?.value).toBe("water");
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="water.gjf contents"]')?.value).toContain("O      0.000000    0.000000    0.117300");
    const coordinates = host.querySelector<HTMLSelectElement>('select[aria-label="Coordinates"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(browser.HTMLSelectElement.prototype, "value")!.set!.call(coordinates, "Z-Matrix / Internal");
      coordinates.dispatchEvent(new browser.Event("change", { bubbles: true }));
    });
    await settle();
    expect(inputs.map(options => options.Coordinates)).toEqual(["Cartesian", "Z-Matrix / Internal"]);
    expect(host.querySelector<HTMLTextAreaElement>("textarea")?.value).toContain(" H    1     0.957776");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
