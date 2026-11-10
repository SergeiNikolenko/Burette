import { installKetcherBrowserRequire, installKetcherRaphaelBrowserModules } from './ketcher-browser-require';
import type { StructService, StructServiceOptions } from 'ketcher-core';

let codecs: Promise<typeof import('ketcher-core')> | undefined;
export function loadCodecs() {
  return codecs ??= (async () => {
    installKetcherBrowserRequire();
    const eve = await import('eve-raphael');
    const raphael = await import('raphael');
    installKetcherRaphaelBrowserModules(eve, raphael);
    return import('ketcher-core');
  })().catch(error => { codecs = undefined; throw error; });
}

// Indigo owns one worker per window. Share its service and serialize requests:
// its conversion replies are matched by input text, without a request ID.
let conversionService: Promise<StructService> | undefined;
let conversionQueue: Promise<unknown> = Promise.resolve();
export function convertStructure(struct: string, format: keyof typeof import('ketcher-core')['ChemicalMimeType'], molfileFormat?: 'v2000' | 'v3000', inputFormat: 'Mol' | 'UNKNOWN' = 'Mol') {
  const result = conversionQueue.then(async () => {
    const core = await loadCodecs();
    conversionService ??= import('ketcher-standalone/dist/binaryWasm').then(({ StandaloneStructServiceProvider }) => {
      const service = new StandaloneStructServiceProvider().createStructService({}) as StructService & {
        getStandardServerOptions: (options?: StructServiceOptions) => StructServiceOptions;
      };
      // The standalone codec otherwise obtains these settings from a mounted
      // Ketcher UI. The molecular frame owns the drawing and supplies them here.
      service.getStandardServerOptions = options => ({
        'aromaticity-model': 'generic',
        'ignore-no-chiral-flag': false,
        'aromatize-skip-superatoms': true,
        ...options,
      });
      return service;
    }).catch(error => { conversionService = undefined; throw error; });
    const service = await conversionService;
    const converted = await service.convert({ struct, input_format: core.ChemicalMimeType[inputFormat], output_format: core.ChemicalMimeType[format] },
      molfileFormat ? { 'molfile-saving-mode': molfileFormat === 'v3000' ? '3000' : '2000' } : undefined);
    return converted.struct;
  });
  conversionQueue = result.catch(() => {});
  return result;
}

// Existing files and agent contracts retain their formats. The drawing surface
// and its state belong to the shared molecular frame.
export async function importStructure(value: string) {
  if (/^\s*(?:<|InChI=|VjCD0100|\$RXN|\$RDFILE)/u.test(value)) {
    return importStructure(await convertStructure(value, 'KET', undefined, 'UNKNOWN'));
  }
  if (!value.trim().startsWith('{')) return value;
  const ket = JSON.parse(value);
  const nodes = ket?.root?.nodes;
  if (!Array.isArray(nodes) || nodes.some((node: { $ref?: string }) => !node.$ref || ket[node.$ref]?.type !== 'molecule')) {
    const error = new Error('This drawing contains reaction, annotation or macromolecule objects that the molecular editor cannot edit yet.');
    error.name = 'UnsupportedMolecularDocumentError';
    throw error;
  }
  const atomFields = new Set(['label', 'location', 'charge', 'isotope', 'radical', 'explicitValence', 'mapping', 'stereoLabel', 'selected', 'cip']);
  const bondFields = new Set(['type', 'atoms', 'stereo', 'selected', 'cip']);
  const moleculeFields = new Set(['type', 'atoms', 'bonds', 'sgroups']);
  const rgroupFields = new Set(['type', 'location', '$refs', 'selected']);
  const sgroupFields = new Set(['type', 'atoms', 'bonds', 'subscript', 'connectivity']);
  for (const node of nodes) {
    const molecule = ket[node.$ref];
    if (Object.keys(molecule).some(key => !moleculeFields.has(key))
      || !Array.isArray(molecule.atoms) || (molecule.bonds != null && !Array.isArray(molecule.bonds))
      || molecule.atoms.some((atom: Record<string, unknown>) => atom.type === 'rg-label'
        ? Object.keys(atom).some(key => !rgroupFields.has(key)) || !Array.isArray(atom.$refs)
          || atom.$refs.length > 1 || atom.$refs.some(ref => typeof ref !== 'string' || !/^rg-(?:[1-9]|[12][0-9]|3[0-2])$/.test(ref))
        : Object.keys(atom).some(key => !atomFields.has(key)) || (atom.stereoLabel != null && atom.stereoLabel !== 'abs'))
      || (molecule.bonds ?? []).some((bond: Record<string, unknown>) => Object.keys(bond).some(key => !bondFields.has(key)) || ![1, 2, 3, 4, 9].includes(Number(bond.type)))
      || (molecule.sgroups != null && (!Array.isArray(molecule.sgroups) || molecule.sgroups.some((group: Record<string, unknown>) =>
        group.type !== 'SRU' || Object.keys(group).some(key => !sgroupFields.has(key))
        || !Array.isArray(group.atoms) || !['HT', 'HH', 'EU'].includes(String(group.connectivity))
        || (group.bonds != null && (!Array.isArray(group.bonds) || group.bonds.some(index => !Number.isInteger(index) || index < 0 || index >= (molecule.bonds?.length ?? 0))))
        || typeof group.subscript !== 'string' || [...group.subscript].length > 20)))) {
      const error = new Error('This drawing contains chemical properties that the molecular editor cannot preserve yet.');
      error.name = 'UnsupportedMolecularDocumentError';
      throw error;
    }
  }
  return convertStructure(value, 'Mol', 'v2000', 'UNKNOWN');
}
