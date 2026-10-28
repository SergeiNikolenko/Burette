import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// Framing only: the upstream V3K reader still owns atoms, bonds and properties.
function molV3000Framing(data) {
  const lines = data.split(/\r\n?|\n/);
  if (!/V3000\s*$/.test(lines[3] || '')) return false;
  const begin = [], end = [], terminators = [];
  lines.forEach((line, index) => {
    if (/^M\s+V30\s+BEGIN\s+CTAB\s*$/.test(line)) begin.push(index);
    if (/^M\s+V30\s+END\s+CTAB\s*$/.test(line)) end.push(index);
    if (/^M\s+END\s*$/.test(line)) terminators.push(index);
  });
  if (begin.length !== 1 || end.length !== 1 || terminators.length !== 1 || begin[0] < 4
    || end[0] <= begin[0] || terminators[0] <= end[0]
    || lines.slice(4, begin[0]).some(line => line.trim())
    || lines.slice(end[0] + 1, terminators[0]).some(line => line.trim())
    || lines.slice(terminators[0] + 1).some(line => line.trim())) throw new Error('Open one complete MOL structure.');
  return true;
}

// MOL's upstream provider only calls the V2000 reader. Reuse the existing SDF
// V3K parser in this transform module, preserving MOL model format and raw source.
export function patchMolstarMolV3000(source) {
  const original = `            const parsed = await parseMol(a.data).runInContext(ctx);
            if (parsed.isError)
                throw new Error(parsed.message);
            const models = await trajectoryFromMol(parsed.result).runInContext(ctx);`;
  if (source.split(original).length !== 2 || !source.includes("import { parseSdf }")) throw new Error('Mol* MOL transform changed; review before vendoring.');
  return source.replace(original, `            const v3000 = (${molV3000Framing.toString()})(a.data);
            const parsed = await (v3000 ? parseSdf(a.data) : parseMol(a.data)).runInContext(ctx);
            if (parsed.isError)
                throw new Error(parsed.message);
            if (v3000 && parsed.result.compounds.length !== 1)
                throw new Error('Open one complete MOL structure.');
            const mol = v3000 ? parsed.result.compounds[0].molFile : parsed.result;
            const models = await trajectoryFromMol(mol).runInContext(ctx);`);
}
export const molstarMolV3000Plugin = {
  name: 'molstar-mol-v3000',
  setup(build) {
    build.onLoad({ filter: /molstar\/lib\/mol-plugin-state\/transforms\/model\.js$/u }, async ({ path }) => {
      const { version } = JSON.parse(await readFile(resolve(dirname(path), '../../../package.json'), 'utf8'));
      if (version !== '5.11.0') throw new Error('Review the MOL adapter before upgrading from Mol* 5.11.0.');
      return { contents: patchMolstarMolV3000(await readFile(path, 'utf8')), loader: 'js' };
    });
  },
};
