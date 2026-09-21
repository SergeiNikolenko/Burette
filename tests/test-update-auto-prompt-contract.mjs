#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const updatesHook = await readFile(resolve("apps/desktop/src/hooks/use-app-updates.ts"), "utf8");
const successfulAutoCheckIndex = updatesHook.indexOf("if (automatic) markAutomaticCheck(true);");
const promptIndex = updatesHook.indexOf("await promptForUpdate(release, automatic);");

assert.notEqual(successfulAutoCheckIndex, -1, "automatic update checks must record successful GitHub checks");
assert.notEqual(promptIndex, -1, "automatic update checks must still prompt for available releases");
assert.ok(
  successfulAutoCheckIndex < promptIndex,
  "automatic update checks must be marked successful before prompting so Later cannot be followed by an immediate duplicate prompt",
);

console.log("update auto prompt contract tests passed");
