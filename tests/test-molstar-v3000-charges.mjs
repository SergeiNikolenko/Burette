import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseSdf as upstreamParseSdf } from 'molstar/lib/mol-io/reader/sdf/parser.js';
import { trajectoryFromSdf } from 'molstar/lib/mol-model-formats/structure/sdf.js';
import { IndexPairBonds } from 'molstar/lib/mol-model-formats/structure/property/bonds/index-pair.js';
import { molstarV3000ChargesPlugin, patchMolstarV3000Atoms, patchMolstarV3000Charges } from '../scripts/molstar-v3000-charges.mjs';

// Use the actual build plugin's onLoad outputs without building or changing vendor assets.
const parserUrl = new URL('../node_modules/molstar/lib/mol-io/reader/sdf/parser.js', import.meta.url);
const atomsUrl = new URL('./parser-v3-util.js', parserUrl);
const handlers = [];
molstarV3000ChargesPlugin.setup({ onLoad(options, load) { handlers.push({ ...options, load }); } });
async function load(url) {
  const path = fileURLToPath(url), handler = handlers.find(item => item.filter.test(path));
  assert.ok(handler, 'the vendor build must intercept both SDF reader modules');
  return (await handler.load({ path })).contents;
}
const asModule = (source, base, atoms) => `data:text/javascript;base64,${Buffer.from(source.replace(/from '(\.[^']+)'/gu,
  (_, path) => `from '${path === './parser-v3-util.js' ? atoms : new URL(path, base)}'`)).toString('base64')}`;
const atomsModule = asModule(await load(atomsUrl), atomsUrl);
const { parseSdf } = await import(asModule(await load(parserUrl), parserUrl, atomsModule));
const originalParser = await readFile(parserUrl, 'utf8'), originalAtoms = await readFile(atomsUrl, 'utf8');
assert.throws(() => patchMolstarV3000Charges('changed upstream'), /reader changed/);
assert.throws(() => patchMolstarV3000Atoms('changed upstream'), /reader changed/);
assert.throws(() => patchMolstarV3000Charges(patchMolstarV3000Charges(originalParser)), /reader changed/);
assert.throws(() => patchMolstarV3000Atoms(patchMolstarV3000Atoms(originalAtoms)), /reader changed/);

function sdf(atoms = ['1 C 0 0 0 0 CHG=1', '2 O 1.2 0 0 0 CHG=-1'], newline = '\n') {
  return ['Charged V3000', 'Burette', '', '  0  0  0     0  0            999 V3000',
    'M  V30 BEGIN CTAB', `M  V30 COUNTS ${atoms.length} 1 0 0 0`, 'M  V30 BEGIN ATOM',
    ...atoms.map(atom => `M  V30 ${atom}`), 'M  V30 END ATOM', 'M  V30 BEGIN BOND', 'M  V30 1 2 1 2',
    'M  V30 END BOND', 'M  V30 END CTAB', 'M  END', '> <COMMENT>', 'CHG=99 is a foreign data value', '', '$$$$', ''].join(newline);
}
async function parsed(text, reader = parseSdf) {
  const result = await reader(text).run();
  assert.equal(result.isError, false);
  return result.result.compounds;
}
async function model(compound) {
  return (await trajectoryFromSdf(compound).run()).representative;
}
function snapshot(model) {
  return { elements: Array.from(model.atomicHierarchy.atoms.type_symbol.toArray()),
    charges: Array.from(model.atomicHierarchy.atoms.pdbx_formal_charge.toArray()),
    x: Array.from(model.atomicConformation.x), y: Array.from(model.atomicConformation.y), z: Array.from(model.atomicConformation.z),
    bonds: Array.from(IndexPairBonds.Provider.get(model).bonds.edgeProps.order) };
}

const charged = sdf();
assert.deepEqual(snapshot(await model((await parsed(charged, upstreamParseSdf))[0])).charges, [0, 0], 'reproduce Mol* 5.11 charge loss');
for (const newline of ['\n', '\r\n', '\r']) {
  const compounds = await parsed(sdf(undefined, newline));
  assert.equal(compounds.length, 1);
  const actual = await model(compounds[0]);
  assert.deepEqual(snapshot(actual), { elements: ['C', 'O'], charges: [1, -1],
    x: [0, Math.fround(1.2)], y: [0, 0], z: [0, 0], bonds: [2, 2] });
  assert.equal(actual.sourceData.data, compounds[0]);
  assert.deepEqual(Array.from(compounds[0].dataItems.data.toArray()), ['CHG=99 is a foreign data value']);
}

// Charges belong to the atom row, are actual integer charges (not V2000 codes),
// and may follow quoted/list-valued properties or a continued/split token.
const continued = sdf(['1 C 0 0 0 0 LABEL="say ""CHG=8""" ATTACH=(2 1 2) -\nM  V30 CHG=+7',
  '2 O 1.2 0 0 0 CHG=--\nM  V30 15']);
assert.deepEqual(snapshot(await model((await parsed(continued))[0])).charges, [7, -15]);
assert.deepEqual(snapshot(await model((await parsed(sdf(['1 C 0 0 0 0 CHG=2147483647', '2 O 1.2 0 0 0 CHG=-2147483648'])))[0])).charges,
  [2_147_483_647, -2_147_483_648], 'accept the full charge range the model can represent');
const spaced = sdf(['1 C 0 0 0 0-\nM  V30  CHG=1', '2 O 1.2 0 0 0 CHG=-1']);
assert.deepEqual(snapshot(await model((await parsed(spaced))[0])).charges, [1, -1]);
const neutral = sdf(['1 C 0 0 0 0 LABEL="CHG=4"', '2 O 1.2 0 0 0']);
assert.deepEqual(snapshot(await model((await parsed(neutral))[0])).charges, [0, 0]);
const coordinates = sdf(['1 C -1.123456789 2e-3 -0 0 LABEL="CHG=4"', '2 O 1.2 1.234567891e2 -4.5 0']);
assert.deepEqual(snapshot(await model((await parsed(coordinates))[0])), snapshot(await model((await parsed(coordinates, upstreamParseSdf))[0])),
  'preserve the upstream model coordinate precision and bond graph');
const multiple = await parsed(charged + neutral);
assert.equal(multiple.length, 2);
assert.deepEqual(await Promise.all(multiple.map(async compound => snapshot(await model(compound)).charges)), [[1, -1], [0, 0]]);

const v2000 = ['Charged V2000', 'Burette', '', '  2  1  0  0  0  0            999 V2000',
  '    0.0000    0.0000    0.0000 C   0  3  0  0  0  0  0  0  0  0  0  0',
  '    1.2000    0.0000    0.0000 O   0  5  0  0  0  0  0  0  0  0  0  0',
  '  1  2  2  0  0  0  0', 'M  END', '$$$$', ''].join('\n');
for (const text of [v2000, v2000.replace('M  END', 'M  CHG  2   1   2   2  -2\nM  END')]) {
  assert.deepEqual(snapshot(await model((await parsed(text))[0])), snapshot(await model((await parsed(text, upstreamParseSdf))[0])));
}
assert.deepEqual(snapshot(await model((await parsed(v2000))[0])).charges, [1, -1]);

for (const value of ['x', '', '1.5', '1e1', 'Infinity', 'NaN', '2147483648', '-2147483649', '"1"', '(1 1)', '1 CHG=2']) {
  await assert.rejects(parsed(sdf([`1 C 0 0 0 0 CHG=${value}`, '2 O 1.2 0 0 0'])), /Invalid or duplicate V3000 CHG/);
}
for (const property of ['CHG = 1', 'chg=1']) await assert.rejects(parsed(sdf([`1 C 0 0 0 0 ${property}`, '2 O 1.2 0 0 0'])), /V3000 CHG/);
await assert.rejects(parsed(sdf(['1 C 0 0 0 0 LABEL="unterminated', '2 O 1.2 0 0 0'])), /Unterminated V3000/);
await assert.rejects(parsed(sdf(['1 C 0 0 0 0 ATTACH=(2 1 2', '2 O 1.2 0 0 0'])), /Unterminated V3000/);
await assert.rejects(parsed(charged.replace('M  V30 2 O', 'M  V30 1 O')), /duplicate V3000 atom index/);
await assert.rejects(parsed(charged.replace('COUNTS 2 1', 'COUNTS 1000000000 1')), /Invalid or truncated V3000 atom count/);
await assert.rejects(parsed(charged.slice(0, charged.indexOf('M  V30 END ATOM'))), /end of V3000 atom block/);
await assert.rejects(parsed(charged.replace('M  V30 END ATOM', 'M  V30 END CTAB')), /Missing V3000 END ATOM/);
await assert.rejects(parsed(sdf([`1 C 0 0 0 0 LABEL=${'x'.repeat(65_536)}`, '2 O 1.2 0 0 0'])), /65,536 characters/);
await assert.rejects(parsed(sdf([`1 C 0 0 0 0 ${'-\nM  V30 '.repeat(256)}CHG=1`, '2 O 1.2 0 0 0'])), /256 continuation lines/);
assert.equal(await readFile(parserUrl, 'utf8'), originalParser, 'never edit installed Mol* source');
assert.equal(await readFile(atomsUrl, 'utf8'), originalAtoms);
console.log('Mol* V3000 direct formal charges, continuations, V2000 parity, source data and bounded malformed rejection passed');
