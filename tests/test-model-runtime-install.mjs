import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveModelPython } from "../scripts/model-runtime-path.mjs";
import { registerBrowserDevModelRuntimeRoutes } from "../apps/desktop/vite/browser-dev/model-runtime.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv[2] === "child") {
  let handler;
  registerBrowserDevModelRuntimeRoutes({ middlewares: { use(_path, value) { handler = value; } } }, repo);
  function request(method, url) {
    let body;
    handler({ method, url }, { setHeader() {}, end(value) { body = JSON.parse(value); } });
    return body;
  }
  const before = request("GET", "/");
  assert.equal(before.installed, resolveModelPython(repo) !== null);
  request("POST", "/install");
  for (let count = 0; count < 200; count += 1) {
    const result = request("GET", "/");
    if (result.installPhase !== "installing") {
      process.stdout.write(JSON.stringify({ ...result, beforeInstalled: before.installed }));
      process.exit(0);
    }
    await new Promise((done) => setTimeout(done, 20));
  }
  throw new Error("Installer fixture timed out");
} else {
  const temporary = mkdtempSync(join(tmpdir(), "model-installer-"));
  try {
    const uv = join(temporary, "uv");
    const log = join(temporary, "commands.jsonl");
    const runtime = join(temporary, "model-python");
    const executable = process.execPath;
    writeFileSync(uv, `#!${executable}
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
if (Object.keys(process.env).some(key => /^(UV_|PIP_|PYTHON)/.test(key) || key === 'VIRTUAL_ENV')) process.exit(31);
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args[0] === 'venv') {
  const staging = args.at(-1);
  mkdirSync(join(staging, 'bin'), {recursive: true});
  writeFileSync(join(staging, 'bin/python3'), ${JSON.stringify(`#!${executable}\nprocess.exit(0);\n`)}, {mode: 0o700});
}
if (args[1] === 'sync' && process.env.BURETTE_TEST_FAIL_SYNC === '1') process.exit(14);
`, { mode: 0o700 });
    const environment = {
      ...process.env, BURETTE_UV: uv, BURETTE_CHEMICAL_SPACE_MODEL_RUNTIME_DIR: runtime,
      UV_NO_VERIFY_HASHES: "1", UV_EXTRA_INDEX_URL: "https://untrusted.invalid",
      PIP_CONFIG_FILE: "/untrusted", PYTHONPATH: "/untrusted", VIRTUAL_ENV: "/untrusted",
    };
    const invoke = (extra = {}) => {
      const result = spawnSync(executable, [fileURLToPath(import.meta.url), "child"], {
        env: { ...environment, ...extra }, encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    mkdirSync(join(runtime, "bin"), { recursive: true });
    writeFileSync(join(runtime, "bin/python3"), "previous runtime");
    writeFileSync(join(runtime, "burette-install.json"), JSON.stringify({ requirements: "previous unhashed lock" }));
    const installed = invoke();
    assert.equal(installed.beforeInstalled, false);
    assert.equal(installed.installed, true);
    assert.equal(installed.installPhase, "completed", installed.installError);
    const current = invoke();
    assert.equal(current.beforeInstalled, true);
    assert.equal(current.installed, true);
    const commands = readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
    const bootstrap = commands.find(args => args[1] === "install");
    const sync = commands.find(args => args[1] === "sync");
    for (const args of [bootstrap, sync]) {
      for (const flag of ["--require-hashes", "--only-binary=:all:", "--no-cache", "--no-config"]) {
        assert.ok(args.includes(flag), flag);
      }
      assert.equal(args[args.indexOf("--default-index") + 1], "https://pypi.org/simple");
    }
    assert.ok(bootstrap.includes("--no-deps"));
    assert.ok(sync.includes("--no-build-isolation"));
    assert.ok(sync.includes("--no-binary=antlr4-python3-runtime"));
    assert.ok(!sync.includes("-r"));
    writeFileSync(join(runtime, "burette-install.json"), "{}");
    writeFileSync(join(runtime, "preserved"), "existing runtime");
    const failed = invoke({ BURETTE_TEST_FAIL_SYNC: "1" });
    assert.equal(failed.installPhase, "failed");
    assert.equal(failed.beforeInstalled, false);
    assert.equal(failed.installed, false);
    const override = invoke({ BURETTE_CHEMICAL_SPACE_MODEL_PYTHON: join(runtime, "bin/python3"), BURETTE_TEST_FAIL_SYNC: "1" });
    assert.equal(override.beforeInstalled, true);
    assert.equal(override.source, "override");
    assert.equal(readFileSync(join(runtime, "preserved"), "utf8"), "existing runtime");
    console.log("Managed model install verifies lock policy, ignores ambient overrides, and preserves failed replacement.");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
