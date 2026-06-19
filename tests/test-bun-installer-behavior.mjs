#!/usr/bin/env bun
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  buildDoctorReport,
  buildPluginStatus,
  compareVersions,
  findZipAsset,
  installCodexPlugin,
  replaceInstalledApp,
  selectRelease,
} from "../packages/burrete/bin/burrete.mjs";

const root = await mkdtemp(path.join(tmpdir(), "burrete-installer-test-"));
const sourceApp = path.join(root, "source", "Burrete.app");
const targetApp = path.join(root, "Applications", "Burrete.app");
const sourcePayload = path.join(sourceApp, "Contents", "next.txt");
const targetPayload = path.join(targetApp, "Contents", "current.txt");

try {
  await mkdir(path.dirname(sourcePayload), { recursive: true });
  await mkdir(path.dirname(targetPayload), { recursive: true });
  await writeFile(sourcePayload, "next");
  await writeFile(targetPayload, "current");

  const failingMove = async (from, to) => {
    if (from.endsWith("Burrete.app.updating") && to === targetApp) {
      throw new Error("simulated move failure");
    }
    await rename(from, to);
  };

  await assert.rejects(
    replaceInstalledApp({
      sourceApp,
      targetApp,
      copyApp: (from, to) => cp(from, to, { recursive: true }),
      movePath: failingMove,
    }),
    /simulated move failure/,
  );

  assert.equal(await readFile(targetPayload, "utf8"), "current");
  await assert.rejects(readFile(path.join(root, "Applications", "Burrete.app.updating", "Contents", "next.txt"), "utf8"));
  await assert.rejects(readFile(path.join(root, "Applications", "Burrete.app.previous", "Contents", "current.txt"), "utf8"));

  assert.ok(compareVersions("v0.10.40", "v0.10.39") > 0);
  assert.ok(compareVersions("v0.10.40", "v0.10.40-beta.1") > 0);
  assert.ok(compareVersions("v0.10.40-beta.2", "v0.10.40-beta.1") > 0);

  const releases = [
    { tag_name: "v0.10.39", draft: false, prerelease: false, assets: [{ name: "Burrete-0.10.39.zip" }] },
    { tag_name: "v0.10.41-beta.1", draft: false, prerelease: true, assets: [{ name: "Burrete-0.10.41-beta.1.zip" }] },
    { tag_name: "v0.10.40", draft: false, prerelease: false, assets: [{ name: "Burrete-0.10.40.zip" }] },
    { tag_name: "v0.10.42", draft: true, prerelease: false, assets: [{ name: "Burrete-0.10.42.zip" }] },
    { tag_name: "v0.10.43", draft: false, prerelease: false, assets: [{ name: "notes.txt" }] },
  ];
  assert.equal(selectRelease(releases, "stable").tag_name, "v0.10.40");
  assert.equal(selectRelease(releases, "beta").tag_name, "v0.10.41-beta.1");
  assert.equal(findZipAsset(releases[0]).name, "Burrete-0.10.39.zip");

  const doctorPaths = new Set([
    "/Applications/Burrete.app",
    "/Applications/Burrete.app/Contents/PlugIns/BurretePreview.appex",
    "/usr/bin/qlmanage",
  ]);
  const doctorReport = await buildDoctorReport({
    system: true,
    exists: async (candidate) => doctorPaths.has(candidate),
    runCommand: () => ({ status: 0, stdout: "0.10.40\n" }),
  });
  assert.deepEqual(doctorReport.map(item => item.ok), [true, true, true, true]);
  assert.match(doctorReport[3].detail, /0\.10\.40/);

  const pluginSource = path.join(root, "repo", "plugins", "burette-agent");
  await mkdir(path.join(pluginSource, ".codex-plugin"), { recursive: true });
  await writeFile(path.join(pluginSource, ".codex-plugin", "plugin.json"), JSON.stringify({
    name: "burrete",
    version: "0.1.0",
    skills: "./skills/",
    mcpServers: "./.mcp.json",
  }));
  await writeFile(path.join(pluginSource, "README.md"), "# Plugin\n");
  await writeFile(path.join(pluginSource, "package.json"), JSON.stringify({ name: "burette-agent-plugin" }));

  const pluginCache = path.join(root, "codex-cache");
  const statusBeforeInstall = await buildPluginStatus({
    sourcePath: pluginSource,
    cacheDir: pluginCache,
    namespace: "test-local",
  });
  assert.equal(statusBeforeInstall.sourceOk, true);
  assert.equal(statusBeforeInstall.installed, false);
  assert.equal(statusBeforeInstall.target, path.join(pluginCache, "test-local", "burrete", "0.1.0"));

  const installResult = await installCodexPlugin({
    sourcePath: pluginSource,
    cacheDir: pluginCache,
    namespace: "test-local",
    installDeps: false,
    now: () => new Date("2026-06-19T00:00:00.000Z"),
  });
  assert.equal(installResult.action, "installed");
  assert.equal(await readFile(path.join(installResult.target, "README.md"), "utf8"), "# Plugin\n");
  const installMetadata = JSON.parse(await readFile(path.join(installResult.target, ".burette-agent-install.json"), "utf8"));
  assert.equal(installMetadata.plugin.name, "burrete");
  assert.equal(installMetadata.plugin.version, "0.1.0");
  assert.equal(installMetadata.source, pluginSource);

  await writeFile(path.join(pluginSource, "README.md"), "# Plugin updated\n");
  const updateResult = await installCodexPlugin({
    sourcePath: pluginSource,
    cacheDir: pluginCache,
    namespace: "test-local",
    installDeps: false,
  });
  assert.equal(updateResult.action, "updated");
  assert.equal(await readFile(path.join(updateResult.target, "README.md"), "utf8"), "# Plugin updated\n");

  const statusAfterInstall = await buildPluginStatus({
    sourcePath: pluginSource,
    cacheDir: pluginCache,
    namespace: "test-local",
  });
  assert.equal(statusAfterInstall.installed, true);

  const existingNamespaceCache = path.join(root, "existing-namespace-cache");
  const oldInstall = path.join(existingNamespaceCache, "market-local", "burrete", "0.0.9");
  await mkdir(path.join(oldInstall, ".codex-plugin"), { recursive: true });
  await writeFile(path.join(oldInstall, ".codex-plugin", "plugin.json"), JSON.stringify({
    name: "burrete",
    version: "0.0.9",
  }));
  const inferredStatus = await buildPluginStatus({
    sourcePath: pluginSource,
    cacheDir: existingNamespaceCache,
  });
  assert.equal(inferredStatus.namespace, "market-local");
  assert.equal(inferredStatus.installedVersion, "0.0.9");
  assert.equal(inferredStatus.target, path.join(existingNamespaceCache, "market-local", "burrete", "0.1.0"));
  const inferredUpdate = await installCodexPlugin({
    sourcePath: pluginSource,
    cacheDir: existingNamespaceCache,
    installDeps: false,
  });
  assert.equal(inferredUpdate.action, "updated");
  assert.equal(inferredUpdate.namespace, "market-local");
  assert.equal(inferredUpdate.target, path.join(existingNamespaceCache, "market-local", "burrete", "0.1.0"));
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("bun installer behavior tests passed");
