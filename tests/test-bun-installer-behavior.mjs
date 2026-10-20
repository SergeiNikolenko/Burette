#!/usr/bin/env bun
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { generateKeyPairSync, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mock } from "bun:test";
import { verifyReleaseArchive } from "../packages/burette/bin/release-signature.mjs";


if (process.argv[2] === 'untrusted-release-child') {
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  mock.module('node:child_process', () => ({ spawnSync() { throw new Error('UNVERIFIED NATIVE COMMAND'); } }));
  const version = '2026.10.19';
  const url = `https://github.com/SergeiNikolenko/Burette/releases/download/v${version}/Burette-${version}.zip`;
  globalThis.fetch = async (request) => {
    if (String(request).endsWith('/releases')) return Response.json([{ tag_name: `v${version}`,
      assets: [{ name: `Burette-${version}.zip`, browser_download_url: url }] }]);
    if (String(request) === url) return new Response('unsigned synthetic archive');
    return new Response(Buffer.alloc(64).toString('base64'));
  };
  const entry = new URL('../packages/burette/bin/burette.mjs', import.meta.url);
  process.argv = [process.argv[0], entry.pathname, 'install'];
  // Execute the real CLI after replacing only its HTTP/native boundaries.
  await import(entry.href);
  await new Promise(resolve => setTimeout(resolve, 1000));
  throw new Error('Installer did not reject unsigned archive');
}

const {
  buildDoctorReport,
  compareVersions,
  findZipAsset,
  replaceInstalledApp,
  selectRelease,
} = await import("../packages/burette/bin/burette.mjs");

const rejectedCli = spawnSync(process.execPath, [import.meta.filename, 'untrusted-release-child'], { encoding: 'utf8' });
assert.equal(rejectedCli.status, 1);
assert.match(rejectedCli.stderr, /not signed by the trusted Burette publisher/);
assert.doesNotMatch(rejectedCli.stderr, /UNVERIFIED NATIVE COMMAND/);

const packageMetadata = JSON.parse(await readFile(new URL("../packages/burette/package.json", import.meta.url), "utf8"));
assert.equal(packageMetadata.private, true, "the internal installer package must remain unpublished");

for (const publicDoc of ["../README.md", "../packages/burette/README.md", "../docs/releasing.md", "../docs/repository-layout.md"]) {
  const source = await readFile(new URL(publicDoc, import.meta.url), "utf8");
  assert.doesNotMatch(source, /bunx\s+burette\b/u, `${publicDoc} must not direct users to the unrelated npm package`);
}

const root = await mkdtemp(path.join(tmpdir(), "burette-installer-test-"));
const sourceApp = path.join(root, "source", "Burette.app");
const targetApp = path.join(root, "Applications", "Burette.app");
const sourcePayload = path.join(sourceApp, "Contents", "next.txt");
const targetPayload = path.join(targetApp, "Contents", "current.txt");

try {
  const archive = path.join(root, "signed.zip");
  const payload = Buffer.from("synthetic signed archive bytes");
  await writeFile(archive, payload);
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
  const signature = sign(null, payload, keys.privateKey).toString("base64");
  await verifyReleaseArchive(archive, signature, publicKey);
  await assert.rejects(verifyReleaseArchive(archive, signature), /trusted Burette publisher/);
  for (const invalid of ["", "not a signature", "A".repeat(88)]) {
    await assert.rejects(verifyReleaseArchive(archive, invalid, publicKey), /missing or malformed/);
  }
  await writeFile(archive, Buffer.from("tampered archive bytes"));
  await assert.rejects(verifyReleaseArchive(archive, signature, publicKey), /trusted Burette publisher/);

  await mkdir(path.dirname(sourcePayload), { recursive: true });
  await mkdir(path.dirname(targetPayload), { recursive: true });
  await writeFile(sourcePayload, "next");
  await writeFile(targetPayload, "current");

  const failingMove = async (from, to) => {
    if (from.endsWith("Burette.app.updating") && to === targetApp) {
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
  await assert.rejects(readFile(path.join(root, "Applications", "Burette.app.updating", "Contents", "next.txt"), "utf8"));
  await assert.rejects(readFile(path.join(root, "Applications", "Burette.app.previous", "Contents", "current.txt"), "utf8"));

  assert.ok(compareVersions("v0.10.40", "v0.10.39") > 0);
  assert.ok(compareVersions("v0.10.40", "v0.10.40-beta.1") > 0);
  assert.ok(compareVersions("v0.10.40-beta.2", "v0.10.40-beta.1") > 0);

  const releases = [
    { tag_name: "v0.10.39", draft: false, prerelease: false, assets: [{ name: "Burette-0.10.39.zip" }] },
    { tag_name: "v0.10.41-beta.1", draft: false, prerelease: true, assets: [{ name: "Burette-0.10.41-beta.1.zip" }] },
    { tag_name: "v0.10.40", draft: false, prerelease: false, assets: [{ name: "Burette-0.10.40.zip" }] },
    { tag_name: "v0.10.42", draft: true, prerelease: false, assets: [{ name: "Burette-0.10.42.zip" }] },
    { tag_name: "v0.10.43", draft: false, prerelease: false, assets: [{ name: "notes.txt" }] },
  ];
  assert.equal(selectRelease(releases, "stable").tag_name, "v0.10.40");
  assert.equal(selectRelease(releases, "beta").tag_name, "v0.10.41-beta.1");
  assert.equal(findZipAsset(releases[0]).name, "Burette-0.10.39.zip");

  const doctorPaths = new Set([
    "/Applications/Burette.app",
    "/Applications/Burette.app/Contents/PlugIns/BurettePreview.appex",
    "/usr/bin/qlmanage",
  ]);
  const doctorReport = await buildDoctorReport({
    system: true,
    exists: async (candidate) => doctorPaths.has(candidate),
    runCommand: () => ({ status: 0, stdout: "0.10.40\n" }),
  });
  assert.deepEqual(doctorReport.map(item => item.ok), [true, true, true, true]);
  assert.match(doctorReport[3].detail, /0\.10\.40/);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("bun installer behavior tests passed");
