#!/usr/bin/env bun
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const perfSmoke = await readFile(new URL("../scripts/perf-smoke.sh", import.meta.url), "utf8");
const ciFast = await readFile(new URL("../scripts/ci-fast.sh", import.meta.url), "utf8");

assert.match(perfSmoke, /RUN_GUI="\$\{BURRETE_PERF_RUN_GUI:-1\}"/);
assert.match(perfSmoke, /RUN_QUICKLOOK="\$\{BURRETE_PERF_RUN_QUICKLOOK:-1\}"/);
assert.match(perfSmoke, /QUICKLOOK_FILE="\$\{BURRETE_PERF_QUICKLOOK_FILE:-\$PDB_FILE\}"/);
assert.match(perfSmoke, /if \[\[ "\$RUN_GUI" != "1" \]\]; then/);
assert.match(perfSmoke, /if \[\[ "\$RUN_QUICKLOOK" != "1" \]\]; then/);
assert.match(perfSmoke, /"\$ROOT\/scripts\/measure-quicklook-cold-open\.sh" "\$QUICKLOOK_FILE"/);
assert.match(perfSmoke, /RUNS="\$\{BURRETE_QUICKLOOK_RUNS:-1\}"/);
assert.match(perfSmoke, /BURRETE_PERF_RUN_GRID_FTS:-0/);

assert.doesNotMatch(ciFast, /perf-smoke\.sh/);
assert.doesNotMatch(ciFast, /force-preview\.sh/);
assert.doesNotMatch(ciFast, /qlmanage/);
assert.doesNotMatch(ciFast, /open -n -a/);

console.log("runner contract tests passed");
