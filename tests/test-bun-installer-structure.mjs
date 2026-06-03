#!/usr/bin/env bun
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../packages/burrete/bin/burrete.mjs", import.meta.url), "utf8");

assert.match(source, /const stageApp = path\.join\(installDir, `\$\{APP_NAME\}\.updating`\);/);
assert.match(source, /const backupApp = path\.join\(installDir, `\$\{APP_NAME\}\.previous`\);/);
assert.match(source, /await movePath\(targetApp, backupApp\);/);
assert.match(source, /await movePath\(stageApp, targetApp\);/);
assert.match(source, /if \(await exists\(targetApp\)\) \{\s*await removePath\(targetApp\);\s*\}/);
assert.match(source, /await movePath\(backupApp, targetApp\);/);
assert.match(source, /const RELEASES_URL = `https:\/\/api\.github\.com\/repos\/\$\{OWNER\}\/\$\{REPO\}\/releases`;/);
assert.match(source, /if \(arg === '--beta'\) \{\s*setChannel\('beta'\);/);
assert.match(source, /sort\(\(left, right\) => compareVersions\(right\.tag_name, left\.tag_name\)\)/);
assert.match(source, /run\('\/usr\/bin\/qlmanage', \['-r', 'cache'\]/);
assert.match(source, /run\('\/usr\/bin\/killall', \['quicklookd'\]/);
assert.match(source, /export async function replaceInstalledApp\(/);
assert.match(source, /export function compareVersions\(/);
assert.match(source, /export function selectRelease\(/);
assert.match(source, /export function findZipAsset\(/);
assert.match(source, /export async function buildDoctorReport\(/);
assert.match(source, /if \(command === 'doctor'\)/);
assert.match(source, /Burrete doctor/);
assert.match(source, /Quick Look extension/);
assert.match(source, /Quick Look reset tool/);
assert.match(source, /Install scope: \$\{installScope\} \(\$\{installDir\}\)\./);
assert.match(source, /Next steps:/);
assert.match(source, /Run `burrete doctor` if Finder previews do not appear\./);
assert.match(source, /BURRETE_LAUNCH_MODE=register/);

console.log("bun installer structure tests passed");
