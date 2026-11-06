/** What an external energy model receives at start-up: the total charge and spin
 * multiplicity, and for Avogadro packages the molecule in the format the model
 * declares, as Avogadro's ScriptEnergy::buildBootstrapInput writes it
 * (avogadro/qtplugins/forcefield/scriptenergy.cpp, revision
 * cb0e94852889da9f7288bd1e58241e69990935a7, BSD-3-Clause; see
 * docs/third-party/avogadro-LICENSE). Atoms keep the structure's order, the order
 * every later coordinate request follows. */
import { sdfFromGraph } from '../workbench/formats';
import { ELEMENT_SYMBOLS } from './energy-models';
import type { MolecularStructure } from './molecular-graph';
import type { MolecularBond } from './types';

export type ModelInputFormat = 'cjson' | 'cml' | 'mdl' | 'mol' | 'sdf' | 'xyz';
export const MODEL_INPUT_FORMATS: readonly string[] = ['cjson', 'cml', 'mdl', 'mol', 'sdf', 'xyz'];

/** Formal charges and Kekulé bonds in structure atom order, from the V3000 molfile
 * the structure carries; without one, no charges and the structure's own bonds. */
function graph(structure: MolecularStructure): { charges: number[]; bonds: MolecularBond[] } {
  const rows = structure.molfile.split('\n'), map = structure.atomMap ?? structure.atoms.map((_, i) => i);
  const atomBegin = rows.indexOf('M  V30 BEGIN ATOM'), atomEnd = rows.indexOf('M  V30 END ATOM');
  if (atomBegin < 0 || atomEnd - atomBegin - 1 !== structure.atoms.length) return { charges: structure.atoms.map(() => 0), bonds: structure.bonds };
  const fileCharges = rows.slice(atomBegin + 1, atomEnd).map(row => Number(/\bCHG=(-?\d+)/u.exec(row)?.[1] ?? 0));
  const atomOf = new Map(map.map((file, atom) => [file, atom]));
  const bondBegin = rows.indexOf('M  V30 BEGIN BOND'), bondEnd = rows.indexOf('M  V30 END BOND');
  const bonds = bondBegin < 0 ? [] : rows.slice(bondBegin + 1, bondEnd).flatMap(row => {
    const match = /^M {2}V30 \d+ ([1-4]) (\d+) (\d+)/u.exec(row), a = atomOf.get(Number(match?.[2]) - 1), b = atomOf.get(Number(match?.[3]) - 1);
    return match && a !== undefined && b !== undefined ? [{ a, b, order: match[1] === '4' ? 1.5 : Number(match[1]) }] : [];
  });
  return { charges: map.map(file => fileCharges[file]), bonds };
}

const atomicNumber = (element: string) => ELEMENT_SYMBOLS.indexOf(element) + 1;

/** Total formal charge, and the lowest multiplicity the electron count allows. */
export function chargeAndMultiplicity(structure: MolecularStructure) {
  const charge = graph(structure).charges.reduce((sum, value) => sum + value, 0);
  const electrons = structure.atoms.reduce((sum, atom) => sum + atomicNumber(atom.element), 0) - charge;
  return { charge, multiplicity: Math.abs(electrons) % 2 ? 2 : 1 };
}

const cmlOrder = (order: number) => order === 1.5 ? 'A' : String(order);

/** The one-line start-up JSON for an Avogadro energy model. */
export function modelBootstrap(structure: MolecularStructure, format: ModelInputFormat, charge: number, multiplicity: number): string {
  const { atoms, title } = structure, { charges, bonds } = graph(structure);
  let molecule: unknown;
  if (format === 'xyz') molecule = `${atoms.length}\n${title.replace(/[\r\n]/gu, ' ')}\n${atoms.map(a => `${a.element} ${a.x} ${a.y} ${a.z}`).join('\n')}\n`;
  // V2000 is the widest-read molfile; coordinate requests then carry full precision.
  else if (format === 'sdf' || format === 'mol' || format === 'mdl') molecule = sdfFromGraph(atoms, bonds, title, [], charges);
  else if (format === 'cml') {
    molecule = `<?xml version="1.0"?>\n<molecule xmlns="http://www.xml-cml.org/schema"><atomArray>${atoms.map((a, i) =>
      `<atom id="a${i + 1}" elementType="${a.element}" formalCharge="${charges[i]}" x3="${a.x}" y3="${a.y}" z3="${a.z}"/>`).join('')}</atomArray><bondArray>${bonds.map(b =>
      `<bond atomRefs2="a${b.a + 1} a${b.b + 1}" order="${cmlOrder(b.order)}"/>`).join('')}</bondArray></molecule>\n`;
  } else {
    molecule = {
      chemicalJson: 1,
      atoms: { elements: { number: atoms.map(a => atomicNumber(a.element)) }, coords: { '3d': atoms.flatMap(a => [a.x, a.y, a.z]) }, formalCharges: charges },
      bonds: { connections: { index: bonds.flatMap(b => [b.a, b.b]) }, order: bonds.map(b => b.order === 1.5 ? 1 : b.order) },
      properties: { totalCharge: charge, totalSpinMultiplicity: multiplicity },
    };
  }
  return JSON.stringify({ charge, spin: multiplicity, selectedAtoms: [], [format]: molecule, options: {} });
}
