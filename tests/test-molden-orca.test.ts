import { expect, test } from 'bun:test';
import { parseScientificFile } from '../apps/desktop/src/lib/molecular-workbench/quantum';
import { evaluateOrbital } from '../apps/desktop/src/lib/molecular-workbench/gaussian';
import type { Vec3 } from '../apps/desktop/src/lib/molecular-workbench/types';
import { expectSchema, fixtureText } from './quantum-output-fixture';

type Reference = { orthonormalityError: number; uncorrectedError: number; pointsAngstrom: Vec3[]; orbitals: Record<string, number[]> };
const reference: Record<string, Reference> = JSON.parse(fixtureText('molden/molden-reference.json'));

test('ORCA Molden orbitals, with f and g shells, match PySCF once ORCA\'s conventions are undone', () => {
  for (const [name, values] of Object.entries(reference)) {
    // As the Molden format reads them, ORCA's orbitals are not orthonormal; corrected, they are.
    expect(values.uncorrectedError).toBeGreaterThan(0.9);
    expect(values.orthonormalityError).toBeLessThan(1e-8);
    const document = parseScientificFile(name, fixtureText(`molden/${name}`));
    for (const [index, samples] of Object.entries(values.orbitals)) {
      values.pointsAngstrom.forEach((point, p) => expect(Math.abs(evaluateOrbital(document, Number(index), point) - samples[p])).toBeLessThanOrEqual(1e-8 * Math.max(1, Math.abs(samples[p]))));
    }
    expectSchema(document);
  }
  expect(parseScientificFile('g.molden', fixtureText('molden/orca-si3h4-trimmed.molden.input')).basis!.some(shell => shell.kind === 'g' && shell.spherical)).toBe(true);
});

test('only ORCA\'s own files get ORCA\'s corrections', () => {
  const text = fixtureText('molden/orca-si2h4.molden.input');
  const plain = parseScientificFile('other.molden', text.replace('created by orca_2mkl', 'written elsewhere'));
  const orca = parseScientificFile('orca.molden', text);
  expect(plain.basis![0].coefficients).toEqual(orca.basis![0].coefficients.map((_, p) => Number(text.split('\n')[14 + p].trim().split(/\s+/)[1])));
  expect(plain.basis![0].coefficients).not.toEqual(orca.basis![0].coefficients);
});
