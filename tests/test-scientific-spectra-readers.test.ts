import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { runReaderTask } from "../apps/desktop/src/lib/workbench/reader-task";
import { readOrcaNmrTables } from "../apps/desktop/src/lib/molecular-workbench/orca-nmr-spectra";
import { readOrcaOpticalTables } from "../apps/desktop/src/lib/molecular-workbench/orca-optical-spectra";
import { scientificSpectrumCsv } from "../apps/desktop/src/lib/molecular-workbench/scientific-spectra";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/quantum/${name}`, import.meta.url), "utf8");
const nmr = fixture("spectra-orca-nmr.out"), optical = fixture("spectra-orca-camphor.out"), gradient = JSON.parse(fixture("qcschema-water-gradient.json"));
const geometry = nmr.slice(0, nmr.indexOf("CHEMICAL SHIELDING SUMMARY"));
function vibration(frequency: number, vcd: boolean) {
  return `VIBRATIONAL FREQUENCIES\n---\n6: ${frequency} cm**-1\n\n${vcd ? `VCD SPECTRUM\n---\nMode Freq R\ncm**-1\n---\n6: ${frequency} -2.5\n\n` : ""}`;
}
function atomicResult() {
  const input = structuredClone(gradient);
  input.properties.excited_states = { units: "nm", transition_energies: [250, 310], intensities: [0.1, 0.3] };
  input.properties.nmr_shifts = { isotropic: [-35.25, 20.125, 21.5] };
  return input;
}

test("normal ORCA reader binds actual pinned NMR/optical source rows without changing source quantities", () => {
  const parsedNmr = parseScientificFile("actual-nmr.out", nmr), parsedOptical = parseScientificFile("actual-optical.out", optical);
  expect(parsedNmr.frames[0].spectra!.spectra).toEqual(readOrcaNmrTables(nmr, [6, 8, 1, 1]).map(table => table.spectrum));
  expect(parsedNmr.frames[0].spectra!.source).toEqual({ name: "actual-nmr.out", format: "orca-output", scope: "frame", frameIndex: 0, frameCount: 1 });
  expect(parsedOptical.frames[0].spectra!.spectra).toEqual(readOrcaOpticalTables(optical).map(table => table.spectrum));
  expect(parsedOptical.frames[0].spectra!.atomicNumbers).toEqual(parsedOptical.atoms.map(atom => atom.element === "O" ? 8 : atom.element === "C" ? 6 : 1));
  expect(scientificSpectrumCsv(parsedNmr.frames[0].spectra!, "nmr")).toContain("0,6,8.356,0,153.085\n1,8,-394.078,1,-1105.763\n");
  expect(parsedNmr.spectra).toBeUndefined(); // Per-frame data is never a file/current alias.
});

test("ORCA lexical source blocks own spectra even when the next geometry is identical", () => {
  const repeated = nmr + "\n" + geometry, before = repeated;
  const parsed = parseScientificFile("repeated.out", repeated);
  expect(parsed.frames).toHaveLength(2);
  expect(parsed.frames[0].atoms).toEqual(parsed.frames[1].atoms);
  expect(parsed.frames[0].spectra!.source).toMatchObject({ frameIndex: 0, frameCount: 2 });
  expect(parsed.frames[1].spectra).toBeUndefined();
  expect(parsed.atoms).toBe(parsed.frames[1].atoms);
  expect(repeated).toBe(before);
  const table = nmr.slice(nmr.indexOf("CHEMICAL SHIELDING SUMMARY"));
  expect(() => parseScientificFile("unowned.out", table + geometry)).toThrow("no preceding source geometry");
  for (const ending of ["\n", "\r\n", "\r"]) expect(parseScientificFile("repeated.out", repeated.replace(/\n/g, ending))).toEqual(parsed);
});

test("VCD follows the exact source frequency set, never the latest geometry or a later set without VCD", () => {
  const parsed = parseScientificFile("sets.out", geometry + vibration(1000, true) + geometry + vibration(1100, false));
  expect(parsed.frames[0].spectra!.spectra).toEqual([{ kind: "vcd", xUnit: "cm^-1", positions: [1000], values: [-2.5], valueUnit: null,
    sourceRowIds: ["6"], auxiliary: [{ name: "printed frequency", unit: "cm^-1", values: [1000] }] }]);
  expect(parsed.frames[1].spectra).toBeUndefined();
  expect(parsed.modes[0].frequencyCm1).toBe(1100);
  const recalculated = parseScientificFile("recalculated.out", geometry + vibration(1000, true) + vibration(1100, false));
  expect(recalculated.frames[0].spectra).toBeUndefined();
  expect(recalculated.modes[0].frequencyCm1).toBe(1100);
});

test("QCSchema extensions stay on their actual AtomicResult frames through initial/final geometry insertion", () => {
  const first = atomicResult(), second = atomicResult(); first.molecule.geometry[2] += 0.1; second.molecule.geometry[2] += 0.2;
  second.properties.nmr_shifts.isotropic[0] = -40.5;
  const final = structuredClone(second.molecule); final.geometry[2] += 0.1;
  const input = { schema_name: "qcschema_optimization_output", schema_version: 1, success: true, initial_molecule: gradient.molecule, final_molecule: final,
    trajectory: [first, second], energies: [first.properties.return_energy, second.properties.return_energy] };
  const text = JSON.stringify(input), parsed = parseScientificFile("explicit-nodes.qcschema", text);
  expect(parsed.frames.map(frame => frame.spectra?.source)).toEqual([undefined,
    { name: "explicit-nodes.qcschema", format: "qcschema", scope: "frame", frameIndex: 1, frameCount: 4 },
    { name: "explicit-nodes.qcschema", format: "qcschema", scope: "frame", frameIndex: 2, frameCount: 4 }, undefined]);
  expect(parsed.frames[1].spectra!.spectra[0]).toMatchObject({ kind: "electronic", xUnit: "nm", positions: [250, 310], values: [0.1, 0.3] });
  expect(parsed.frames[2].spectra!.spectra[1]).toEqual({ kind: "nmr", quantity: "native-input", atomIndices: [0, 1, 2], valuesPpm: [-40.5, 20.125, 21.5] });
  expect(parsed.frames.every(frame => !("propertySpectra" in frame))).toBe(true);
  expect(parsed.spectra).toBeUndefined();
  expect(JSON.stringify(input)).toBe(text);
  const single = parseScientificFile("single.qcschema", JSON.stringify(first));
  expect(single.frames[0].spectra!.source).toMatchObject({ frameIndex: 0, frameCount: 1 });
});

test("real reader-worker cloning retains raw spectra, exact source ownership and abort behavior", async () => {
  const raw = "\uFEFF" + nmr.replaceAll("\n", "\r\n"), file = new File([raw], "worker-source.out");
  const before = new Uint8Array(await file.arrayBuffer()), text = await file.text();
  const parsed = await runReaderTask({ action: "parse", name: file.name, text });
  expect(parsed).toEqual(parseScientificFile(file.name, text));
  expect(parsed.frames[0].spectra!.spectra[0]).toHaveProperty("quantity", "isotropic-shielding");
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(before);
  const request = { action: "parse" as const, name: "worker.qcschema", text: JSON.stringify(atomicResult()) };
  expect(await runReaderTask(request)).toEqual(parseScientificFile(request.name, request.text));
  const controller = new AbortController(), pending = runReaderTask(request, { signal: controller.signal }); controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect((await runReaderTask(request)).frames[0].spectra!.source).toHaveProperty("frameCount", 1);
});

test("normal reader rejects invalid source identities and aggregate frame data rather than publishing a partial document", () => {
  expect(() => parseScientificFile("bad-nmr.out", nmr.replace("      1       O", "      0       O"))).toThrow();
  const invalid = atomicResult(); invalid.properties.nmr_shifts.isotropic = [1];
  expect(() => parseScientificFile("bad.qcschema", JSON.stringify(invalid))).toThrow("source atoms");
  const many = atomicResult(); many.properties.excited_states = { units: "eV", transition_energies: Array(4999).fill(4), intensities: Array(4999).fill(0.1) };
  const input = { schema_name: "qcschema_optimization_output", schema_version: 1, success: true, initial_molecule: many.molecule, final_molecule: many.molecule,
    trajectory: [many, many], energies: [many.properties.return_energy, many.properties.return_energy] };
  expect(() => parseScientificFile("large.qcschema", JSON.stringify(input))).toThrow("across all source frames");
});
