import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const snapshotPrefix = 'burette-mcp-resources-';

// Cache versions can disappear during a plugin update while this server is
// still serving mounted widgets. Keep one immutable generation per process.
export async function snapshotNativeResources(source) {
  await removeOrphanedSnapshots();
  const root = await mkdtemp(join(tmpdir(), `${snapshotPrefix}${process.pid}-`));
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

// Hosts stop MCP servers with signals, which skip the exit handler. Each
// generation is named after its owning process, so remove those whose owner
// is gone before adding another.
async function removeOrphanedSnapshots() {
  const names = await readdir(tmpdir()).catch(() => []);
  await Promise.all(names.map((name) => {
    const pid = Number(/^burette-mcp-resources-(\d+)-/u.exec(name)?.[1]);
    if (!pid || isRunning(pid)) return null;
    return rm(join(tmpdir(), name), { recursive: true, force: true });
  }));
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}
