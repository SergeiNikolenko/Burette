import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const build = new URL("../compute/symmetry-wasm/", import.meta.url);
const engines = new URL("../apps/desktop/src/lib/molecular-workbench/symmetry/", import.meta.url);
const record = (name: string) => new Map(readFileSync(new URL(name, build), "utf8").trim().split("\n")
  .map(line => { const [hash, path] = line.split(/\s+/u); return [path, hash]; }));

test("distributed symmetry modules match their paired build outputs", () => {
  const outputs = record("outputs.sha256");
  expect([...outputs.keys()]).toEqual(["burette-msym.wasm", "burette-niggli.wasm"]);
  expect(new Map([...outputs.keys()].map(name => [name, digest(readFileSync(new URL(name, engines)))]))).toEqual(outputs);
});

test("retained upstream licenses match the exact pinned source checksums", () => {
  const sources = record("sources.sha256");
  expect([sources.get("libmsym/LICENSE"), sources.get("spglib/COPYING")])
    .toEqual([digest(readFileSync(new URL("LIBMSYM_LICENSE.txt", build))), digest(readFileSync(new URL("SPGLIB_LICENSE.txt", build)))]);
});

test("retained Avogadro attribution license matches the cached source-tree identity", () => {
  const reference = JSON.parse(readFileSync(new URL("avogadro-presets-reference.json", build), "utf8"));
  const license = readFileSync(new URL("AVOGADRO_LICENSE.txt", build));
  const blob = createHash("sha1").update(`blob ${license.length}\0`).update(license).digest("hex");
  expect({ sha256: digest(license), blob, bytes: license.length })
    .toEqual({ sha256: reference.license.sha256, blob: reference.license.blob, bytes: reference.license.bytes });
});
