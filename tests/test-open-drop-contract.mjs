#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../apps/desktop/src/hooks/use-open-drop.ts", import.meta.url), "utf8");

assert.match(source, /const fileDrop = Array\.from\(event\.dataTransfer\.types\)\.includes\("Files"\);/);
assert.match(source, /const structureDrop = hasStructureDrag\(event\.dataTransfer\);/);
assert.match(source, /if \(!fileDrop && !structureDrop\) return;/);
assert.match(source, /const payload = structureDrop\s*\?\s*readStructureDragPayload\(event\.dataTransfer\)/);
assert.match(source, /invoke<ClassifiedOpenPaths>\("classify_open_paths", \{ paths: payload\.paths \}\)/);
assert.match(source, /addProjectRoots\?\.\(classified\.directories\);/);
assert.match(source, /if \(classified\.directories\.length > 0\) \{[\s\S]*?addProjectRoots\?\.\(classified\.directories\);[\s\S]*?return;[\s\S]*?\}/);
assert.match(source, /paths: classified\.files/);
assert.match(source, /void runFinderDropAction\(payload, dropTargetForElement\(target\)\);/);
assert.match(source, /runDropAction\(payload, dropTargetForElement\(target\), \{ kind: "unknown" \}\);/);

assert.match(source, /const hasPlainText = Array\.from\(event\.clipboardData\.types\)\.includes\("text\/plain"\);/);
assert.match(source, /pushStatus\("Clipboard text is not a supported molecular structure or path list\.", "error"\);/);
assert.match(source, /runDropAction\(payload, dropTargetForElement\(target\), \{ kind: "clipboard" \}\);/);

assert.match(source, /const openClipboardText = useCallback\(\(text: string\) => \{/);
assert.match(source, /const payload = structureDragPayloadFromText\(text\);/);
assert.match(source, /if \(payload\.paths\.length === 0 && payload\.records\.length === 0\) return false;/);
assert.match(source, /runDropAction\(payload, dropTargetForClipboard\(\), \{ kind: "clipboard" \}\);/);
assert.match(source, /return true;/);

console.log("open drop contract tests passed");
