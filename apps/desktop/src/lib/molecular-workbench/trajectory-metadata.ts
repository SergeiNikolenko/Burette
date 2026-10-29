import { atomicNumber } from './elements';
import type { ScientificFrame } from './scientific-types';
import type { Vec3 } from './types';

const NUMBER = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[EeDd][+-]?\\d+)?';
const numeric = (text: string) => {
  if (!new RegExp(`^${NUMBER}$`).test(text)) throw new Error('Invalid trajectory number.');
  const value = Number(text.replace(/[Dd]/, 'e'));
  if (!Number.isFinite(value)) throw new Error('Non-finite trajectory value.');
  return value;
};
// Read only whole key/value tokens, never keys mentioned inside a quoted description.
// ExtXYZ permits space/tab around '=' and backslash escapes inside quoted strings.
function attribute(comment: string, names: readonly string[]) {
  let cursor = 0;
  const token = /"((?:\\.|[^"\\])*)"|([^ \t="]+)/y;
  const skip = () => { while (/[ \t]/.test(comment[cursor] ?? '')) cursor++; };
  const read = () => {
    skip(); token.lastIndex = cursor;
    const match = token.exec(comment);
    if (!match) { cursor = comment[cursor] === '"' ? comment.length : cursor + 1; return null; }
    cursor = token.lastIndex;
    return { value: match[1] === undefined ? match[2] : match[1].replace(/\\(.)/g, (_, char: string) => char === 'n' ? '\n' : char), quoted: match[1] !== undefined };
  };
  while (cursor < comment.length) {
    const key = read(); if (!key) continue;
    skip(); if (comment[cursor] !== '=') continue;
    cursor++; const value = read();
    if (!names.includes(key.value.toLowerCase())) continue;
    if (!value) throw new Error('Invalid trajectory attribute value.');
    return { value: value.value, suffix: value.quoted ? '' : comment.slice(cursor) };
  }
  return undefined;
}
function quantity(comment: string, name: string, units: Record<string, number>) {
  const attributeValue = attribute(comment, name.toLowerCase().split('|'));
  if (!attributeValue) return undefined;
  const match = (attributeValue.value + attributeValue.suffix).match(new RegExp(`^(${NUMBER})[ \\t]*([^"\\s]+)(?=[ \\t]|$)`));
  if (!match) return undefined;
  const factor = units[match[2].toLowerCase()];
  if (factor === undefined) return undefined;
  const result = numeric(match[1]) * factor;
  if (!Number.isFinite(result)) throw new Error('Trajectory quantity exceeds the numeric range.');
  return result;
}
export function trajectoryMetadata(comment: string): Pick<ScientificFrame, 'energyHartree' | 'timePs' | 'temperatureKelvin'> {
  const energyHartree = quantity(comment, 'energy|E', { eh: 1, ha: 1, hartree: 1, ev: 1 / 27.211386245988, 'kcal/mol': 1 / 627.5094740631, 'kj/mol': 1 / 2625.4996394799 });
  const timePs = quantity(comment, 'time', { ps: 1, fs: .001, ns: 1000 });
  const temperatureKelvin = quantity(comment, 'temperature|temp', { k: 1 });
  if (temperatureKelvin !== undefined && temperatureKelvin < 0) throw new Error('Trajectory temperature cannot be negative.');
  return { ...(energyHartree === undefined ? {} : { energyHartree }), ...(timePs === undefined ? {} : { timePs }), ...(temperatureKelvin === undefined ? {} : { temperatureKelvin }) };
}

/** Extended XYZ column declarations are explicit. Vector units are required;
 * positions alone never imply velocity, kinetic energy, or temperature. */
export function parseExtendedFrame(comment: string, rows: string[]): ScientificFrame | null {
  const declaration = attribute(comment, ['properties'])?.value;
  if (!declaration) return null;
  const parts = declaration.split(':'), columns = new Map<string, { offset: number; count: number; type: string }>();
  if (parts.length % 3) throw new Error('Invalid extended XYZ property declaration.');
  let width = 0;
  for (let i = 0; i < parts.length; i += 3) {
    const name = parts[i].toLowerCase(), type = parts[i + 1], count = Number(parts[i + 2]);
    if (!name || columns.has(name) || !['S', 'R', 'I', 'L'].includes(type) || !Number.isInteger(count) || count < 1 || count > 64) throw new Error('Invalid extended XYZ property columns.');
    columns.set(name, { offset: width, count, type }); width += count;
    if (width > 256) throw new Error('Too many extended XYZ columns.');
  }
  const species = columns.get('species'), pos = columns.get('pos');
  if (species?.count !== 1 || species.type !== 'S' || pos?.count !== 3 || pos.type !== 'R') throw new Error('Extended XYZ requires species:S:1 and pos:R:3.');
  const tokens = rows.map(row => { const values = row.trim().split(/\s+/); if (values.length !== width) throw new Error('Extended XYZ row does not match its property declaration.'); return values; });
  const vector = (values: string[], offset: number, scale = 1): Vec3 => values.slice(offset, offset + 3).map(n => {
    const result = numeric(n) * scale;
    if (!Number.isFinite(result)) throw new Error('Trajectory vector exceeds the numeric range.');
    return result;
  }) as Vec3;
  const atoms = tokens.map(values => {
    const element = values[species.offset]; atomicNumber(element);
    const [x, y, z] = vector(values, pos.offset);
    if ([x, y, z].some(v => Math.abs(v) > 1e6)) throw new Error('Trajectory coordinates exceed the supported range.');
    return { element, x, y, z };
  });
  const result: ScientificFrame = { atoms, comment, ...trajectoryMetadata(comment) };
  for (const [names, unitName, factors, property] of [
    [['vel', 'velo', 'velocity', 'velocities'], 'velocity_unit', { 'angstrom/ps': 1, 'a/ps': 1, 'angstrom/fs': 1000, 'a/fs': 1000 }, 'velocitiesAngstromPerPs'],
    [['force', 'forces'], 'force_unit', { 'kcal/mol/angstrom': 1, 'kj/mol/angstrom': 1 / 4.184, 'ev/angstrom': 23.0605478306, 'hartree/bohr': 1185.82104664 }, 'forcesKcalMolAngstrom'],
  ] as const) {
    const col = names.map(name => columns.get(name)).find(Boolean);
    if (!col) continue;
    if (col.count !== 3 || col.type !== 'R') throw new Error('Trajectory vector fields must contain three real values.');
    const unit = attribute(comment, [unitName])?.value.toLowerCase();
    const factor = unit ? (factors as Record<string, number>)[unit] : undefined;
    if (factor === undefined) throw new Error(`Declare a supported ${unitName} for trajectory vectors.`);
    result[property] = tokens.map(values => vector(values, col.offset, factor));
  }
  return result;
}
