#!/usr/bin/env node
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { createReadStream, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const MAX_ASSET_BYTES = 1024 * 1024 * 1024;
const DEFAULT_PUBLIC_KEY_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../packages/burette/bin/release-signing-key.txt',
);

async function sha256Hex(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

export function loadSigningKeys({
  privateKeyBase64 = process.env.BURETTE_SPARKLE_PRIVATE_KEY ?? '',
  publicKeyPath = DEFAULT_PUBLIC_KEY_PATH,
} = {}) {
  const trimmedPrivate = privateKeyBase64.trim();
  if (!trimmedPrivate) {
    throw new Error('BURETTE_SPARKLE_PRIVATE_KEY is required to sign release assets.');
  }
  const seed = Buffer.from(trimmedPrivate, 'base64');
  if (seed.length !== 32 || seed.toString('base64') !== trimmedPrivate) {
    throw new Error('BURETTE_SPARKLE_PRIVATE_KEY must be a base64-encoded 32-byte Ed25519 seed.');
  }

  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = createPublicKey(privateKey);
  const derivedPublicBase64 = publicKey
    .export({ format: 'der', type: 'spki' })
    .subarray(-32)
    .toString('base64');

  const pinnedPublicBase64 = readFileSync(publicKeyPath, 'utf8').trim();
  if (derivedPublicBase64 !== pinnedPublicBase64) {
    throw new Error('Signing key does not match the pinned release public key.');
  }

  return { privateKey, publicKey };
}

export async function signReleaseAsset(assetPath, keys = loadSigningKeys()) {
  const size = statSync(assetPath).size;
  if (size <= 0 || size > MAX_ASSET_BYTES) {
    throw new Error(`Release asset size is invalid for ${assetPath}: ${size} bytes.`);
  }
  const bytes = readFileSync(assetPath);
  const signatureBuffer = sign(null, bytes, keys.privateKey);
  if (signatureBuffer.length !== 64 || !verify(null, bytes, keys.publicKey, signatureBuffer)) {
    throw new Error(`Generated Ed25519 signature failed self-verification for ${assetPath}.`);
  }
  const signatureBase64 = signatureBuffer.toString('base64');
  const digestHex = await sha256Hex(assetPath);
  const baseName = path.basename(assetPath);

  const signaturePath = `${assetPath}.ed25519`;
  const digestPath = `${assetPath}.sha256`;
  writeFileSync(signaturePath, `${signatureBase64}\n`, 'utf8');
  writeFileSync(digestPath, `${digestHex}  ${baseName}\n`, 'utf8');
  return { digestHex, digestPath, signatureBase64, signaturePath };
}

async function main() {
  let publicKeyPath = DEFAULT_PUBLIC_KEY_PATH;
  const assets = [];
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--public-key') {
      const next = args[index + 1];
      if (!next) {
        throw new Error('Missing path after --public-key.');
      }
      publicKeyPath = path.resolve(next);
      index += 1;
      continue;
    }
    assets.push(arg);
  }
  if (assets.length === 0) {
    throw new Error('Usage: sign-release-asset.mjs [--public-key <file>] <asset>...');
  }
  const keys = loadSigningKeys({ publicKeyPath });
  for (const asset of assets) {
    const result = await signReleaseAsset(path.resolve(asset), keys);
    console.log(`Signed ${path.basename(asset)} (${result.digestHex.slice(0, 12)}...)`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
