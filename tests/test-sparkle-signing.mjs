#!/usr/bin/env node
// Real Sparkle signing with an ephemeral key; never touches the login Keychain.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const signer = path.join(root, 'build/sparkle/2.9.6/bin/sign_update');
assert.ok(fs.existsSync(signer), 'Run scripts/prepare-sparkle.sh before this signing integration test');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'burette-sparkle-test-'));
try {
  const seed = crypto.randomBytes(32);
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
  const publicKey = crypto.createPublicKey(privateKey);
  const data = Buffer.from('Burette update signing fixture');
  const archive = path.join(temporary, 'Burette-2.3.19.zip');
  fs.writeFileSync(archive, data);
  const result = spawnSync(signer, ['--ed-key-file', '-', '-p', archive], { input: seed.toString('base64') + '\n', encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const signature = Buffer.from(result.stdout.trim(), 'base64');
  assert.ok(crypto.verify(null, data, publicKey, signature), 'Sparkle signatures verify with the embedded public key');
  assert.equal(crypto.verify(null, Buffer.from('tampered'), publicKey, signature), false);

  const app = path.join(temporary, 'Burette.app');
  fs.mkdirSync(path.join(app, 'Contents/MacOS'), { recursive: true });
  fs.copyFileSync('/usr/bin/true', path.join(app, 'Contents/MacOS/burette'));
  const key = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
  const makePlist = spawnSync('python3', ['-c', 'import plistlib,sys; plistlib.dump(dict(CFBundleIdentifier="com.local.BuretteV10", CFBundleShortVersionString="2.3.19", CFBundleVersion="2.3.19", CFBundleExecutable="burette", LSMinimumSystemVersion="12.0", SUPublicEDKey=sys.argv[2]),open(sys.argv[1],"wb"))', path.join(app, 'Contents/Info.plist'), key]);
  assert.equal(makePlist.status, 0);
  const args = [path.join(root, 'scripts/sparkle-appcast.py'), archive, app, path.join(temporary, 'appcast.xml')];
  const environment = { ...process.env, BURETTE_SPARKLE_PRIVATE_KEY: seed.toString('base64') };
  const feed = spawnSync('python3', args, { env: environment, encoding: 'utf8' });
  assert.equal(feed.status, 0, feed.stderr);
  assert.ok(fs.readFileSync(args[3], 'utf8').includes(result.stdout.trim()));
  const wrongKey = spawnSync('python3', args, { env: { ...environment, BURETTE_SPARKLE_PRIVATE_KEY: crypto.randomBytes(32).toString('base64') }, encoding: 'utf8' });
  assert.notEqual(wrongKey.status, 0, 'A key mismatch must fail before publication');
  console.log('Sparkle signing, tamper rejection, appcast generation and key-pair validation passed');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
