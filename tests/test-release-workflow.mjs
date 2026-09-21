#!/usr/bin/env bun
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(path.join(os.tmpdir(), 'burette-release-test-'));
function write(relative, content, executable = false) {
  const target = path.join(temporary, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, executable ? { mode: 0o755 } : undefined);
}
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith('BURETTE_') && !key.startsWith('APPLE_') && !key.startsWith('GITHUB_')));
try {
  // Execute the real release entrypoint until the build boundary; never build an app.
  const release = readFileSync(path.join(root, 'scripts/release.sh'), 'utf8');
  write('scripts/release.sh', release, true);
  for (const [, asset] of release.matchAll(/^require_asset (.+)$/gm)) write(asset, '/* fixture */');
  for (const tool of ['bun', 'ditto', 'hdiutil', 'shasum', 'xcrun']) write(`bin/${tool}`, '#!/bin/sh\nexit 0\n', true);
  write('scripts/build.sh', '#!/bin/sh\necho "build-mode=$BURETTE_BUILD_MODE;adhoc=$BURETTE_RELEASE_ALLOW_ADHOC"\nexit 77\n', true);
  for (const [mode, expectedStatus, expectedOutput] of [
    [undefined, 77, 'build-mode=release;adhoc=1'],
    ['auto', 77, 'build-mode=release;adhoc=1'],
    ['1', 77, 'build-mode=release;adhoc=1'],
    ['0', 1, 'BURETTE_CODESIGN_IDENTITY must be a Developer ID Application identity'],
  ]) {
    const env = { ...cleanEnv, PATH: `${temporary}/bin:${process.env.PATH}` };
    if (mode !== undefined) env.BURETTE_RELEASE_ALLOW_ADHOC = mode;
    const result = spawnSync('bash', ['scripts/release.sh'], { cwd: temporary, env, encoding: 'utf8' });
    assert.equal(result.status, expectedStatus, result.stderr);
    assert.ok(`${result.stdout}${result.stderr}`.includes(expectedOutput));
  }
  const signed = spawnSync('bash', ['scripts/release.sh'], {
    cwd: temporary, encoding: 'utf8', env: { ...cleanEnv, PATH: `${temporary}/bin:${process.env.PATH}`,
      BURETTE_CODESIGN_IDENTITY: 'Developer ID Application: Fixture (TEAM)',
      BURETTE_DEVELOPMENT_TEAM: 'TEAM', BURETTE_NOTARY_KEYCHAIN_PROFILE: 'Fixture' },
  });
  assert.equal(signed.status, 77, signed.stderr);
  assert.ok(signed.stdout.includes('build-mode=release;adhoc=0'));

  // Run the workflow's release step with a recording gh, including both release channels.
  const workflow = readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
  const block = workflow.split('      - name: Create GitHub release\n')[1].split('\n      - name:')[0];
  const run = block.split('        run: |\n')[1].replace(/^          /gm, '');
  write('bin/gh', '#!/bin/sh\nprintf "%s\\n" "$@"\n', true);
  for (const prerelease of ['false', 'true']) {
    const script = run.replaceAll('${{ steps.version.outputs.version }}', '2.3.10')
      .replaceAll('${{ steps.version.outputs.tag }}', 'v2.3.10')
      .replaceAll('${{ steps.version.outputs.prerelease }}', prerelease);
    const result = spawnSync('bash', ['-e', '-c', script], { cwd: temporary, encoding: 'utf8',
      env: { ...cleanEnv, PATH: `${temporary}/bin:${process.env.PATH}`, GITHUB_SHA: 'a'.repeat(40) } });
    assert.equal(result.status, 0, result.stderr);
    const args = result.stdout.trim().split('\n');
    assert.equal(args[args.indexOf('--target') + 1], 'a'.repeat(40));
    assert.equal(args.includes('--prerelease'), prerelease === 'true');
  }

  // Check the actual version guard against a fixed PR base commit, without fetching.
  for (const source of ['scripts/check-release-version.mjs', 'scripts/bun-lock.mjs', 'apps/desktop/src/lib/semver.ts']) {
    const destination = path.join(temporary, source);
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(path.join(root, source), destination);
  }
  const git = (...args) => execFileSync('git', args, { cwd: temporary, encoding: 'utf8', env: cleanEnv }).trim();
  git('init', '--quiet');
  write('package.json', JSON.stringify({ version: '2.3.10-beta.2' }));
  git('add', 'package.json');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'Fixture');
  const base = git('rev-parse', 'HEAD');
  for (const [version, shouldPass] of [
    ['2.3.9', false], ['1.99.0', false], ['2.3.10-beta.1', false],
    ['2.3.10-beta.2', false], ['2.3.10-alpha.9', false],
    ['2.3.10-beta.10', true], ['2.3.10-rc.1', true], ['2.3.10', true], ['2.4.0', true],
  ]) {
    write('package.json', JSON.stringify({ version }));
    write('bun.lock', JSON.stringify({ workspaces: { 'packages/burette': { version } } }));
    write('apps/desktop/src-tauri/tauri.conf.json', JSON.stringify({ version }));
    write('apps/desktop/src-tauri/Cargo.toml', `version = "${version}"\n`);
    write('Burette.xcodeproj/project.pbxproj', `MARKETING_VERSION = ${version};\n`);
    const result = spawnSync(process.execPath, ['scripts/check-release-version.mjs'], {
      cwd: temporary, encoding: 'utf8', env: { ...cleanEnv, GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_BASE_REF: 'main', BURETTE_PR_BASE_SHA: base },
    });
    assert.equal(result.status, shouldPass ? 0 : 1, `${version}: ${result.stderr}`);
    if (!shouldPass) assert.ok(result.stderr.includes('must advance package.json beyond'));
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
console.log('release workflow regression tests passed');
