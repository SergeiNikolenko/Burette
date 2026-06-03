#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = {
  appId: 'com.local.BurreteV10',
  previewId: 'com.local.BurreteV10.Preview',
  thumbnailId: 'com.local.BurreteV10.Thumbnail',
  contentTypePrefix: 'com.local.burrete10.',
  appName: 'Burrete',
};

const PATCH_SKIP_DIRS = new Set([
  '.git',
  '.codegraph',
  'build',
  'node_modules',
  'target',
  'dist',
]);

const PATCH_TEXT_EXTENSIONS = new Set([
  '.json',
  '.mjs',
  '.sh',
  '.rs',
  '.swift',
  '.plist',
  '.pbxproj',
  '.toml',
]);

function normalizeDevFlavor(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  const compact = raw.replace(/[^a-z0-9]+/g, '');
  if (!compact) {
    throw new Error('BURRETE_DEV_FLAVOR must contain at least one ASCII letter or digit.');
  }
  const withLeadingLetter = /^[a-z]/.test(compact) ? compact : `d${compact}`;
  return withLeadingLetter.slice(0, 32);
}

export function namespaceForFlavor(value = process.env.BURRETE_DEV_FLAVOR) {
  const slug = normalizeDevFlavor(value);
  if (!slug) {
    return {
      isDev: false,
      slug: '',
      appId: BASE.appId,
      previewId: BASE.previewId,
      thumbnailId: BASE.thumbnailId,
      contentTypePrefix: BASE.contentTypePrefix,
      appName: BASE.appName,
      appBundleName: `${BASE.appName}.app`,
      pdbContentType: `${BASE.contentTypePrefix}pdb`,
      xyzContentType: `${BASE.contentTypePrefix}xyz`,
    };
  }
  const appName = `${BASE.appName}-${slug}`;
  const contentTypePrefix = `${BASE.contentTypePrefix}dev.${slug}.`;
  return {
    isDev: true,
    slug,
    appId: `${BASE.appId}.Dev.${slug}`,
    previewId: `${BASE.appId}.Dev.${slug}.Preview`,
    thumbnailId: `${BASE.appId}.Dev.${slug}.Thumbnail`,
    contentTypePrefix,
    appName,
    appBundleName: `${appName}.app`,
    pdbContentType: `${contentTypePrefix}pdb`,
    xyzContentType: `${contentTypePrefix}xyz`,
  };
}

export function transformContentType(value, namespace = namespaceForFlavor()) {
  if (!namespace.isDev || typeof value !== 'string') return value;
  return value.replaceAll(BASE.contentTypePrefix, namespace.contentTypePrefix);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function printShellEnv(namespace) {
  const values = {
    BURRETE_IS_DEV_FLAVOR: namespace.isDev ? '1' : '0',
    BURRETE_DEV_FLAVOR_SLUG: namespace.slug,
    BURRETE_APP_ID: namespace.appId,
    BURRETE_PREVIEW_ID: namespace.previewId,
    BURRETE_THUMBNAIL_ID: namespace.thumbnailId,
    BURRETE_CONTENT_TYPE_PREFIX: namespace.contentTypePrefix,
    BURRETE_PDB_CONTENT_TYPE: namespace.pdbContentType,
    BURRETE_XYZ_CONTENT_TYPE: namespace.xyzContentType,
    BURRETE_APP_NAME: namespace.appName,
    BURRETE_APP_BUNDLE_NAME: namespace.appBundleName,
  };
  for (const [key, value] of Object.entries(values)) {
    console.log(`${key}=${shellQuote(value)}`);
  }
}

function transformText(text, namespace) {
  if (!namespace.isDev) return text;
  return text
    .replaceAll(BASE.previewId, '__BURRETE_DEV_PREVIEW_ID__')
    .replaceAll(BASE.thumbnailId, '__BURRETE_DEV_THUMBNAIL_ID__')
    .replaceAll(BASE.appId, '__BURRETE_DEV_APP_ID__')
    .replaceAll(BASE.contentTypePrefix, '__BURRETE_DEV_CONTENT_TYPE_PREFIX__')
    .replaceAll('__BURRETE_DEV_PREVIEW_ID__', namespace.previewId)
    .replaceAll('__BURRETE_DEV_THUMBNAIL_ID__', namespace.thumbnailId)
    .replaceAll('__BURRETE_DEV_APP_ID__', namespace.appId)
    .replaceAll('__BURRETE_DEV_CONTENT_TYPE_PREFIX__', namespace.contentTypePrefix);
}

function shouldPatchFile(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith('project.pbxproj')) return true;
  for (const extension of PATCH_TEXT_EXTENSIONS) {
    if (lower.endsWith(extension)) return true;
  }
  return false;
}

export function patchTree(root, namespace = namespaceForFlavor()) {
  if (!namespace.isDev) return [];
  const changed = [];
  const visit = (path) => {
    const entry = statSync(path);
    if (entry.isDirectory()) {
      const name = path.split('/').pop();
      if (PATCH_SKIP_DIRS.has(name)) return;
      for (const child of readdirSync(path)) {
        visit(join(path, child));
      }
      return;
    }
    if (!entry.isFile() || !shouldPatchFile(path) || entry.size > 1024 * 1024) return;
    const original = readFileSync(path, 'utf8');
    const next = transformText(original, namespace);
    if (next !== original) {
      writeFileSync(path, next);
      changed.push(path);
    }
  };
  visit(root);
  return changed;
}

function usage() {
  console.error('usage: dev-namespace.mjs shell-env|content-type <type>|patch-tree <root>');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
const [command, value] = process.argv.slice(2);
if (isMain && command) {
  try {
    const namespace = namespaceForFlavor();
    if (command === 'shell-env') {
      printShellEnv(namespace);
    } else if (command === 'content-type') {
      if (!value) {
        usage();
        process.exit(2);
      }
      process.stdout.write(transformContentType(value, namespace));
    } else if (command === 'patch-tree') {
      if (!value) {
        usage();
        process.exit(2);
      }
      const changed = patchTree(value, namespace);
      for (const path of changed) console.log(path);
    } else {
      usage();
      process.exit(2);
    }
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(1);
  }
}
