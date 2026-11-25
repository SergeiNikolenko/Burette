#!/usr/bin/env bun
import assert from "node:assert/strict";
import { compareVersions } from "../apps/desktop/src/lib/semver.ts";
import { installAssetFor } from "../apps/desktop/src/update.ts";

assert.equal(compareVersions("v0.10.35-beta.2", "0.10.35-beta.1"), 1);
assert.equal(compareVersions("v0.10.35", "0.10.35-beta.2"), 1);
assert.equal(compareVersions("0.10.35+build.7", "0.10.35"), 0);
assert.equal(compareVersions("1.0.0-alpha", "1.0.0"), -1);
assert.equal(compareVersions("1alpha.2.0", "1.2.0"), -1);
assert.equal(compareVersions("V1.0.1", "1.0.0"), 1);

// Calendar releases must remain upgradeable from the historical semver series.
for (const [next, previous] of [
  ["v2026.9.1", "2.3.22"],
  ["2026.9.2", "2026.9.1"],
  ["2026.10.1", "2026.9.99"],
  ["2027.1.1", "2026.12.99"],
  ["2026.2.0-beta.10", "2026.2.0-beta.2"],
  ["2026.2.0", "2026.2.0-beta.10"],
]) {
  assert.equal(compareVersions(next, previous), 1, `${previous} -> ${next}`);
  assert.equal(compareVersions(previous, next), -1, `${next} must not downgrade`);
}

const windowsSignedAssets = [
  {
    name: "Burette-2026.11.38.zip",
    browser_download_url: "https://github.com/SergeiNikolenko/Burette/releases/download/v2026.11.38/Burette-2026.11.38.zip",
    size: 100_000_000,
  },
  {
    name: "Burette-2026.11.38.zip.sha256",
    browser_download_url: "https://github.com/SergeiNikolenko/Burette/releases/download/v2026.11.38/Burette-2026.11.38.zip.sha256",
    size: 88,
  },
  {
    name: "Burette_2026.11.38_x64-setup.exe",
    browser_download_url: "https://github.com/SergeiNikolenko/Burette/releases/download/v2026.11.38/Burette_2026.11.38_x64-setup.exe",
    size: 90_000_000,
  },
  {
    name: "Burette_2026.11.38_x64-setup.exe.sha256",
    browser_download_url: "https://github.com/SergeiNikolenko/Burette/releases/download/v2026.11.38/Burette_2026.11.38_x64-setup.exe.sha256",
    size: 99,
  },
  {
    name: "Burette_2026.11.38_x64-setup.exe.ed25519",
    browser_download_url: "https://github.com/SergeiNikolenko/Burette/releases/download/v2026.11.38/Burette_2026.11.38_x64-setup.exe.ed25519",
    size: 89,
  },
];

const selectedWin = installAssetFor(windowsSignedAssets, "windows");
assert.equal(selectedWin?.name, "Burette_2026.11.38_x64-setup.exe");
assert.equal(selectedWin?.sha256AssetName, "Burette_2026.11.38_x64-setup.exe.sha256");
assert.equal(selectedWin?.ed25519AssetName, "Burette_2026.11.38_x64-setup.exe.ed25519");

// Releases without both .sha256 and .ed25519 must fall back to the release page on Windows.
assert.equal(
  installAssetFor(windowsSignedAssets.filter((asset) => !asset.name.endsWith(".ed25519")), "windows"),
  null,
);
assert.equal(
  installAssetFor(windowsSignedAssets.filter((asset) => asset.name !== "Burette_2026.11.38_x64-setup.exe.sha256"), "windows"),
  null,
);
assert.equal(installAssetFor(windowsSignedAssets, "macos")?.name, "Burette-2026.11.38.zip");
assert.equal(installAssetFor(windowsSignedAssets, "linux"), null);

console.log("update versioning tests passed");
