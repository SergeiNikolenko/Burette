#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageInfo = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const zipPath = path.resolve(process.argv[2] || '');
const outputDir = path.resolve(process.argv[3] || path.dirname(zipPath));
const privateKeyPem = process.env.BURRETE_UPDATE_MANIFEST_PRIVATE_KEY_PEM;

if (!zipPath || !fs.existsSync(zipPath)) {
  console.error('usage: scripts/sign-update-manifest.mjs /path/to/Burrete-version.zip [output-dir]');
  process.exit(1);
}
if (!privateKeyPem) {
  console.error('error: BURRETE_UPDATE_MANIFEST_PRIVATE_KEY_PEM is required to sign update manifests.');
  process.exit(1);
}

const version = packageInfo.version;
const tagName = `v${version}`;
const assetName = path.basename(zipPath);
const archiveBytes = fs.readFileSync(zipPath);
const manifestName = `${assetName}.manifest.json`;
const manifest = {
  schemaVersion: 1,
  tagName,
  version,
  assetName,
  assetUrl: `https://github.com/SergeiNikolenko/Burrete/releases/download/${tagName}/${assetName}`,
  assetSize: archiveBytes.length,
  assetSha256: crypto.createHash('sha256').update(archiveBytes).digest('hex'),
  bundleId: 'com.local.BurreteV10',
  extensionId: 'com.local.BurreteV10.Preview',
  minimumSystemVersion: '12.0',
};

fs.mkdirSync(outputDir, { recursive: true });
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
const signature = crypto.sign(null, manifestBytes, crypto.createPrivateKey(privateKeyPem));
const manifestPath = path.join(outputDir, manifestName);
fs.writeFileSync(manifestPath, manifestBytes);
fs.writeFileSync(`${manifestPath}.sig`, `${signature.toString('hex')}\n`);

console.log(`Signed update manifest: ${manifestPath}`);
console.log(`Signature: ${manifestPath}.sig`);
