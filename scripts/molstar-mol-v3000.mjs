import { molstarPatchPlugin } from './molstar-source.mjs';

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
  const original = `      const parsed = await parseMol(SO.Data.readBytes(a)).runInContext(ctx);
      if (parsed.isError)
        throw new Error(parsed.message);
      const models = await trajectoryFromMol(parsed.result).runInContext(ctx);`;
  const parserImport = 'import { parseMol } from "@molstar/io/reader/mol/parser";\n';
  if (source.split(original).length !== 2 || source.split(parserImport).length !== 2 || source.includes('parseSdf')) throw new Error('Mol* MOL transform changed; review before vendoring.');
  return source.replace(parserImport, `${parserImport}import { parseSdf } from "@molstar/io/reader/sdf/parser";\n`).replace(original, `      const bytes = SO.Data.readBytes(a);
      const v3000 = (${molV3000Framing.toString()})(typeof a.data === 'string' ? a.data : new TextDecoder().decode(bytes));
      const parsed = await (v3000 ? parseSdf(bytes) : parseMol(bytes)).runInContext(ctx);
      if (parsed.isError)
        throw new Error(parsed.message);
      if (v3000 && parsed.result.compounds.length !== 1)
        throw new Error('Open one complete MOL structure.');
      const mol = v3000 ? parsed.result.compounds[0].molFile : parsed.result;
      const models = await trajectoryFromMol(mol).runInContext(ctx);`);
}
export const molstarMolV3000Plugin = molstarPatchPlugin(
  'molstar-mol-v3000',
  '@molstar/plugin/state/formats/trajectory/mol',
  patchMolstarMolV3000,
);
