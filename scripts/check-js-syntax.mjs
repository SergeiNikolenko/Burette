#!/usr/bin/env bun
import { readFile } from 'node:fs/promises';
import path from 'node:path';

function loaderFor(filePath) {
  const extension = path.extname(filePath);
  switch (extension) {
    case '.ts':
      return 'ts';
    case '.tsx':
      return 'tsx';
    case '.jsx':
      return 'jsx';
    default:
      return 'js';
  }
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('error: expected at least one file path for syntax validation');
  process.exit(1);
}

const transpiler = new Bun.Transpiler();
let failed = false;

for (const filePath of files) {
  const source = await readFile(filePath, 'utf8');
  try {
    transpiler.transformSync(source, loaderFor(filePath));
  } catch (error) {
    console.error(`error: syntax check failed for ${filePath}`);
    console.error(error instanceof Error ? error.message : String(error));
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
