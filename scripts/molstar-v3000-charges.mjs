import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// Injected into the version-locked reader, with its own Column/Tokenizer imports.
// Read logical V30 records: upstream's physical-line loop misreads continued atom
// properties as the next atom. The source string and SDF data items stay untouched.
function readV3000Atoms(tokenizer, atomCount, Column, Tokenizer, parseCoordinate) {
  // Each valid atom needs more than 16 source characters. Reject impossible
  // declared counts before allocating the per-atom arrays (Mol* indices are int32).
  if (!Number.isSafeInteger(atomCount) || atomCount < 0 || atomCount > 2_147_483_647 || atomCount > (tokenizer.length - tokenizer.position) / 16) {
    throw new Error('Invalid or truncated V3000 atom count.');
  }
  function record() {
    let value = '';
    for (let lines = 0; lines < 256; lines++) {
      if (tokenizer.position >= tokenizer.length) throw new Error('Unexpected end of V3000 atom block.');
      const line = Tokenizer.readLine(tokenizer);
      const prefix = /^[ \t]*M[ \t]+V30(?:[ \t]|$)/u.exec(line);
      if (!prefix) throw new Error('Invalid V3000 atom record prefix.');
      const part = line.slice(prefix[0].length).trimEnd();
      const continued = part.endsWith('-');
      value += continued ? part.slice(0, -1) : part;
      if (value.length > 65_536) throw new Error('V3000 atom record exceeds 65,536 characters.');
      if (!continued) return value.trim();
    }
    throw new Error('V3000 atom record exceeds 256 continuation lines.');
  }
  // Keep quoted strings and list-valued properties together, so e.g.
  // LABEL="CHG=2" cannot become an atom charge. V30 quotes escape by doubling.
  function fields(value) {
    const result = [];
    let start = 0, depth = 0, quoted = false;
    for (let i = 0; i <= value.length; i++) {
      const c = value[i];
      if (c === '"') {
        if (quoted && value[i + 1] === '"') { i++; continue; }
        quoted = !quoted;
      } else if (!quoted) {
        if (c === '(') depth++;
        else if (c === ')' && --depth < 0) throw new Error('Unbalanced V3000 atom property list.');
      }
      if (i === value.length || (!quoted && depth === 0 && /[ \t]/u.test(c))) {
        if (i > start) result.push(value.slice(start, i));
        start = i + 1;
      }
    }
    if (quoted || depth !== 0) throw new Error('Unterminated V3000 atom property.');
    return result;
  }
  if (record() !== 'BEGIN ATOM') throw new Error('Missing V3000 BEGIN ATOM.');
  function coordinate(value) {
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value) || !Number.isFinite(Number(value))) {
      throw new Error('Invalid V3000 atom coordinates.');
    }
    return parseCoordinate(value, 0, value.length) || 0;
  }
  const x = new Float32Array(atomCount), y = new Float32Array(atomCount), z = new Float32Array(atomCount);
  const symbols = [], ids = new Set(), indices = new Int32Array(atomCount), charges = new Int32Array(atomCount);
  for (let row = 0; row < atomCount; row++) {
    const values = fields(record());
    const id = Number(values[0]);
    if (values.length < 6 || !/^[1-9]\d*$/u.test(values[0]) || !Number.isSafeInteger(id) || ids.has(id)) {
      throw new Error('Invalid or duplicate V3000 atom index.');
    }
    ids.add(id);
    symbols.push(values[1]);
    x[row] = coordinate(values[2]); y[row] = coordinate(values[3]); z[row] = coordinate(values[4]);
    if (![x[row], y[row], z[row]].every(Number.isFinite)) throw new Error('Invalid V3000 atom coordinates.');
    if (!/^\d+$/u.test(values[5]) || !Number.isSafeInteger(Number(values[5]))) throw new Error('Invalid V3000 atom mapping.');
    indices[row] = row + 1;
    let hasCharge = false;
    for (const property of values.slice(6)) {
      if (!/^CHG(?:=|$)/iu.test(property)) continue;
      const match = /^CHG=([+-]?\d+)$/u.exec(property);
      const charge = match ? Number(match[1]) : NaN;
      // Mol* stores direct formal charges in Int32Array. Reject overflow and
      // ambiguous duplicate values instead of displaying a neutral/wrapped atom.
      if (!match || hasCharge || !Number.isInteger(charge) || charge < -2_147_483_648 || charge > 2_147_483_647) {
        throw new Error('Invalid or duplicate V3000 CHG value.');
      }
      charges[row] = charge;
      hasCharge = true;
    }
  }
  if (record() !== 'END ATOM') throw new Error('Missing V3000 END ATOM.');
  return {
    count: atomCount,
    x: Column.ofFloatArray(x), y: Column.ofFloatArray(y), z: Column.ofFloatArray(z),
    type_symbol: Column.ofStringArray(symbols),
    formal_charge: Column.ofConst(0, atomCount, Column.Schema.int),
    // getMolModels treats this table as actual charges; atoms.formal_charge
    // alone would be reinterpreted through the unrelated V2000 charge codes.
    formalCharges: { atomIdx: Column.ofIntArray(indices), charge: Column.ofIntArray(charges) },
  };
}

export function patchMolstarV3000Atoms(source) {
  const start = 'export function handleAtomsV3(tokenizer, atomCount) {';
  const end = 'export function handleBondsV3(tokenizer, bondCount) {';
  if (source.split(start).length !== 2 || source.split(end).length !== 2 || source.includes('function readV3000Atoms(')) {
    throw new Error('Mol* V3000 atom reader changed; review before vendoring.');
  }
  const first = source.indexOf(start), last = source.indexOf(end);
  if (last <= first || !source.slice(first, last).includes('formal_charge: Column.ofConst(0, atomCount, Column.Schema.int)')) {
    throw new Error('Mol* V3000 atom reader changed; review before vendoring.');
  }
  return `import { parseFloat as parseV3000Coordinate } from '../common/text/number-parser.js';\n${source.slice(0, first)}${start}\n    return (${readV3000Atoms.toString()})(tokenizer, atomCount, Column, Tokenizer, parseV3000Coordinate);\n}\n${source.slice(last)}`;
}

export function patchMolstarV3000Charges(source) {
  const neutral = `    /* No support for formal charge parsing in V3000 molfiles at the moment,
    so all charges default to 0.*/
    const nullFormalCharges = {
        atomIdx: Column.ofConst(0, atomCount, Column.Schema.int),
        charge: Column.ofConst(0, atomCount, Column.Schema.int)
    };
`;
  const properties = 'const properties = molIsV3 ? { formalCharges: nullFormalCharges } : handlePropertiesBlock(tokenizer);';
  if (source.split(neutral).length !== 2 || source.split(properties).length !== 2) throw new Error('Mol* V3000 charge reader changed; review before vendoring.');
  return source.replace(neutral, '').replace(properties, 'const properties = molIsV3 ? { formalCharges: atoms.formalCharges } : handlePropertiesBlock(tokenizer);');
}

export const molstarV3000ChargesPlugin = {
  name: 'molstar-v3000-formal-charges',
  setup(build) {
    build.onLoad({ filter: /molstar\/lib\/mol-io\/reader\/sdf\/parser(?:-v3-util)?\.js$/u }, async ({ path }) => {
      const { version } = JSON.parse(await readFile(resolve(dirname(path), '../../../../package.json'), 'utf8'));
      if (version !== '5.11.0') throw new Error('Review the Mol* V3000 charge adapter before upgrading from 5.11.0.');
      const source = await readFile(path, 'utf8');
      return { contents: path.endsWith('/parser-v3-util.js') ? patchMolstarV3000Atoms(source) : patchMolstarV3000Charges(source), loader: 'js' };
    });
  },
};
