#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import initializeExtractor from "../../PreviewExtension/Web/rdkit-conformer/Burrete_rdkit_conformer.js";

const fixtureUrl = new URL("./fixtures/mmff-rdkit-2025.03.4.json", import.meta.url);
const wasmUrl = new URL(
  "../../PreviewExtension/Web/rdkit-conformer/Burrete_rdkit_conformer.wasm",
  import.meta.url,
);
const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
const module = await initializeExtractor({ wasmBinary: await readFile(wasmUrl) });
const revision = module.rdkit_source_revision();
if (revision !== `Release_2025_03_4@${fixture.rdkitCommit}`) {
  throw new Error(`Packaged RDKit revision drift: ${revision}`);
}
if (module.mmff_extractor_abi_version() !== 1) {
  throw new Error("Packaged MMFF extractor is not BMFX v1");
}
for (const item of fixture.cases) {
  const variant = item.variant === "MMFF94" ? 0 : 1;
  const bytes = module.extract_mmff_parameters(item.molblock, 0, variant);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 64) {
    throw new Error(`Invalid BMFX output for ${item.name} ${item.variant}`);
  }
  item.bmfxBase64 = Buffer.from(bytes).toString("base64");
}
await writeFile(fixtureUrl, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`Attached BMFX v1 payloads to ${fixture.cases.length} MMFF parity cases`);
