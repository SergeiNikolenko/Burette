#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("usage: bun scripts/set-release-version.mjs <semver>");
  process.exit(1);
}

function writeJson(path, update) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  update(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function replaceChecked(path, pattern, replacement, expectedCount = 1) {
  const source = readFileSync(path, "utf8");
  const matches = [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))];
  if (matches.length !== expectedCount) {
    throw new Error(`${path}: expected ${expectedCount} version field(s), found ${matches.length}`);
  }
  writeFileSync(path, source.replace(pattern, replacement));
}

writeJson("package.json", (value) => {
  value.version = version;
});
writeJson("packages/burette/package.json", (value) => {
  value.version = version;
});
writeJson("apps/desktop/src-tauri/tauri.conf.json", (value) => {
  value.version = version;
});

replaceChecked(
  "bun.lock",
  /("packages\/burette": \{\n\s+"name": "burette",\n\s+"version": ")[^"]+(")/,
  `$1${version}$2`,
);
replaceChecked(
  "apps/desktop/src-tauri/Cargo.toml",
  /(\[package\]\nname = "burette"\nversion = ")[^"]+(")/,
  `$1${version}$2`,
);
for (const path of ["Cargo.lock", "apps/desktop/src-tauri/Cargo.lock"]) {
  replaceChecked(
    path,
    /(\[\[package\]\]\nname = "burette"\nversion = ")[^"]+(")/,
    `$1${version}$2`,
  );
}

const projectPath = "Burette.xcodeproj/project.pbxproj";
const project = readFileSync(projectPath, "utf8");
const marketingVersions = [...project.matchAll(/MARKETING_VERSION = [^;]+;/g)];
if (marketingVersions.length === 0) {
  throw new Error(`${projectPath}: no MARKETING_VERSION fields found`);
}
writeFileSync(
  projectPath,
  project.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`),
);

console.log(`Synchronized Burette release metadata to ${version}.`);
