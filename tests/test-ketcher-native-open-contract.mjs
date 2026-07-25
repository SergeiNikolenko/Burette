#!/usr/bin/env bun
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const editor = readFileSync("apps/desktop/src/components/ketcher-editor.tsx", "utf8");
const page = readFileSync("apps/desktop/src/components/ketcher-page.tsx", "utf8");

assert.match(editor, /onOpenFile/);
assert.match(editor, /addEventListener\("click",[\s\S]*true\)/);
assert.match(editor, /\[data-testid=['"]open-file-button['"]\]/);
assert.match(editor, /preventDefault\(\)/);
assert.match(editor, /stopPropagation\(\)/);

assert.match(page, /invoke<string\[\]>\("pick_open_targets"\)/);
assert.match(page, /actions\.openKetcherWithStructures\(paths\)/);
assert.match(page, /onOpenFile=\{chooseKetcherFiles\}/);

console.log("Ketcher native open contract tests passed");
