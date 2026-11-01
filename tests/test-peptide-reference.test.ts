// Independent acceptance of built peptides. tests/fixtures/peptide/reference-results.json
// holds gemmi, Biopython, RDKit, MDAnalysis and DSSP measurements of the exact bytes the
// builder and Mol* re-export write, compared with the wwPDB CCD and published geometry.
// When the builder output changes, regenerate it with tests/fixtures/peptide/README.md.
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { referenceCases, referenceCaseTexts } from "./fixtures/peptide/write-reference-cases";
import reference from "./fixtures/peptide/reference-results.json";

type Span = [number, number];
type Measured = {
  sha256: string; chain: string; residues: string[]; formula: string; ccd_formula: string; charge: number; ccd_charge: number;
  cip: Record<string, string>; ccd_stereo: Record<string, string>; names_not_in_ccd: string[]; order_differs_from_ccd: string[];
  bond_max_dev: [number, string]; angle_max_dev: [number, string];
  peptide_link: Record<"C-N" | "CA-C-N" | "C-N-CA" | "O-C-N" | "N_angle_sum", Span | null>; amide_h_out_of_plane_max: number | null; terminal_n_angles: Span;
  perceived_extra: string[]; perceived_missing: string[]; heavy_worst_overlap: number; heavy_clashes: string[];
  phi_psi: (number | null)[][]; omega: number[]; helanal?: { residues_per_turn: number; rise: number }; dssp: string;
  reexport?: { atoms_equal: boolean; bonds_equal: boolean; max_coordinate_delta: number };
};
const measured = reference.cases as unknown as Record<string, Measured>;
const cases = referenceCases.map(item => ({ ...item, result: measured[item.id] }));
const turn = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

test("every measurement belongs to the current builder and Mol* re-export bytes", async () => {
  const texts = await referenceCaseTexts();
  expect(Object.fromEntries([...texts].map(([id, text]) => [id, createHash("sha256").update(text).digest("hex")])))
    .toEqual(Object.fromEntries(Object.entries(measured).map(([id, result]) => [id, result.sha256])));
});

test("Biopython phi/psi and gemmi omega equal the request; Pro phi follows its planar ring", () => {
  for (const { id, options, result } of cases) {
    const { phi = 180, psi = 180 } = options, mirror = options.chirality === "D" ? -1 : 1;
    result.phi_psi.forEach(([measuredPhi, measuredPsi], i) => {
      expect([i === 0, i === result.phi_psi.length - 1]).toEqual([measuredPhi === null, measuredPsi === null]);
      // MacArthur & Thornton (1991) observe Pro phi −65 ± 15°.
      if (measuredPhi !== null) expect(/^(PRO|DPR)$/.test(result.residues[i]) ? Math.abs(mirror * measuredPhi + 65) <= 15 : turn(measuredPhi, phi) < 2e-3, `${id} phi ${i + 1}`).toBe(true);
      if (measuredPsi !== null) expect(turn(measuredPsi, psi), `${id} psi ${i + 1}`).toBeLessThan(2e-3);
    });
    for (const omega of result.omega) expect(turn(omega, 180)).toBeLessThan(2e-3);
    if (result.omega.length) {
      expect(result.peptide_link.N_angle_sum![0]).toBeGreaterThan(359.99);
      expect(result.amide_h_out_of_plane_max ?? 0).toBeLessThan(1e-3);
    }
  }
});

test("HELANAL helix parameters and DSSP classes match the published conformations", () => {
  // Residues per turn and rise (Å) of the α, 3₁₀, π, polyproline II and β (mean of parallel
  // 3.2 and antiparallel 3.4) conformations: IUPAC-IUB 1970, Biochemistry 9, 3471, Table 1.
  // Alpha and pi tolerances cover the documented gap between Avogadro's preset angles
  // and those idealized helices.
  const literature: Record<string, { n: number; rise: number; tolerance: [number, number]; dssp: string }> = {
    alpha: { n: 3.6, rise: 1.5, tolerance: [0.15, 0.1], dssp: "H" }, helix310: { n: 3.0, rise: 2.0, tolerance: [0.1, 0.1], dssp: "G" },
    pi: { n: 4.4, rise: 1.15, tolerance: [0.25, 0.2], dssp: "I" }, custom: { n: 3.0, rise: 3.1, tolerance: [0.1, 0.1], dssp: "P" },
    beta: { n: 2.0, rise: 3.3, tolerance: [0.1, 0.15], dssp: "-" },
  };
  for (const { id, preset, sequence, options, result } of cases) {
    if (!preset) continue;
    // DSSP's polyproline class is a left-handed phi/psi window, so its mirror image is unassigned.
    const expected = literature[preset], letter = expected?.dssp === "P" && options.chirality === "D" ? "-" : expected?.dssp ?? "-";
    expect(result.dssp.slice(1, -1), id).toBe(letter.repeat(sequence.length - 2));
    if (!expected || !/^A+$/.test(sequence)) continue;
    expect(Math.abs(result.helanal!.residues_per_turn - expected.n), id).toBeLessThanOrEqual(expected.tolerance[0]);
    expect(Math.abs(result.helanal!.rise - expected.rise), id).toBeLessThanOrEqual(expected.tolerance[1]);
  }
});

test("RDKit CIP, formula and charge equal the CCD; atom names and rows follow the CCD", () => {
  for (const [id, result] of Object.entries(measured)) {
    expect(result.cip, id).toEqual(result.ccd_stereo);
    expect([result.formula, result.charge], id).toEqual([result.ccd_formula, result.ccd_charge]);
    expect([result.names_not_in_ccd, result.order_differs_from_ccd], id).toEqual([[], []]);
  }
  expect(measured["mixed-AITC"].residues).toEqual(["ALA", "DIL", "THR", "DCY"]);
  expect(measured["mixed-AITC"].chain).toBe("Z");
});

test("residue geometry equals CCD ideal values; peptide links follow Engh & Huber", () => {
  for (const [id, result] of Object.entries(measured)) {
    // Mol* re-export rounds coordinates to 0.001 Å.
    const exported = id.endsWith(".molstar");
    expect(result.bond_max_dev[0], id).toBeLessThan(exported ? 0.0015 : 0.001);
    expect(result.angle_max_dev[0], id).toBeLessThan(0.1);
    // Engh & Huber (1991), Acta Cryst. A47, 392: C–N 1.329 Å, CA–C–N 116.2°, C–N–CA 121.7°.
    for (const [key, value, tolerance] of [["C-N", 1.329, 0.001], ["CA-C-N", 116.2, 0.1], ["C-N-CA", 121.7, 0.1]] as const)
      for (const bound of result.peptide_link[key] ?? []) expect(Math.abs(bound - value), `${id} ${key}`).toBeLessThan(tolerance);
    expect(result.terminal_n_angles[0]).toBeGreaterThan(106.5);
    expect(result.terminal_n_angles[1]).toBeLessThan(112.5);
  }
});

test("coordinates alone imply the declared bonds; side chains avoid heavy-atom clashes", () => {
  for (const [id, result] of Object.entries(measured)) expect([result.perceived_extra, result.perceived_missing], id).toEqual([[], []]);
  for (const { id, preset, sequence, result } of cases) {
    if (preset === "pi") continue;
    if (/^A+$/.test(sequence)) expect(result.heavy_clashes, id).toEqual([]);
    // Pro inside a helix and the π helix itself clash by construction (docs/peptide-geometry.md).
    else if (!sequence.slice(1, -1).includes("P")) expect(result.heavy_worst_overlap, id).toBeLessThanOrEqual(0.7);
  }
});

test("Mol* full-structure re-export reopens with identical atoms, charges and bonds", () => {
  for (const id of ["alpha-side2-L.molstar", "mixed-AITC.molstar"]) {
    const { reexport } = measured[id];
    expect(reexport && { ...reexport, max_coordinate_delta: reexport.max_coordinate_delta <= 0.0005 }).toEqual({ atoms_equal: true, bonds_equal: true, max_coordinate_delta: true });
  }
});
