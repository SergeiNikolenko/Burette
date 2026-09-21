#!/usr/bin/env bun
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng, renderSkySupersampled } from "../scripts/render-dmg-sky.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const digest = (value) => createHash("sha256").update(value).digest("hex");

const rgb = renderSkySupersampled(32, 20, 37.5, undefined, 2);
assert.equal(rgb.length, 32 * 20 * 3);
assert.equal(
  digest(rgb),
  "a7e6075d457ce52a2bcbcba4ac938b14bdad9644596a22d1a8a37ab3bcc9ba41",
  "the deterministic cloud frame changed",
);

const png = encodePng(32, 20, rgb);
assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
assert.equal(png.readUInt32BE(16), 32);
assert.equal(png.readUInt32BE(20), 20);
assert.equal(
  digest(png),
  "ec99440d39398495989e0950ecbe87d19bf722d24be67bb16dc3ca8f6cef3240",
  "the deterministic PNG encoding changed",
);

const sky = readFileSync(join(repoRoot, "packaging/dmg/sky.png"));
assert.equal(sky.readUInt32BE(16), 1320);
assert.equal(sky.readUInt32BE(20), 800);

if (process.platform === "darwin") {
  const tiffInfo = execFileSync(
    "/usr/bin/tiffutil",
    ["-info", join(repoRoot, "packaging/dmg/background.tiff")],
    { encoding: "utf8" },
  );
  assert.match(tiffInfo, /Image Width: 660 Image Length: 400[\s\S]*Resolution: 72, 72/u);
  assert.match(tiffInfo, /Image Width: 1320 Image Length: 800[\s\S]*Resolution: 144, 144/u);
}

console.log("DMG background contract OK");
