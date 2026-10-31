import { expect, test } from "bun:test";
import { checkMcdCompanion, type McdCompanionOwner, type ScientificMcdCompanion } from "../apps/desktop/src/lib/molecular-workbench/mcd-companion";
import { readOrcaMcdBlocks } from "../apps/desktop/src/lib/molecular-workbench/orca-circular-spectra";
import { scientificSpectrumCsv } from "../apps/desktop/src/lib/molecular-workbench/scientific-spectra";

// Authored source-format cases; no actual producer sidecar is represented here.
function fixture() {
  const owner: McdCompanionOwner = { primaryOriginalSha256: "a".repeat(64), companionOriginalSha256: "b".repeat(64),
    sourceRevisionSha256: "c".repeat(64), frameIndex: 5, frameCount: 7, atomicNumbers: [6, 8, 1, 1] };
  const input = "10000 -2.25 .12\r\n10001 -0 .25\r\n9000 3.4 1.25\r\n10002 -4.2 1.5";
  const blocks = readOrcaMcdBlocks(input);
  const pair: ScientificMcdCompanion = { primaryOriginalSha256: owner.primaryOriginalSha256,
    companionOriginalSha256: owner.companionOriginalSha256, sourceRevisionSha256: owner.sourceRevisionSha256,
    spectra: { kind: "scientific-spectra", version: 1,
      source: { name: "explicit.cis-el.dipole-length.1.mcd", format: "orca-mcd", scope: "frame", frameIndex: 5, frameCount: 7 },
      atomicNumbers: [...owner.atomicNumbers], spectra: [blocks[1].spectrum] } };
  return { owner, pair, input, blocks };
}

test("an explicit source block keeps signed MCD/absorption values and its independent source-frame identity", () => {
  const { owner, pair, input, blocks } = fixture(), original = structuredClone(pair);
  expect(checkMcdCompanion(pair, owner)).toBe(pair);
  expect(pair.spectra.spectra[0]).toBe(blocks[1].spectrum);
  expect(pair).toEqual(original);
  expect(input.slice(blocks[1].start, blocks[1].end)).toBe("9000 3.4 1.25\r\n10002 -4.2 1.5");
  expect(scientificSpectrumCsv(pair.spectra, "mcd")).toContain("9000,3.4,1.25\n10002,-4.2,1.5\n");
});

test("same atoms or primary bytes do not authorize another revision, companion, or source frame", () => {
  const { owner, pair } = fixture();
  for (const key of ["primaryOriginalSha256", "companionOriginalSha256", "sourceRevisionSha256"] as const) {
    expect(() => checkMcdCompanion(pair, { ...owner, [key]: "d".repeat(64) })).toThrow(key);
  }
  expect(() => checkMcdCompanion(pair, { ...owner, frameIndex: 4 })).toThrow("exact scientific frame");
  expect(() => checkMcdCompanion(pair, { ...owner, frameCount: 8 })).toThrow("exact scientific frame");
  expect(() => checkMcdCompanion(pair, { ...owner, atomicNumbers: [8, 6, 1, 1] })).toThrow("atom order");
  expect(() => checkMcdCompanion(pair, { ...owner, atomicNumbers: [6, 8, 1] })).toThrow("atom order");
});

test("malformed pairing identities, unknown fields and unbound/invalid frame owners reject without mutation", () => {
  const { owner, pair } = fixture();
  for (const value of ["A".repeat(64), "a".repeat(63), "a".repeat(65), " a".repeat(32), null]) {
    expect(() => checkMcdCompanion({ ...pair, sourceRevisionSha256: value }, owner)).toThrow();
  }
  expect(() => checkMcdCompanion({ ...pair, inferredSibling: true }, owner)).toThrow("unknown");
  for (const frame of [{ frameIndex: -1 }, { frameIndex: Infinity }, { frameIndex: 7 }, { frameCount: 0 }, { frameCount: 7.5 }, { atomicNumbers: [] }]) {
    expect(() => checkMcdCompanion(pair, { ...owner, ...frame })).toThrow("source frame owner");
  }
  const before = structuredClone(pair);
  Object.freeze(pair); Object.freeze(pair.spectra); Object.freeze(pair.spectra.atomicNumbers);
  Object.freeze(pair.spectra.spectra); Object.freeze(pair.spectra.spectra[0]);
  expect(checkMcdCompanion(pair, owner)).toBe(pair);
  expect(pair).toEqual(before);
});

test("native companion projection never discards absorption or invents units, labels, or another spectrum", () => {
  const { owner, pair } = fixture();
  const modify = (change: (data: ScientificMcdCompanion) => void) => { const copy = structuredClone(pair); change(copy); return copy; };
  const signal = pair.spectra.spectra[0];
  if (signal.kind !== "mcd") throw new Error("Authored fixture must be MCD");
  for (const changed of [
    modify(data => { data.spectra.source.format = "orca-output"; }),
    modify(data => { data.spectra.source = { name: "file", format: "orca-mcd", scope: "file" }; }),
    modify(data => { data.spectra.spectra = [{ ...signal, auxiliary: [] }]; }),
    modify(data => { data.spectra.spectra = [{ ...signal, valueUnit: "invented" }]; }),
    modify(data => { data.spectra.spectra = [{ ...signal, sourceRowIds: ["1", "2"] }]; }),
    modify(data => { data.spectra.spectra = [{ ...signal, auxiliary: [{ name: "other", unit: null, values: [1, 2] }] }]; }),
    modify(data => { data.spectra.spectra = [{ ...signal, positions: [10002, 9000] }]; }),
    modify(data => { data.spectra.source.name = "x".repeat(1025); }),
  ]) expect(() => checkMcdCompanion(changed, owner)).toThrow();
  const csv = scientificSpectrumCsv(pair.spectra, "mcd");
  expect(csv).toContain("source unit unspecified");
  expect(pair.spectra.spectra[0]).toBe(signal);
});
