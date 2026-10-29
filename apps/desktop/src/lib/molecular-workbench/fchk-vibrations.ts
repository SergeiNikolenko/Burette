import type { Vec3 } from "./types";
import type { VibrationalMode } from "./scientific-types";

/**
 * Gaussian frequency results stored in a formatted checkpoint.
 *
 * `Vib-E2` holds blocks of one value per normal mode: frequency (cm⁻¹, negative when
 * imaginary), reduced mass (amu), force constant (mDyne/Å), IR intensity (km/mol), Raman
 * activity (Å⁴/amu), depolarization ratios for plane-polarized and for unpolarized incident
 * light, then blocks not read here. `Vib-Modes` holds the normalized Cartesian displacements
 * mode by mode, atom by atom, x y z. Gaussian numbers the modes from 1.
 *
 * Verified against the Gaussian 16 log of the same run (MolOP water_raman_hf_sto3g, MIT)
 * and the cclib (fchkparser.py) and Avogadro (gaussianfchk.cpp) readers. Gaussian fills
 * blocks it did not compute with zeros; the IR and Raman blocks are known only when the
 * dipole or polarizability derivatives they come from are in the file (or a value is
 * nonzero), so a genuinely zero intensity is kept while an uncomputed one stays unknown.
 */
export function fchkVibrations(data: ReadonlyMap<string, number[]>, present: ReadonlySet<string>, atomCount: number): VibrationalMode[] {
  const e2 = data.get("Vib-E2");
  if (!e2) {
    if (data.has("Vib-Modes")) throw new Error("FCHK normal modes have no frequencies.");
    return [];
  }
  const count = data.get("Number of Normal Modes")?.[0] ?? NaN;
  if (!Number.isInteger(count) || count < 1 || count > 3 * atomCount) throw new Error("Invalid FCHK normal-mode count.");
  const vibratingAtoms = data.get("Vib-NDim")?.[0];
  if (vibratingAtoms !== undefined && vibratingAtoms !== atomCount) throw new Error("FCHK vibrations of part of the molecule are not supported.");
  const blocks = e2.length / count;
  const stated = data.get("Vib-LE2Fix")?.[0];
  if (!Number.isInteger(blocks) || (stated !== undefined && stated !== blocks)) throw new Error("FCHK Vib-E2 length does not match its normal modes.");
  const block = (index: number) => (index < blocks ? e2.slice(index * count, (index + 1) * count) : undefined);
  const computed = (values: number[] | undefined, source: string) => (values && (present.has(source) || values.some((value) => value !== 0)) ? values : undefined);
  const reducedMasses = block(1);
  const forceConstants = block(2);
  const ir = computed(block(3), "Dipole Derivatives");
  const raman = computed(block(4), "Polarizability Derivatives");
  const plane = raman && block(5);
  const unpolarized = raman && block(6);
  if (reducedMasses?.some((mass) => mass <= 0)) throw new Error("FCHK reduced masses must be positive.");
  if (ir?.some((value) => value < 0) || raman?.some((value) => value < 0)) throw new Error("FCHK intensities must not be negative.");
  if ([...plane ?? [], ...unpolarized ?? []].some((ratio) => ratio < 0 || ratio > 1)) throw new Error("FCHK depolarization ratios must lie between 0 and 1.");
  const vectors = data.get("Vib-Modes");
  if (vectors && vectors.length !== count * 3 * atomCount) throw new Error("FCHK Vib-Modes length does not match the atoms and modes.");
  return block(0)!.map((frequencyCm1, mode) => ({
    index: mode + 1,
    frequencyCm1,
    ...(reducedMasses ? { reducedMassAmu: reducedMasses[mode] } : {}),
    ...(forceConstants ? { forceConstantMdynAngstrom: forceConstants[mode] } : {}),
    ...(ir ? { intensityKmMol: ir[mode] } : {}),
    ...(raman ? { ramanActivityAngstrom4Amu: raman[mode] } : {}),
    ...(plane ? { ramanDepolarizationRatio: plane[mode] } : {}),
    ...(unpolarized ? { ramanDepolarizationRatioUnpolarized: unpolarized[mode] } : {}),
    ...(vectors ? { displacements: Array.from({ length: atomCount }, (_, atom): Vec3 => {
      const offset = (mode * atomCount + atom) * 3;
      return [vectors[offset], vectors[offset + 1], vectors[offset + 2]];
    }) } : {}),
  }));
}
