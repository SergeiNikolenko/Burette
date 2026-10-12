import { mkdir, mkdtemp, lstat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const MAX_BYTES = 64 * 1024 * 1024;
type Entry = { fingerprint: string; path: string; version: string };
const version = async (path: string) => {
  const info = await lstat(path, { bigint: true });
  if (!info.isFile()) throw new Error("Not a preview file");
  return [info.ino, info.size, info.mtimeNs, info.ctimeNs].join(":");
};
const intact = async (entry: Entry) => version(entry.path).then(value => value === entry.version, () => false);

// Only this server's private cache is tracked; old versions remain readable by
// open tabs. Admission reserves bytes synchronously before any filesystem await.
export class SshPreviewCache {
  private entries = new Map<string, Entry>();
  private bytes = 0;
  private files = 0;
  constructor(private root: () => Promise<string>) {}
  async known(key: string) {
    const entry = this.entries.get(key);
    return entry && await intact(entry) ? entry.fingerprint : undefined;
  }
  async store(key: string, remotePath: string, response: Buffer) {
    const end = response.indexOf(10);
    if (end < 0 || end > 1024) throw new Error("Invalid SSH preview header");
    const header = JSON.parse(response.subarray(0, end).toString());
    const data = response.subarray(end + 1);
    if (typeof header.fingerprint !== "string" || !header.fingerprint || header.fingerprint.length > 256
      || typeof header.unchanged !== "boolean" || data.length > MAX_BYTES || (header.unchanged && data.length)) throw new Error("Invalid SSH preview response");
    const entry = this.entries.get(key);
    if (entry?.fingerprint === header.fingerprint && await intact(entry)) return entry.path;
    if (header.unchanged) throw new Error("Local preview cache changed. Open the file again.");
    if (this.files >= 256 || this.bytes + data.length > 512 * 1024 * 1024) throw new Error("SSH preview cache is full. Restart the preview server to clear it.");
    this.files++; this.bytes += data.length;
    const parent = join(await this.root(), "ssh-previews");
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const folder = await mkdtemp(join(parent, "file-"));
    const path = join(folder, basename(remotePath));
    await writeFile(path, data, { mode: 0o600, flag: "wx" });
    this.entries.set(key, { fingerprint: header.fingerprint, path, version: await version(path) });
    return path;
  }
}
