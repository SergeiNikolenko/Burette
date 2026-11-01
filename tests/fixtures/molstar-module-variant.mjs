import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readMolstarModule, resolveMolstarModule } from '../../scripts/molstar-source.mjs';

// A separate instance of one pinned Mol* module, optionally transformed. Its
// dependencies stay the shared instances, so the variant can be compared with
// the build-adapted module that the same process loads by specifier.
export async function molstarModuleVariantUrl(specifier, transform = source => source) {
  const path = resolveMolstarModule(specifier);
  const absolute = dependency => dependency.startsWith('.') ? pathToFileURL(resolve(dirname(path), dependency)).href
    : dependency.startsWith('@molstar/') ? pathToFileURL(resolveMolstarModule(dependency)).href : dependency;
  const source = transform(await readMolstarModule(specifier))
    .replace(/((?:from|import)\s*)"([^"]+)"/gu, (_, keyword, dependency) => `${keyword}"${absolute(dependency)}"`);
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

export async function importMolstarModuleVariant(specifier, transform) {
  return import(await molstarModuleVariantUrl(specifier, transform));
}
