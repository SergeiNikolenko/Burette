import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { validateScientificDocument } from "../apps/desktop/src/lib/science-session/scientific-document";
import { readXyzFrames } from "../apps/desktop/src/lib/science-session/source-frames";

const read = (path: string) => parseScientificFile(path.split("/").pop()!, readFileSync(new URL(path, import.meta.url), "utf8"));

// Every value is copied from the output's banner, input echo, SCF setup and closing lines.
test("an ORCA output describes its program, keywords, basis, charge, multiplicity, termination and run time", () => {
  expect(read("fixtures/quantum/orca-log/cclib-orca6-dvb_ir.out").metadata).toEqual({ program: "ORCA 6.0.1", keywords: "b3lyp sto-3g usesym freq",
    basis: "STO-3G", charge: 0, multiplicity: 1, termination: "normal", runSeconds: 50.462 });
  expect(read("fixtures/quantum/orca-log/cclib-orca5-dvb_ir.out").metadata).toMatchObject({ program: "ORCA 5.0.1", keywords: "rks b3lyp sto-3g usesym freq", runSeconds: 138.241 });
});

test("a session document keeps a calculation description and refuses a malformed one", () => {
  const document = read("fixtures/quantum/orca-log/cclib-orca6-dvb_ir.out");
  const scene = readXyzFrames(`${document.atoms.length}\n\n${document.atoms.map((atom) => `${atom.element} ${atom.x} ${atom.y} ${atom.z}`).join("\n")}\n`);
  expect(validateScientificDocument(document, scene).metadata).toEqual(document.metadata);
  for (const metadata of [{ termination: "crashed" }, { charge: 0.5 }, { multiplicity: 0 }, { program: "" }, { solvent: "water" }]) {
    expect(() => validateScientificDocument({ ...document, metadata }, scene)).toThrow("calculation description");
  }
});

test("a QCSchema result describes its model, molecule and success, and keeps its SCF dipole in debye", () => {
  const result = read("fixtures/quantum/qcschema/hydroxyl-uhf-wavefunction.json");
  expect(result.metadata).toEqual({ termination: "normal", keywords: "hf", basis: "cc-pvdz", charge: 0, multiplicity: 2 });
  const source = JSON.parse(readFileSync(new URL("fixtures/quantum/qcschema/hydroxyl-uhf-wavefunction.json", import.meta.url), "utf8"));
  // e·bohr to debye.
  expect(result.frames[0].dipoleDebye).toEqual(source.properties.scf_dipole_moment.map((value: number) => value * 2.541746473));
  const optimization = read("fixtures/quantum/qcschema/water-optimization-trajectory-all.json");
  expect(optimization.metadata).toEqual({ termination: "normal", keywords: "hf", basis: "sto-3g", charge: 0, multiplicity: 1 });
  expect(read("fixtures/quantum/qcschema-water-gradient.json").metadata?.program).toBe("QM Program 1.1");
});

test("an xtb output describes its version, Hamiltonian and options, charge, unpaired electrons, termination and wall time", () => {
  expect(read("fixtures/quantum/xtb/water-opt.out").metadata).toEqual({ program: "xtb 6.7.1", keywords: "GFN2-xTB --opt -P 2", charge: 0, multiplicity: 1,
    termination: "normal", runSeconds: 0.053 });
  // The force field prints neither a Hamiltonian line nor charge and spin; its option names it.
  expect(read("fixtures/quantum/xtb/water-gfnff-opt.out").metadata).toEqual({ program: "xtb 6.7.1", keywords: "--gfnff --opt -P 2", termination: "normal", runSeconds: 0.029 });
});

test("Q-Chem, GAMESS and Molpro outputs describe their version, method, basis, charge, multiplicity, termination and time", () => {
  expect(read("fixtures/quantum/qchem/cclib-dvb_sp_un.out").metadata).toEqual({ program: "Q-Chem 5.4.1", keywords: "b3lyp", basis: "sto-3g",
    charge: 1, multiplicity: 2, termination: "normal", runSeconds: 5.07 });
  expect(read("fixtures/quantum/qchem/cclib-dvb_gopt.out").metadata?.keywords).toBe("b3lyp opt");
  expect(read("fixtures/quantum/gamess/cclib-dvb_un_sp.out").metadata).toEqual({ program: "GAMESS 30 SEP 2018 (R3)", keywords: "SCFTYP=UHF RUNTYP=ENERGY DFTTYP=B3LYP",
    basis: "STO-3G", charge: 1, multiplicity: 2, termination: "normal", runSeconds: 12.8 });
  // GAMESS prints its basis as a family, Gaussian count and polarization counts.
  expect(read("fixtures/quantum/gamess/cclib-water_ccsd.out").metadata).toMatchObject({ keywords: "SCFTYP=RHF RUNTYP=ENERGY CCTYP=CCSD", basis: "6-31G(d,p)" });
  expect(read("fixtures/quantum/gamess/cclib-dvb_td.out").metadata?.basis).toBe("3-21G(d)");
  expect(read("fixtures/quantum/gamess/cclib-C_bigbasis-trimmed.out").metadata?.basis).toBe("aug-cc-pCVQZ");
  // A semiempirical Hamiltonian is a method, so it has no basis.
  const semiempirical = read("fixtures/quantum/gamess/cclib-nh3_ts_ir.out").metadata!;
  expect([semiempirical.keywords, semiempirical.basis]).toEqual(["SCFTYP=RHF RUNTYP=HESSIAN GBASIS=AM1", undefined]);
  // Molpro's charge is the nuclear charge less the SCF's electrons.
  expect(read("fixtures/quantum/molpro/cclib-2018-dvb_sphf_un.out").metadata).toEqual({ program: "Molpro 2018.2", keywords: "UHF-SCF", basis: "STO-3G",
    charge: 1, multiplicity: 2, termination: "normal", runSeconds: 1.11 });
  expect(read("fixtures/quantum/molpro/cclib-dvb_ir.out").metadata).toMatchObject({ program: "Molpro 2012.1", keywords: "RKS-SCF HESSIAN", termination: "normal" });
});

test("a Gaussian log describes its revision, route, basis, charge, multiplicity, termination and elapsed time", () => {
  expect(read("fixtures/quantum/gaussian/cclib-dvb_un_sp.log").metadata).toEqual({ program: "Gaussian 16 Rev. A.03", keywords: "#p ub3lyp/sto-3g pop=full iop(3/33=1,3/36=-1) nosym",
    basis: "STO-3G", charge: 1, multiplicity: 2, termination: "normal", runSeconds: 8.9 });
  // Gaussian wraps the route at 70 columns, inside "iop(3/33=1,3/36=-1)" here.
  expect(read("fixtures/quantum/gaussian/cclib-dvb_sp.out").metadata?.keywords).toBe("#p b3lyp/sto-3g guess=read geom=allcheck pop=full gfinput iop(3/33=1,3/36=-1)");
});

test("Psi4 and NWChem outputs describe their version, method, basis, charge, multiplicity, termination and wall time", () => {
  expect(read("fixtures/quantum/psi4/cclib-water-mp2.out").metadata).toEqual({ program: "Psi4 1.7", keywords: "energy('mp2')", basis: "STO-3G",
    charge: 0, multiplicity: 1, termination: "normal", runSeconds: 0.42 });
  // A Python API run echoes no input and ends without the exit line; a failed SCF raises.
  expect(read("fixtures/quantum/psi4/oh-uhf.out").metadata).toEqual({ program: "Psi4 1.11", basis: "6-31G*", charge: 0, multiplicity: 2 });
  expect(read("fixtures/quantum/psi4/water-scf-fail.out").metadata?.termination).toBe("error");
  expect(read("fixtures/quantum/nwchem/oh-uhf.out").metadata).toEqual({ program: "NWChem 7.3.0", keywords: "UHF", basis: "6-31g*",
    charge: 0, multiplicity: 2, termination: "normal", runSeconds: 0.2 });
  expect(read("fixtures/quantum/nwchem/cclib-dvb_gopt_ks.out").metadata).toMatchObject({ keywords: "B3LYP", basis: "sto-3g", multiplicity: 1, runSeconds: 9.9 });
  expect(read("fixtures/quantum/nwchem/cclib-water-mp2.out").metadata?.keywords).toBe("RHF MP2");
  // NWChem prints the failing input line instead of its timing summary.
  const failed = read("fixtures/quantum/nwchem/water-scf-fail.out").metadata!;
  expect([failed.termination, failed.runSeconds]).toEqual(["error", undefined]);
});
