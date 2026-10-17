#!/usr/bin/env bun
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as realFs from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mock } from "bun:test";

const childMode = process.env.BURETTE_XTB_TEST_CHILD === "1";

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
  try {
    const resolution = process.env.BURETTE_XTB_TEST_RESOLVE === "1"
      ? runtime.resolveBrowserDevXtb() : await runtime.installBrowserDevManagedXtb();
    console.log(JSON.stringify({ installer, resolution, runtimeRoot: runtime.browserDevXtbRuntimeRoot() }));
  } catch (error) {
    console.log(JSON.stringify({ installer, error: error.message }));
  }
} else {
  const root = await mkdtemp(join(tmpdir(), "burette-browser-xtb-"));
  const conda = join(root, "miniconda3", "bin", "conda");
  const argumentsLog = join(root, "conda-arguments.txt");
  await mkdir(dirname(conda), { recursive: true });
  await writeFile(conda, `#!/bin/sh
printf '%s\\n' "$@" > "$BURETTE_XTB_TEST_ARGUMENTS_LOG"
exit 99
`, "utf8");
  await chmod(conda, 0o755);

  try {
    function runChild(extra = {}) {
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
        encoding: "utf8",
        env: {
          ...process.env,
          BURETTE_XTB_TEST_ARGUMENTS_LOG: argumentsLog,
          BURETTE_XTB_TEST_CHILD: "1",
          CONDA_EXE: conda,
          CONDA_PREFIX: join(root, "miniconda3"),
          BURETTE_XTB_EXECUTABLE: "",
          HOME: root,
          PATH: "/usr/bin:/bin",
          ...extra,
        },
      });
      assert.equal(child.status, 0, child.stderr || child.stdout || "browser-dev xTB child failed");
      return JSON.parse(child.stdout.trim().split("\n").at(-1));
    }
    const rejected = runChild();
    assert.equal(rejected.installer, null);
    assert.match(rejected.error, /requires Pixi/);
    assert.equal(realFs.existsSync(argumentsLog), false, "unlocked Conda must not execute");

    const existing = join(root, "miniconda3", "bin", "xtb");
    await writeFile(existing, "#!/bin/sh\necho 'xTB version 6.7.1'\n");
    await chmod(existing, 0o755);
    const discovered = runChild({ BURETTE_XTB_TEST_RESOLVE: "1" });
    assert.equal(discovered.resolution.source, "conda");
    assert.equal(discovered.resolution.executablePath, await realpath(existing));

    const pixi = join(root, ".pixi", "bin", "pixi");
    await mkdir(dirname(pixi), { recursive: true });
    await writeFile(pixi, `#!/bin/sh
set -eu
printf '%s\\n' "$@" > "$BURETTE_XTB_TEST_ARGUMENTS_LOG"
test "$1" = install
test "$2" = --locked
test "$3" = --manifest-path
staging="$(dirname "$4")"
test -s "$staging/pixi.lock"
prefix="$staging/.pixi/envs/default"
mkdir -p "$prefix/bin"
printf '%s\\n' '#!/bin/sh' "echo 'xTB version 6.7.1'" > "$prefix/bin/xtb"
chmod +x "$prefix/bin/xtb"
`, "utf8");
    await chmod(pixi, 0o755);
    const output = runChild();
    const runtimeRoot = join(root, "Library", "Application Support", "Burette", "browser-dev", "runtimes", "xtb");
    assert.equal(output.installer, "pixi");
    assert.equal(output.runtimeRoot, runtimeRoot);
    assert.equal(output.resolution.source, "managed");
    assert.equal(output.resolution.selectedExecutablePath, null);
    assert.equal(await realpath(join(runtimeRoot, "current", ".pixi", "envs", "default", "bin", "xtb")), output.resolution.executablePath);
    assert.equal((await lstat(join(runtimeRoot, "current"))).isSymbolicLink(), true);
    const argumentsUsed = (await readFile(argumentsLog, "utf8")).trim().split("\n");
    assert.deepEqual(argumentsUsed.slice(0, 3), ["install", "--locked", "--manifest-path"]);
    assert.equal(await readFile(join(dirname(argumentsUsed[3]), "pixi.lock"), "utf8"),
      await readFile(new URL("../config/xtb/pixi.lock", import.meta.url), "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  console.log("Browser-dev xTB locked installation and existing Conda discovery tests passed");
}
