#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { transformContentType } from './dev-namespace.mjs';

function usage() {
  console.error('usage: preview-content-type.mjs [--reject-table] /path/to/structure-file');
}

const args = process.argv.slice(2);
const rejectTable = args[0] === '--reject-table';
const filePath = rejectTable ? args[1] : args[0];

if (!filePath) {
  usage();
  process.exit(1);
}

const registryPath = resolve(import.meta.dirname, '..', 'config', 'preview-formats.json');
const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
const fileName = basename(filePath).toLowerCase();
const extension = fileName.endsWith('.mae.gz') ? 'mae.gz' : extname(fileName).slice(1);
const format = registry.formats.find((candidate) => candidate.extensions.includes(extension));

if (rejectTable && (format?.id === 'csv' || format?.id === 'tsv')) {
  console.error('CSV/TSV table previews must be tested with normal Quick Look selection; qlmanage aborts when forcing custom table UTIs.');
  process.exit(2);
}

if (format?.contentType && registry.quickLook.contentTypes.includes(format.contentType)) {
  process.stdout.write(transformContentType(format.contentType));
}
