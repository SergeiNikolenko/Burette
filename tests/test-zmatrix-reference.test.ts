// The coordinate CLI against independent internal coordinates. Open Babel wrote
// the Gaussian (`gzmat`) and MOPAC (`mopin`) definitions of RDKit conformers and
// RDKit named their stereocentres; tests/support/regenerate-zmatrix-oracles.py
// regenerates them. Every conversion runs the real CLI subprocess, and its output
// is opened by the compiled reader worker the browser shell uses.
import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runReaderTask } from "../apps/desktop/src/lib/workbench/reader-task";

type Vector = [number, number, number];
type Case = { centres: { atom: number; neighbors: number[]; cip: string }[]; doubleBonds: { atoms: number[]; trans: boolean }[] };

const fixtures = new URL("./fixtures/zmatrix-reference/", import.meta.url).pathname;
const cli = new URL("../scripts/burette-agent.mjs", import.meta.url).pathname;
const oracle = JSON.parse(readFileSync(join(fixtures, "oracle.json"), "utf8")) as { cases: Record<string, Case> };
const directory = mkdtempSync(join(tmpdir(), "zmatrix-reference-"));

const built = await Bun.build({ entrypoints: [new URL("../apps/desktop/src/lib/workbench/reader-worker.ts", import.meta.url).pathname], target: "browser", format: "esm" });
if (!built.success) throw new AggregateError(built.logs, "Reader worker build failed");
const workerFile = join(directory, "worker.js");
await Bun.write(workerFile, built.outputs[0]);
const NativeWorker = Worker;
class CompiledWorker extends NativeWorker {
  constructor(_url: string | URL, options?: WorkerOptions) { super(pathToFileURL(workerFile), options); }
}
Object.defineProperty(globalThis, "Worker", { configurable: true, value: CompiledWorker });
afterAll(() => {
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: NativeWorker });
  rmSync(directory, { recursive: true, force: true });
});

let serial = 0;
function convert(input: string, format: "xyz" | "zmat") {
  const output = join(directory, `${serial++}.${format}`);
  const child = spawnSync("node", [cli, "convert", "--file", input, "--format", format, "--output", output],
    { encoding: "utf8", timeout: 15000, env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" } });
  const response = JSON.parse(child.status === 0 ? child.stdout : child.stderr);
  return response.ok ? { path: output, text: readFileSync(output, "utf8") } : { error: response.error as { code: string; message: string } };
}
// Coordinates compare as numbers: a written -0 has no physical sign and reads back as 0.
const xyzAtoms = (text: string) => text.split(/\r?\n/u).slice(2, 2 + Number(text.split(/\r?\n/u)[0]))
  .map(line => { const [element, ...xyz] = line.trim().split(/\s+/u); return { element, position: xyz.map(value => Number(value) + 0) as Vector }; });
const sub = (a: Vector, b: Vector): Vector => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const distance = (a: Vector, b: Vector) => Math.hypot(...sub(a, b));
const cross = (a: Vector, b: Vector): Vector => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const volume = (p: Vector[], centre: number, [a, b, c]: number[]) => dot(sub(p[a], p[centre]), cross(sub(p[b], p[centre]), sub(p[c], p[centre])));
function dihedral(p: Vector[], [a, b, c, d]: number[]) {
  const axis = sub(p[c], p[b]), n1 = cross(sub(p[b], p[a]), axis), n2 = cross(axis, sub(p[d], p[c]));
  return Math.atan2(dot(cross(n1, n2), axis) / Math.hypot(...axis), dot(n1, n2)) * 180 / Math.PI;
}
function maxDistanceError(a: Vector[], b: Vector[]) {
  let worst = 0;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < i; j++) worst = Math.max(worst, Math.abs(distance(a[i], a[j]) - distance(b[i], b[j])));
  return worst;
}
function expectSameStereo(name: string, original: Vector[], rebuilt: Vector[]) {
  for (const { atom, neighbors } of oracle.cases[name].centres) {
    expect(Math.sign(volume(rebuilt, atom, neighbors))).toBe(Math.sign(volume(original, atom, neighbors)));
  }
  for (const { atoms, trans } of oracle.cases[name].doubleBonds) expect(Math.abs(dihedral(rebuilt, atoms)) > 90).toBe(trans);
}

const names = Object.keys(oracle.cases);

test("CLI XYZ → Z-matrix → XYZ is exact and opens as the same atoms in the browser reader", async () => {
  expect(names.length).toBe(10);
  for (const name of names) {
    const source = join(fixtures, `${name}.xyz`), original = xyzAtoms(readFileSync(source, "utf8"));
    const zmat = convert(source, "zmat");
    if (!("path" in zmat)) throw new Error(`${name}: ${zmat.error.message}`);
    const back = convert(zmat.path, "xyz");
    if (!("text" in back)) throw new Error(`${name}: ${back.error.message}`);
    expect(xyzAtoms(back.text)).toEqual(original);
    const opened = await runReaderTask({ action: "parse", name: `${name}.zmat`, text: zmat.text });
    expect(opened.atoms.map(({ element, x, y, z }) => ({ element, position: [x, y, z] }))).toEqual(original);
    expect(opened.internalCoordinates?.rows.filter(row => row.element === "X").length).toBe(name === "acetonitrile-linear" ? 1 : 0);
  }
});

// Open Babel prints Gaussian distances to 1e-4 Å and angles to 0.01°, MOPAC both to 1e-6;
// the near-linear nitrile amplifies MOPAC's rounding through its 179.97° angle.
const tolerance = { gzmat: 5e-4, mopin: 2e-4 } as const;
// Open Babel's own definitions that no Cartesian geometry satisfies uniquely.
const refused: Record<string, string> = {
  "dichloroallene.gzmat": "Collinear references require dummy atoms for a non-linear placement.",
  "acetonitrile-linear.gzmat": "Coincident atoms are unsupported.",
  "acetonitrile-linear.mopin": "Coincident atoms are unsupported.",
};

test("Open Babel's Gaussian and MOPAC internal coordinates rebuild the original distances and stereochemistry", () => {
  for (const name of names) {
    const original = xyzAtoms(readFileSync(join(fixtures, `${name}.xyz`), "utf8"));
    for (const kind of ["gzmat", "mopin"] as const) {
      const result = convert(join(fixtures, `${name}.openbabel.${kind}.zmat`), "xyz");
      if ("error" in result) {
        expect(result.error.message).toBe(refused[`${name}.${kind}`]);
        continue;
      }
      expect(refused[`${name}.${kind}`]).toBeUndefined();
      const rebuilt = xyzAtoms(result.text);
      expect(rebuilt.map(atom => atom.element)).toEqual(original.map(atom => atom.element));
      expect(maxDistanceError(original.map(atom => atom.position), rebuilt.map(atom => atom.position))).toBeLessThan(tolerance[kind]);
      expectSameStereo(name, original.map(atom => atom.position), rebuilt.map(atom => atom.position));
    }
  }
});

test("a mirrored definition inverts every RDKit stereocentre", () => {
  for (const name of ["bromochlorofluoromethane", "l-alanine", "s-1-phenylethanol"]) {
    const text = readFileSync(join(fixtures, `${name}.openbabel.mopin.zmat`), "utf8");
    const mirrored = text.split("\n").map(line => {
      const fields = line.trim().split(/\s+/u);
      if (fields.length === 7) fields[6] = String(-Number(fields[6]));
      return fields.join(" ");
    }).join("\n");
    const input = join(directory, `${name}-mirror.zmat`);
    writeFileSync(input, mirrored);
    const result = convert(input, "xyz");
    if (!("text" in result)) throw new Error(result.error.message);
    const original = xyzAtoms(readFileSync(join(fixtures, `${name}.xyz`), "utf8")).map(atom => atom.position);
    const rebuilt = xyzAtoms(result.text).map(atom => atom.position);
    expect(maxDistanceError(original, rebuilt)).toBeLessThan(tolerance.mopin);
    for (const { atom, neighbors } of oracle.cases[name].centres) {
      expect(Math.sign(volume(rebuilt, atom, neighbors))).toBe(-Math.sign(volume(original, atom, neighbors)));
    }
  }
});
