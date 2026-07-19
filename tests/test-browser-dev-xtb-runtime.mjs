#!/usr/bin/env bun
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as realFs from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mock } from "bun:test";

const childMode = process.env.BURRETE_XTB_TEST_CHILD === "1";

if (childMode) {
  const originalStatSync = realFs.statSync;
  const fsExports = { ...realFs };
  const hiddenSystemPixiPaths = new Set([
    "/opt/homebrew/bin/pixi",
    "/usr/local/bin/pixi",
  ]);
  mock.module("node:fs", () => ({
    ...fsExports,
    statSync(path, ...args) {
      if (hiddenSystemPixiPaths.has(String(path))) {
        throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
      }
      return originalStatSync(path, ...args);
    },
  }));

  const runtime = await import("../apps/desktop/vite/browser-dev/xtb-runtime.ts");
  const installer = runtime.browserDevManagedInstallerName();
  const resolution = await runtime.installBrowserDevManagedXtb();
  console.log(JSON.stringify({ installer, resolution, runtimeRoot: runtime.browserDevXtbRuntimeRoot() }));
} else {
  const root = await mkdtemp(join(tmpdir(), "burrete-browser-xtb-"));
  const conda = join(root, "miniconda3", "bin", "conda");
  const argumentsLog = join(root, "conda-arguments.txt");
  await mkdir(dirname(conda), { recursive: true });
  await writeFile(conda, `#!/bin/sh
set -eu
printf '%s\\n' "$@" > "$BURRETE_XTB_TEST_ARGUMENTS_LOG"
prefix=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--prefix' ]; then
    shift
    prefix="$1"
  fi
  shift
done
test -n "$prefix"
mkdir -p "$prefix/bin"
printf '%s\\n' '#!/bin/sh' "echo 'xTB version 6.7.1'" > "$prefix/bin/xtb"
chmod +x "$prefix/bin/xtb"
`, "utf8");
  await chmod(conda, 0o755);

  try {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      encoding: "utf8",
      env: {
        ...process.env,
        BURRETE_XTB_TEST_ARGUMENTS_LOG: argumentsLog,
        BURRETE_XTB_TEST_CHILD: "1",
        CONDA_EXE: conda,
        HOME: root,
        PATH: "/usr/bin:/bin",
      },
    });
    assert.equal(child.status, 0, child.stderr || child.stdout || "browser-dev xTB child failed");
    const output = JSON.parse(child.stdout.trim().split("\n").at(-1));
    const runtimeRoot = join(root, "Library", "Application Support", "Burrete", "browser-dev", "runtimes", "xtb");

    assert.equal(output.installer, "conda");
    assert.equal(output.runtimeRoot, runtimeRoot);
    assert.equal(output.resolution.source, "managed");
    assert.equal(output.resolution.selectedExecutablePath, null);
    assert.equal(
      await realpath(join(runtimeRoot, "current", ".pixi", "envs", "default", "bin", "xtb")),
      output.resolution.executablePath,
    );
    assert.equal((await lstat(join(runtimeRoot, "current"))).isSymbolicLink(), true);

    const argumentsUsed = (await readFile(argumentsLog, "utf8")).trim().split("\n");
    assert.deepEqual(argumentsUsed.slice(0, 6), [
      "create",
      "--yes",
      "--no-default-packages",
      "--override-channels",
      "--channel",
      "conda-forge",
    ]);
    assert.equal(argumentsUsed[6], "--prefix");
    assert.match(argumentsUsed[7], /\/staging-[^/]+\/\.pixi\/envs\/default$/u);
    assert.equal(argumentsUsed[8], "xtb=6.7.*");
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  console.log("Browser-dev xTB Conda runtime tests passed");
}
