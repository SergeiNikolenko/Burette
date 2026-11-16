import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { buildPeptideGeometry } from "../apps/desktop/src/lib/molecular-workbench/peptide-geometry";
import { peptideMmcif } from "../apps/desktop/src/lib/molecular-workbench/peptide-mmcif";
const require = createRequire(import.meta.url);
const { CIF } = require("@molstar/io/reader/cif");
const { trajectoryFromMmCIF } = require("@molstar/model/formats/structure/mmcif");
const { Structure } = require("@molstar/model/model/structure");

test("preview format changes replace the frame while theme changes retain the exact CIF document", () => {
  const source = readFileSync("apps/desktop/src/components/grid-molecule-3d.tsx", "utf8").replace(/^import .*;\n/gm, "")
    .replace(/const assets = import\.meta\.glob[^\n]+/, "const assets = {};").replace("export default function", "function");
  const code = new Bun.Transpiler({ loader: "tsx", tsconfig: { compilerOptions: { jsx: "react" } } }).transformSync(source);
  const refs: { current: unknown }[] = []; let cursor = 0, memo: { deps: unknown[]; value: unknown } | undefined;
  const render = new Function("React", "useRef", "useMemo", "useEffect", "window", "bootstrapUrl", `${code};return GridMolecule3D;`)(React,
    (value: unknown) => refs[cursor++] ??= { current: value }, (fn: () => unknown, deps: unknown[]) => {
      if (!memo || deps.some((value, i) => !Object.is(value, memo!.deps[i]))) memo = { deps, value: fn() }; return memo.value;
    }, () => {}, { location: { href: "https://burette.test/" } }, "/bootstrap.js");
  const view = (molblock: string, format: string, theme = "light") => { cursor = 0; return render({ molblock, format, theme, label: "Peptide", height: 240, hydrogenDisplay: "none", onOpen() {} }).props.srcDoc as string; };
  const input = (html: string) => JSON.parse(html.match(/id="burette-inspector-input">([^]*?)<\/script>/)![1]);
  const mol = view("old MOL source", "mol"), cif = peptideMmcif(buildPeptideGeometry("GP"));
  const first = view(cif, "mmcif");
  expect(input(first).config.molstarFormat).toBe("mmcif");
  expect(Buffer.from(input(first).data, "base64").toString()).toBe(cif);
  expect(input(first).config.inspectorChannel).not.toBe(input(mol).config.inspectorChannel);
  expect(view(peptideMmcif(buildPeptideGeometry("G")), "mmcif")).toBe(first);
  expect(view(cif, "mmcif", "dark")).toBe(first);
});

test("the actual inspector receiver reloads a full-graph CIF using its frame format", async () => {
  const source = readFileSync("PreviewExtension/Web/viewer.js", "utf8");
  const start = source.indexOf("    if (config.inspectorPreview === true) {", source.indexOf("async function createMolstarViewer"));
  // Anchor on the unique preview receiver when the surrounding viewer function changes.
  const begin = start < 0 ? source.indexOf("    if (config.inspectorPreview === true) {") : start;
  const end = source.indexOf("\n  }\n\n  function waitForFirstPaint", begin);
  expect(begin).toBeGreaterThan(0); expect(end).toBeGreaterThan(begin);
  let listener: (event: unknown) => Promise<void> = async () => {};
  const received: { format: string; text: string; atoms: number; bonds: number }[] = [];
  const initial = peptideMmcif(buildPeptideGeometry("G"));
  const next = peptideMmcif(buildPeptideGeometry("PP", { phi: 90, psi: -90 }));
  const env = { config: { inspectorPreview: true, inspectorChannel: "own", molstarFormat: "mmcif", label: "Peptide" }, activeConfig: {},
    activeViewer: { handleResize() {}, plugin: { canvas3d: null, managers: { camera: { orientAxes() {} } }, animationLoop: { tick: async () => {}, stop() {}, start() {} }, clear: async () => {} } },
    document: { getElementById: () => null }, window: { addEventListener: (_: string, fn: typeof listener) => { listener = fn; }, parent: { postMessage() {} } },
    performance, molstarShowHydrogens: false, structureDataForMolstar: () => ({ data: initial }), requestMolstarStructureFocus() {},
    captureMolstarTransitionFrame() {}, removeMolstarTransitionFrame() {}, toggleMolstarHydrogens: async () => {}, applyConfiguredMolstarPreset: async () => {},
    loadPreparedStructure: async (_: unknown, payload: { data: string; format: string }) => {
      expect(payload.format).toBe("mmcif");
      const parsed = await CIF.parse(payload.data).run(); expect(parsed.isError).toBe(false);
      const structure = Structure.ofModel((await trajectoryFromMmCIF(parsed.result.blocks[0]).run()).representative);
      received.push({ format: payload.format, text: payload.data, atoms: structure.elementCount,
        bonds: structure.units.reduce((sum: number, unit: { bonds: { edgeCount: number } }) => sum + unit.bonds.edgeCount, 0) });
    } };
  await new Function(...Object.keys(env), `return (async () => {${source.slice(begin, end)}})();`)(...Object.values(env));
  const message = { source: "burette-inspector-host", channel: "other", molblock: next, hydrogenDisplay: "none", format: "mol" };
  await listener({ data: message }); expect(received).toEqual([]);
  await listener({ data: { ...message, channel: "own" } });
  const expected = buildPeptideGeometry("PP", { phi: 90, psi: -90 });
  expect(received).toEqual([{ format: "mmcif", text: next, atoms: expected.atoms.length, bonds: expected.bonds.length }]);
});
