#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import initializeExtractor from "../../PreviewExtension/Web/rdkit-conformer/Burrete_rdkit_conformer.js";

const variants = ["DG", "KDG", "ETDG", "ETDGv2", "ETKDG", "ETKDGv2", "ETKDGv3", "srETKDGv3"];
const molecules = [
  ["ethanol", "CCO"],
  ["lactic-acid", "C[C@H](O)C(=O)O"],
  ["cyclohexane", "C1CCCCC1"],
  ["acetamide", "CC(=O)N"],
];
const fixtureUrl = new URL("./fixtures/conformer-rdkit-2025.03.4.json", import.meta.url);
const wasmUrl = new URL(
  "../../PreviewExtension/Web/rdkit-conformer/Burrete_rdkit_conformer.wasm",
  import.meta.url,
);
const module = await initializeExtractor({ wasmBinary: await readFile(wasmUrl) });
const commit = "276b5a662302c6a548ac4f1363c066f3258e3a20";
if (module.rdkit_source_revision() !== `Release_2025_03_4@${commit}`) {
  throw new Error(`Packaged RDKit revision drift: ${module.rdkit_source_revision()}`);
}
if (module.conformer_extractor_abi_version() !== 1) {
  throw new Error("Packaged conformer extractor is not BCEX v1");
}
const cases = [];
for (const [name, smiles] of molecules) {
  for (const [variantTag, variant] of variants.entries()) {
    const bytes = module.extract_conformer_parameters(smiles, 1, variantTag);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 64) {
      throw new Error(`Invalid BCEX output for ${name} ${variant}`);
    }
    cases.push({
      name,
      smiles,
      variant,
      atomCount: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(12, true),
      bcexBase64: Buffer.from(bytes).toString("base64"),
    });
  }
}
await mkdir(new URL("./fixtures/", import.meta.url), { recursive: true });
await writeFile(
  fixtureUrl,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      rdkitVersion: "2025.03.4",
      rdkitCommit: commit,
      cases,
    },
    null,
    2,
  )}\n`,
);
console.log(`Generated ${cases.length} BCEX v1 conformer parity cases`);
