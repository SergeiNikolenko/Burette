#!/usr/bin/env bun
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { replaceInstalledApp } from "../packages/burrete/bin/burrete.mjs";

const root = await mkdtemp(path.join(tmpdir(), "burrete-installer-test-"));
const sourceApp = path.join(root, "source", "Burrete.app");
const targetApp = path.join(root, "Applications", "Burrete.app");
const sourcePayload = path.join(sourceApp, "Contents", "next.txt");
const targetPayload = path.join(targetApp, "Contents", "current.txt");

try {
  await mkdir(path.dirname(sourcePayload), { recursive: true });
  await mkdir(path.dirname(targetPayload), { recursive: true });
  await writeFile(sourcePayload, "next");
  await writeFile(targetPayload, "current");

  const failingMove = async (from, to) => {
    if (from.endsWith("Burrete.app.updating") && to === targetApp) {
      throw new Error("simulated move failure");
    }
    await rename(from, to);
  };

  await assert.rejects(
    replaceInstalledApp({
      sourceApp,
      targetApp,
      copyApp: (from, to) => cp(from, to, { recursive: true }),
      movePath: failingMove,
    }),
    /simulated move failure/,
  );

  assert.equal(await readFile(targetPayload, "utf8"), "current");
  await assert.rejects(readFile(path.join(root, "Applications", "Burrete.app.updating", "Contents", "next.txt"), "utf8"));
  await assert.rejects(readFile(path.join(root, "Applications", "Burrete.app.previous", "Contents", "current.txt"), "utf8"));
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("bun installer behavior tests passed");
