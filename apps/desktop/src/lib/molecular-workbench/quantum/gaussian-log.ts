import { elementSymbol } from '../elements';
import type { MolecularAtom, Vec3 } from '../types';
import type { ScientificDocument, ScientificFrame, VibrationalMode } from '../scientific-types';
import { checkIdentity, coordinate, MAX_ATOMS, MAX_FRAMES, MAX_VALUES, numeric } from './reader-values';

const ORIENTATION = /^\s*(Standard|Input|Z-Matrix) orientation:\s*$/;
const DASH = /^\s*-{5,}\s*$/;
/** Gaussian's printed orientation is in angstrom; SCF Done energies are in Hartree.
 * Normal coordinate tables are relative Cartesian displacements, in printed atom order.
 * https://gaussian.com/vib/ and https://gaussian.com/faq1/ (optimization output).
 */
export function parseGaussianLog(text: string): ScientificDocument {
  const lines = text.replace(/\r/g, '').split('\n');
  const frames: ScientificFrame[] = [];
  let previousOrientation: string | undefined;
  let modeValues = 0;
  let converged: boolean | undefined;
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].match(ORIENTATION);
    if (heading) {
      if (!DASH.test(lines[++i] ?? '') || !/Center\s+Atomic\s+Atomic\s+Coordinates \(Angstroms\)/.test(lines[++i] ?? '')
        || !/Number\s+Number\s+Type\s+X\s+Y\s+Z/.test(lines[++i] ?? '') || !DASH.test(lines[++i] ?? '')) {
        throw new Error('Malformed Gaussian orientation header.');
      }
      const atoms: MolecularAtom[] = [];
      while (++i < lines.length && !DASH.test(lines[i])) {
        const p = lines[i].trim().split(/\s+/);
        if (p.length !== 6 || p[0] !== String(atoms.length + 1) || !/^\d+$/.test(p[1]) || !/^-?\d+$/.test(p[2])) throw new Error('Malformed Gaussian orientation row.');
        atoms.push(coordinate(elementSymbol(Number(p[1])), p.slice(3).map(numeric)));
        if (atoms.length > MAX_ATOMS) throw new Error('Gaussian geometry exceeds atom limit.');
      }
      if (i >= lines.length || !atoms.length) throw new Error('Truncated Gaussian orientation.');
      if (frames.length) checkIdentity(atoms, frames[0].atoms);
      // A following Standard table replaces the uncomputed Input/Z-Matrix
      // orientation of this same step. Later jobs can use Input-only output.
      const previous = frames.at(-1);
      if (heading[1] === 'Standard' && previousOrientation !== 'Standard' && previous && previous.energyHartree === undefined && !previous.modes) previous.atoms = atoms;
      else frames.push({ atoms });
      previousOrientation = heading[1];
      if (frames.length > MAX_FRAMES || frames.length * atoms.length * 3 > MAX_VALUES) throw new Error('Gaussian trajectory exceeds browser limit.');
      continue;
    }
    const frame = frames.at(-1);
    if (/SCF Done:/.test(lines[i])) {
      const energy = lines[i].match(/SCF Done:\s+E\([^)]*\)\s*=\s*(\S+)\s+A\.U\./);
      if (!energy || !frame) throw new Error('Gaussian SCF energy has no valid associated geometry.');
      frame.energyHartree = numeric(energy[1]);
    }
    if (/Optimization completed\./.test(lines[i])) converged = true;
    if (/Optimization stopped\.|Convergence failure/.test(lines[i])) converged = false;
    if (/^\s*Frequencies\s+--/.test(lines[i])) {
      if (!frame) throw new Error('Gaussian frequencies have no associated geometry.');
      const frequencies = lines[i].split('--')[1].trim().split(/\s+/).map(numeric);
      if (!frequencies.length || frequencies.length > 3) throw new Error('Unsupported Gaussian frequency block.');
      const modes = frame.modes ??= [];
      const ordinals = lines[i - 2]?.trim().split(/\s+/);
      if (ordinals?.every(v => /^\d+$/.test(v)) && (ordinals.length !== frequencies.length || ordinals.some((v, j) => Number(v) !== modes.length + j + 1))) throw new Error('Duplicate or out-of-order Gaussian frequency indices.');
      const block: VibrationalMode[] = frequencies.map((frequencyCm1, j) => ({ index: modes.length + j, frequencyCm1 }));
      if (modes.length + block.length > 3 * frame.atoms.length) throw new Error('Gaussian mode count exceeds geometry dimensions.');
      const symmetry = lines[i - 1]?.trim().split(/\s+/);
      if (symmetry?.length === block.length && symmetry.every(s => /^[A-Za-z][A-Za-z0-9'"()]*$/.test(s))) block.forEach((m, j) => { m.symmetry = symmetry[j]; });
      const properties: Array<[RegExp, keyof VibrationalMode]> = [
        [/Red\. masses\s+--/, 'reducedMassAmu'], [/Frc consts\s+--/, 'forceConstantMdynAngstrom'],
        [/IR Inten\s+--/, 'intensityKmMol'], [/Raman Activ\s+--/, 'ramanActivityAngstrom4Amu'],
        [/Depolar \(P\)\s+--/, 'ramanDepolarizationRatio'], [/Depolar \(U\)\s+--/, 'ramanDepolarizationRatioUnpolarized'],
      ];
      const seen = new Set<string>();
      let rows = false;
      while (++i < lines.length) {
        if (/^\s*Atom\s+AN\s+(?:X\s+Y\s+Z\s*)+$/.test(lines[i])) { rows = true; break; }
        const property = properties.find(([pattern]) => pattern.test(lines[i]));
        if (property) {
          if (seen.has(property[1])) throw new Error('Duplicate Gaussian frequency property row.');
          seen.add(property[1]);
          const values = lines[i].split('--')[1].trim().split(/\s+/).map(numeric);
          if (values.length !== block.length || (property[1] !== 'forceConstantMdynAngstrom' && values.some(v => v < 0)) || (property[1].startsWith('ramanDepolarization') && values.some(v => v > 1))) throw new Error('Invalid Gaussian frequency property row.');
          block.forEach((mode, j) => { Object.assign(mode, { [property[1]]: values[j] }); });
        } else if (!/^\s*(?:Raman|Depolar|Red\.|Frc|IR|\s*$)/.test(lines[i])) break;
      }
      if (!rows) throw new Error('Truncated Gaussian normal-coordinate block.');
      modeValues += block.length * frame.atoms.length * 3;
      if (modeValues > MAX_VALUES) throw new Error('Gaussian normal modes exceed browser limit.');
      block.forEach(m => { m.displacements = []; });
      for (let a = 0; a < frame.atoms.length; a++) {
        const p = (lines[++i] ?? '').trim().split(/\s+/);
        if (p.length !== 2 + 3 * block.length || p[0] !== String(a + 1) || elementSymbol(Number(p[1])) !== frame.atoms[a].element) throw new Error('Truncated or mismatched Gaussian normal-coordinate row.');
        const vectors = p.slice(2).map(numeric);
        block.forEach((m, j) => { m.displacements!.push(vectors.slice(j * 3, j * 3 + 3) as Vec3); });
      }
      modes.push(...block);
    }
  }
  if (!frames.length) throw new Error('No supported Gaussian orientation was found.');
  return { format: 'gaussian-log', atoms: frames.at(-1)!.atoms, frames, modes: frames.at(-1)!.modes ?? [], orbitals: [], ...(converged === undefined ? {} : { converged }) };
}
