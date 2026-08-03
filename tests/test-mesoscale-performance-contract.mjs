#!/usr/bin/env node
import assert from "node:assert/strict";
import { stat, readFile } from "node:fs/promises";

const profiles = JSON.parse(await readFile("config/web-runtime-profiles.json", "utf8")).profiles;
const jsBytes = (await stat("PreviewExtension/Web/mesoscale.js")).size;
const cssBytes = (await stat("PreviewExtension/Web/mesoscale.css")).size;
assert.ok(jsBytes < 6.5 * 1024 * 1024, `Mesoscale JS budget exceeded: ${jsBytes}`);
assert.ok(cssBytes < 100 * 1024, `Mesoscale CSS budget exceeded: ${cssBytes}`);
assert.deepEqual(profiles["desktop-mesoscale"], ["mesoscale.js", "mesoscale.css"]);
assert.ok(!profiles["desktop-molstar"].some((asset) => asset.startsWith("mesoscale")), "ordinary Mol* profile must not retain Mesoscale assets");
assert.ok(!profiles["quicklook-molstar"].some((asset) => asset.startsWith("mesoscale")), "ordinary Quick Look must not retain Mesoscale assets");

console.log(`mesoscale bundle budgets passed (${jsBytes} JS, ${cssBytes} CSS)`);
