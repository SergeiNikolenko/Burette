import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

// Explicit PDB IDs open like local files: the entry is downloaded once from
// RCSB into an OS-temporary cache and every opener receives that path. Legacy
// PDB format is preferred because it keeps author chain and residue numbering;
// entries without a PDB-format file fall back to mmCIF.
export const pdbIdSchema = z.string().trim().regex(/^[0-9][A-Za-z0-9]{3}$/u, "A PDB ID has four characters, for example 1STP.")
  .describe("Public Protein Data Bank ID, for example 1STP. Downloaded read-only from RCSB and opened like a local file; mutually exclusive with file.");

const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const cacheRoot = join(tmpdir(), "burette-pdb-entries");

export async function resolvePdbEntry(pdbId) {
  const id = pdbId.trim().toUpperCase();
  await mkdir(cacheRoot, { recursive: true });
  for (const extension of ["pdb", "cif"]) {
    const path = join(cacheRoot, `${id}.${extension}`);
    if ((await stat(path).catch(() => null))?.size) return path;
  }
  for (const extension of ["pdb", "cif"]) {
    const response = await fetch(`https://files.rcsb.org/download/${id}.${extension}`, { signal: AbortSignal.timeout(20000) });
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`RCSB returned HTTP ${response.status} for ${id}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_ENTRY_BYTES) throw new Error(`PDB entry ${id} exceeds 16 MiB and cannot be opened in Burette.`);
    const path = join(cacheRoot, `${id}.${extension}`);
    const partial = `${path}.${process.pid}.partial`;
    await writeFile(partial, bytes);
    await rename(partial, path);
    return path;
  }
  throw new Error(`PDB entry ${id} was not found at RCSB.`);
}
