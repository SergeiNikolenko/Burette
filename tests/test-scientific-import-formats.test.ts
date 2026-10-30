import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { openScientificFiles } from "../apps/desktop/src/lib/workbench/open";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { openBrowserDevTextDocument, deleteBrowserDevVirtualTextDocument, readBrowserDevVirtualTextDocument } from "../apps/desktop/src/lib/browser-dev-documents";
import { releaseClosedImports, scientificStateFor } from "../apps/desktop/src/lib/workbench/scientific-source-state";
import { useMoleculeStore } from "../apps/desktop/src/stores/molecule-store";
import type { ShellActions } from "../apps/desktop/src/components/types";
import { defaultPreferences } from "../apps/desktop/src/stores/settings-store";
import type { ScientificDocument } from "../apps/desktop/src/lib/molecular-workbench/scientific-types";
import type { ViewerDocument } from "../apps/desktop/src/types";

const before = useMoleculeStore.getState().documents;
const opened: ViewerDocument[] = [];
const actions: Pick<ShellActions, "openStructureRecords"> = { openStructureRecords: async records => {
  const documents = await Promise.all(records.map(record => openBrowserDevTextDocument(record.path, record.inputExtension, record.text, { ...defaultPreferences, rendererMode: "molstar" })));
  opened.push(...documents); useMoleculeStore.setState(state => ({ documents: [...state.documents, ...documents] }));
  return documents;
} };
afterEach(() => {
  for (const document of opened.splice(0)) deleteBrowserDevVirtualTextDocument(document.path);
  useMoleculeStore.setState({ documents: before }); releaseClosedImports(new Set(before.map(document => document.id)));
});
const fixture = (name: string) => readFileSync(new URL(`./fixtures/quantum/${name}`, import.meta.url), "utf8");
const gradient = fixture("qcschema-water-gradient.json");
const step = JSON.parse(gradient), final = structuredClone(step.molecule); final.geometry[2] += .1;
const optimization = JSON.stringify({ schema_name: "qcschema_optimization_output", schema_version: 1, success: true,
  initial_molecule: step.molecule, final_molecule: final, trajectory: [step], energies: [step.properties.return_energy] });
const trajectory = "2\nEnergy=-1 Hartree\nH 0 0 0\nF 0 0 1\n2\nEnergy=-2 Hartree\nH 0 0 0\nF 0 0 2\n";
const cases: Array<[string, string, ScientificDocument["format"], "final" | "steps"]> = [
  ["water.fch", fixture("gaussian16-water-raman.fchk"), "fchk", "final"],
  ["hydrogen.molden", fixture("dispatcher/hydrogen.molden"), "molden", "final"],
  ["water.log", fixture("gaussian-water-optimization.log"), "gaussian-log", "final"],
  ["scan.out", fixture("dispatcher/two-step-orca.out"), "orca", "final"],
  ["modes.hess", fixture("dispatcher/normal-modes.hess"), "orca-hessian", "final"],
  ["water.qcschema", gradient, "qcschema", "final"],
  ["optimization.json", optimization, "qcschema", "steps"],
  ["field.cub", "source\nfield\n1 0 0 0\n-1 1 0 0\n-1 0 1 0\n-1 0 0 1\n1 0 0 0 0\n0.25\n", "cube", "final"],
  ["water.zmatrix", "O\nX 1 1\nH 1 R 2 A\nH 1 R 2 A 3 180\n\nR=.9572\nA=52.26\n", "zmat", "final"],
  ["trajectory.xyz", trajectory, "xyz", "steps"],
];

for (const [name, source] of [["water.fchk", "water.fch"], ["hydrogen.molf", "hydrogen.molden"],
  ["molden.input", "hydrogen.molden"], ["water.molden.input", "hydrogen.molden"], ["water.out", "water.log"],
  ["scan.log", "scan.out"], ["water.json", "water.qcschema"], ["field.cube", "field.cub"], ["water.zmat", "water.zmatrix"]]) {
  const original = cases.find(([name]) => name === source)!; cases.push([name, original[1], original[2], original[3]]);
}

for (const [name, text, format, layout] of cases) test(`actual scientific open preserves ${name} data and exact Original`, async () => {
  const raw = "\ufeff" + text.replace(/\r?\n/gu, "\r\n");
  const file = new File([raw], name), parsed = parseScientificFile(name, text);
  await openScientificFiles(actions, [file]); expect(opened).toHaveLength(1);
  const document = opened[0], normalized = readBrowserDevVirtualTextDocument(document.path)!;
  const state = scientificStateFor(document.id, normalized);
  expect([document.extension, document.renderer, document.virtual]).toEqual(["xyz", "molstar", true]);
  expect(state.revision?.document.format).toBe(format);
  expect(state.revision?.document).toEqual(layout === "final" ? parsed : {
    format: parsed.format, atoms: parsed.frames[0].atoms, frames: parsed.frames, modes: [], orbitals: [], converged: parsed.converged,
  });
  // XYZ serialization canonicalizes signed zero; scientific data above retains its exact values.
  const geometry = (layout === "final" ? [parsed.atoms] : parsed.frames.map(frame => frame.atoms)).map(atoms => atoms.map(({ element, x, y, z }) => ({ element, x: x + 0, y: y + 0, z: z + 0 })));
  expect(parseScientificFile("normalized.xyz", normalized).frames.map(frame => frame.atoms)).toEqual(geometry);
  expect(state.original?.name).toBe(name);
  expect(new Uint8Array(await state.original!.file.arrayBuffer())).toEqual(new Uint8Array(await file.arrayBuffer()));
});

test("compressed scientific opens use the tracked decoder and retain outer gzip bytes", async () => {
  const raw = "\ufeff" + fixture("gaussian16-water-raman.fchk").replaceAll("\n", "\r\n");
  const outer = gzipSync(raw), file = new File([outer], "water.fchk.gz");
  await openScientificFiles(actions, [file]); expect(opened).toHaveLength(1);
  const normalized = readBrowserDevVirtualTextDocument(opened[0].path)!;
  const state = scientificStateFor(opened[0].id, normalized);
  expect(state.revision?.document).toEqual(parseScientificFile("water.fchk", raw));
  expect(state.revision?.document.frames[0].hessian?.values).toBeInstanceOf(Float64Array);
  expect(state.original?.name).toBe("water.fchk.gz");
  expect(new Uint8Array(await state.original!.file.arrayBuffer())).toEqual(new Uint8Array(outer));
});

test("same-name opens keep distinct original and parsed ownership rather than matching names", async () => {
  const text = fixture("dispatcher/hydrogen.molden"), other = text.replace("Ene= -0.5", "Ene= -0.7");
  expect(other).not.toBe(text);
  const files = [new File([text], "same.molden"), new File([other], "same.molden")];
  await openScientificFiles(actions, files); expect(opened).toHaveLength(2); expect(opened[0].id).not.toBe(opened[1].id);
  const states = opened.map(document => scientificStateFor(document.id, readBrowserDevVirtualTextDocument(document.path)!));
  expect(states.map(state => state.revision!.document.orbitals[0].energyHartree)).toEqual([-.5, -.7]);
  expect(await Promise.all(states.map(state => state.original!.file.text()))).toEqual([text, other]);
});
