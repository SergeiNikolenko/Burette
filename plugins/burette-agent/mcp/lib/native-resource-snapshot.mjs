import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Cache versions can disappear during a plugin update while this server is
// still serving mounted widgets. Keep one immutable generation per process.
export async function snapshotNativeResources(source) {
  const root = await mkdtemp(join(tmpdir(), 'burette-mcp-resources-'));
  const cleanup = () => rmSync(root, { recursive: true, force: true });
  try {
    const [workspace, compact] = await Promise.all([
      readFile(join(source, 'native-workspace.html'), 'utf8'),
      readFile(join(source, 'local-viewer.html'), 'utf8'),
    ]);
    const assetRoot = join(root, 'native-workspace');
    await cp(join(source, 'native-workspace'), assetRoot, { recursive: true, dereference: false });
    process.once('exit', cleanup);
    return { workspace, compact, assetRoot, dispose() {
      process.off('exit', cleanup);
      cleanup();
    } };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
