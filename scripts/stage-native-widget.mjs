#!/usr/bin/env node
// Package the preserved native widget without replacing current desktop sources.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pin = JSON.parse(readFileSync(path.join(root, 'config/native-widget.json'), 'utf8'));
if (!/^[a-f0-9]{40}$/.test(pin.commit)) throw new Error('Invalid native widget commit');
const output = path.join(root, 'plugins/burette-native-bundle');

function verify(directory) {
  const manifest = JSON.parse(readFileSync(path.join(directory, '.codex-plugin/plugin.json')));
  if (manifest.name !== 'burette' || manifest.version !== pin.version) throw new Error('Native widget version mismatch');
  for (const file of ['assets/native-workspace.html', 'assets/local-viewer.html',
    'mcp/registrations/local-viewer/register.mjs', 'mcp/lib/server-bundle.mjs',
    'scripts/mcp-app-session.mjs', 'scripts/install-local.mjs']) {
    if (!existsSync(path.join(directory, file))) throw new Error(`Missing native widget file: ${file}`);
  }
  const assets = JSON.parse(readFileSync(path.join(directory, 'assets/native-workspace/manifest.json'))).assets;
  for (const asset of Object.values(assets)) {
    if (!/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('Invalid widget asset hash');
    const bytes = gunzipSync(readFileSync(path.join(directory, 'assets/native-workspace', `${asset.sha256}.gz`)));
    if (bytes.length !== asset.byteCount || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
      throw new Error('Native widget asset integrity mismatch');
    }
  }
}

// Isolated native build trees have no .git. They receive the verified stage
// from build.sh before its rsync; never silently fall back to the old plugin.
if (!existsSync(path.join(root, '.git'))) {
  const receipt = JSON.parse(readFileSync(path.join(output, '.native-widget-source.json')));
  if (receipt.commit !== pin.commit) throw new Error('Stale native widget stage');
  verify(output);
} else {
  const git = args => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  try { git(['cat-file', '-e', `${pin.commit}^{commit}`]); }
  catch { git(['fetch', '--no-tags', 'origin', pin.commit]); }
  // Reject symlinks before unpacking this trusted, immutable repository tree.
  const entries = git(['ls-tree', '-r', pin.commit, 'plugins/burette-agent']).toString();
  if (!entries || entries.split('\n').some(line => line.startsWith('120000 '))) throw new Error('Unsafe or empty plugin tree');
  const scratch = mkdtempSync(path.join(tmpdir(), 'burette-widget-stage-'));
  try {
    const archive = path.join(scratch, 'widget.tar');
    git(['archive', '--format=tar', `--output=${archive}`, pin.commit, 'plugins/burette-agent']);
    execFileSync('tar', ['-xf', archive, '-C', scratch]);
    const staged = path.join(scratch, 'plugins/burette-agent');
    verify(staged);
    writeFileSync(path.join(staged, '.native-widget-source.json'), JSON.stringify(pin) + '\n');
    rmSync(output, { recursive: true, force: true });
    // Staging and destination can be on different volumes.
    execFileSync('rsync', ['-a', `${staged}/`, `${output}/`]);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
console.log(JSON.stringify({ nativeWidget: pin.version, commit: pin.commit, verified: true }));
