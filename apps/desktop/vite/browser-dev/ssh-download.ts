import { open, unlink } from "node:fs/promises";
import { basename, extname, join } from "node:path";

export async function saveSshDownload(directory: string, remotePath: string, data: Buffer) {
  const name = basename(remotePath);
  if (!name || name === "." || name === "..") throw new Error("Choose a file");
  const extension = extname(name);
  const stem = basename(name, extension);
  for (let index = 0; index < 100; index++) {
    const output = join(directory, index === 0 ? name : `${stem} (${index})${extension}`);
    let file;
    try { file = await open(output, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
    try { await file.writeFile(data); await file.sync(); }
    catch (error) {
      await file.close();
      await unlink(output);
      throw error;
    }
    await file.close();
    return output;
  }
  throw new Error("Too many files with this name. Choose another destination.");
}
