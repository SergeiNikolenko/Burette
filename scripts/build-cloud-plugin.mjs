#!/usr/bin/env node
import { cp, mkdir, readFile, mkdtemp } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(repo, 'plugins/burette-cloud');
const manifest = JSON.parse(await readFile(join(source, '.codex-plugin/plugin.json'), 'utf8'));
const config = JSON.parse(await readFile(join(source, '.mcp.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Invalid version');
if (JSON.stringify(config) !== JSON.stringify({ mcpServers: {
  burette_cloud: { url: 'https://burette-plugin.vercel.app/mcp?client=burette-cloud' },
} })) throw new Error('Cloud package must contain only the production HTTPS MCP');
const outputRoot = resolve(process.argv[2] || join(repo, 'build/cloud-plugin'));
await mkdir(outputRoot, { recursive: true });
// Each build gets a fresh directory: stale files can never enter a new ZIP.
const output = await mkdtemp(join(outputRoot, 'release-'));
const stage = join(output, 'package');
await mkdir(stage);
for (const entry of ['.codex-plugin', '.mcp.json', 'skills', 'README.md']) {
  await cp(join(source, entry), join(stage, entry), { recursive: true });
}
await mkdir(join(stage, 'assets'));
for (const name of ['app-icon.png', 'composer-icon.png']) {
  await cp(join(repo, 'plugins/burette-agent/assets', name), join(stage, 'assets', name));
}
const zip = join(output, `burette-cloud-${manifest.version}.zip`);
execFileSync('zip', ['-q', '-r', zip, '.codex-plugin', '.mcp.json', 'skills', 'assets', 'README.md'], { cwd: stage });
const sha256 = createHash('sha256').update(await readFile(zip)).digest('hex');
console.log(JSON.stringify({ zip, sha256, endpoint: config.mcpServers.burette_cloud.url }, null, 2));
