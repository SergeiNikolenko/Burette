import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { preserveNativeWidget } from "../plugins/burette-agent/scripts/preserve-native-widget.mjs";

test("native widget cannot be silently replaced by the browser-only bundle", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "burette-preservation-"));
  const source = path.join(root, "source");
  const installed = path.join(root, "installed");
  async function put(base, file, body = "fixture") {
    await mkdir(path.dirname(path.join(base, file)), { recursive: true });
    await writeFile(path.join(base, file), body);
  }
  try {
    // Fresh and existing browser-only installs keep their existing behavior.
    assert.doesNotThrow(() => preserveNativeWidget(source, installed));
    await put(installed, "browser-shell-dist/index.html");
    assert.doesNotThrow(() => preserveNativeWidget(source, installed));
    await put(installed, "assets/native-workspace.html", "keep this widget");
    assert.throws(() => preserveNativeWidget(source, installed), /Refusing to replace/);
    await put(source, "assets/native-workspace.html");
    assert.throws(() => preserveNativeWidget(source, installed), /manifest.json/);
    for (const file of [
      "assets/native-workspace/manifest.json", "assets/local-viewer.html",
      "mcp/registrations/local-viewer/register.mjs", "scripts/mcp-app-session.mjs",
    ]) await put(source, file);
    assert.doesNotThrow(() => preserveNativeWidget(source, installed));
    assert.equal(await readFile(path.join(installed, "assets/native-workspace.html"), "utf8"), "keep this widget");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("updater skips both installer and fallback when native capability would be lost", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "burette-updater-preservation-"));
  try {
    const updater = await readFile(new URL("../apps/desktop/src-tauri/src/commands/updater.rs", import.meta.url), "utf8");
    const prefix = updater.slice(updater.indexOf("sync_burette_codex_plugin() {{"), updater.indexOf('  local plugin_installer='))
      .replaceAll("{{", "{").replaceAll("}}", "}").replaceAll("HOME", "BURETTE_TEST_HOME");
    const script = `${prefix}\n echo reached-installation\n}\nsync_burette_codex_plugin\n`;
    const source = path.join(root, "app/Contents/Resources/plugins/burette-agent");
    const staged = path.join(root, "home/.codex/plugins/burette-marketplace/plugins/burette");
    async function put(base, file) {
      await mkdir(path.dirname(path.join(base, file)), { recursive: true });
      await writeFile(path.join(base, file), "fixture");
    }
    await put(source, ".codex-plugin/plugin.json");
    const run = () => {
      const result = spawnSync("/bin/bash", ["-s"], {
        input: script, encoding: "utf8",
        env: { DEST_APP: path.join(root, "app"), BURETTE_TEST_HOME: path.join(root, "home") },
      });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    assert.equal(run(), "reached-installation");
    await put(staged, "assets/native-workspace.html");
    assert.equal(run(), "codex plugin sync skipped: preserving installed native widget");
    for (const file of [
      "assets/native-workspace.html", "assets/native-workspace/manifest.json",
      "assets/local-viewer.html", "mcp/registrations/local-viewer/register.mjs",
      "scripts/mcp-app-session.mjs",
    ]) await put(source, file);
    assert.equal(run(), "reached-installation");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
