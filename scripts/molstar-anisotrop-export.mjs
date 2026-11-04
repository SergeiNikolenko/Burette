import { fileURLToPath } from 'node:url';
import { molstarPatchPlugin } from './molstar-source.mjs';

export function patchMolstarAnisotropExport(source) {
  const changes = [
    ['const CifCategory = CifWriter.Category;', `import { currentAtomSiteAnisotrop } from ${JSON.stringify(fileURLToPath(new URL('./molstar-anisotrop-category.js', import.meta.url)))};\nconst CifCategory = CifWriter.Category;`],
    ['  _atom_site({ keepId: options?.keepAtomSiteId })', '  _atom_site({ keepId: options?.keepAtomSiteId }),\n  currentAtomSiteAnisotrop({ keepId: options?.keepAtomSiteId })'],
    ['  for (const cat of cats) {', '  for (const cat of cats) {\n    // The standard category now exports current coordinates and their tensors.\n    if (cat.name === "atom_site_anisotrop") continue;'],
  ];
  for (const [before, after] of changes) {
    if (source.split(before).length !== 2) throw new Error('Mol* anisotropic export changed; review current-conformation export before vendoring.');
    source = source.replace(before, after);
  }
  return source;
}

export const molstarAnisotropExportPlugin = molstarPatchPlugin(
  'molstar-anisotrop-export', '@molstar/model/model/structure/export/mmcif', patchMolstarAnisotropExport,
);
