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
// GIT_* is dropped too: git hooks (pre-push runs this suite) export GIT_DIR and
// friends, which would point the fixture repository at the outer checkout.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith('BURETTE_') && !key.startsWith('APPLE_') && !key.startsWith('GITHUB_') && !key.startsWith('GIT_')));
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
    const env = { ...cleanEnv, PATH: `${temporary}/bin:${process.env.PATH}`,
      BURETTE_SPARKLE_PUBLIC_KEY: 'fixture', BURETTE_SPARKLE_PRIVATE_KEY: 'fixture' };
    if (mode !== undefined) env.BURETTE_RELEASE_ALLOW_ADHOC = mode;
    const result = spawnSync('bash', ['scripts/release.sh'], { cwd: temporary, env, encoding: 'utf8' });
    assert.equal(result.status, expectedStatus, result.stderr);
    assert.ok(`${result.stdout}${result.stderr}`.includes(expectedOutput));
  }
  const signed = spawnSync('bash', ['scripts/release.sh'], {
    cwd: temporary, encoding: 'utf8', env: { ...cleanEnv, PATH: `${temporary}/bin:${process.env.PATH}`,
      BURETTE_CODESIGN_IDENTITY: 'Developer ID Application: Fixture (TEAM)',
      BURETTE_DEVELOPMENT_TEAM: 'TEAM', BURETTE_NOTARY_KEYCHAIN_PROFILE: 'Fixture',
      BURETTE_SPARKLE_PUBLIC_KEY: 'fixture', BURETTE_SPARKLE_PRIVATE_KEY: 'fixture' },
  });
  assert.equal(signed.status, 77, signed.stderr);
  assert.ok(signed.stdout.includes('build-mode=release;adhoc=0'));

  for (const keys of [{}, { BURETTE_SPARKLE_PUBLIC_KEY: 'fixture' }]) {
    const result = spawnSync('bash', ['scripts/release.sh'], { cwd: temporary, encoding: 'utf8',
      env: { ...cleanEnv, PATH: `${temporary}/bin:${process.env.PATH}`, BURETTE_RELEASE_ALLOW_ADHOC: '1', ...keys } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Sparkle .*key is required/);
    assert.ok(!result.stdout.includes('build-mode='));
  }

  // Follow local packaging through its real script; native tools are inert fixtures.
  write('scripts/build.sh', '#!/bin/sh\nmkdir -p build/Burette.app\n', true);
  write('scripts/check-release-signature.sh', '#!/bin/sh\nexit 0\n', true);
  write('scripts/create-dmg.sh', '#!/bin/sh\nprintf fixture > "$2"\n', true);
  write('bin/bun', '#!/bin/sh\nif [ "$1" = "--eval" ]; then echo 2.3.10; fi\n', true);
  write('bin/ditto', '#!/bin/bash\nprintf fixture > "${@: -1}"\n', true);
  write('bin/python3', '#!/bin/sh\nprintf "%s\\n" "$@" > signing-arguments\nexit "${FIXTURE_SIGNER_STATUS:-0}"\n', true);
  for (const signerStatus of ['0', '9']) {
    const result = spawnSync('bash', ['scripts/release.sh'], { cwd: temporary, encoding: 'utf8', env: {
      ...cleanEnv, PATH: `${temporary}/bin:${process.env.PATH}`, FIXTURE_SIGNER_STATUS: signerStatus,
      BURETTE_SPARKLE_PUBLIC_KEY: 'fixture', BURETTE_SPARKLE_PRIVATE_KEY: 'fixture',
    } });
    assert.equal(result.status, Number(signerStatus), result.stderr);
    assert.deepEqual(readFileSync(path.join(temporary, 'signing-arguments'), 'utf8').trim().split('\n'), [
      path.join(temporary, 'scripts/sparkle-appcast.py'), path.join(temporary, 'build/release/Burette-2.3.10.zip'),
      path.join(temporary, 'build/Burette.app'), path.join(temporary, 'build/release/appcast.xml'),
      '--asset', path.join(temporary, 'build/release/Burette-2.3.10.dmg'),
    ]);
    assert.equal(result.stdout.includes('Release app:'), signerStatus === '0');
  }
  rmSync(path.join(temporary, 'bin/python3'));

  // Run the workflow's release step with a recording gh, including both release channels.
  const workflow = readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
  const capabilities = workflow.split('      - name: Resolve release capabilities\n')[1]
    .split('      - name: Import Developer ID certificate')[0].split('        run: |\n')[1].replace(/^          /gm, '');
  const appleKeys = ['MACOS_CERTIFICATE_P12_BASE64', 'MACOS_CERTIFICATE_PASSWORD', 'MACOS_KEYCHAIN_PASSWORD',
    'BURETTE_CODESIGN_IDENTITY', 'APPLE_TEAM_ID', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD'];
  for (const [keys, status, expected] of [
    [{}, 0, 'developer_id=false\nallow_adhoc=true'],
    [Object.fromEntries(appleKeys.map(key => [key, 'fixture'])), 0, 'developer_id=true\nallow_adhoc=false'],
    [{ APPLE_TEAM_ID: 'fixture' }, 1, ''],
  ]) {
    const output = path.join(temporary, 'outputs');
    writeFileSync(output, '');
    const result = spawnSync('bash', ['-e', '-c', capabilities], { cwd: temporary, encoding: 'utf8',
      env: { ...cleanEnv, ...Object.fromEntries(appleKeys.map(key => [key, ''])), ...keys, GITHUB_OUTPUT: output } });
    assert.equal(result.status, status, result.stderr);
    if (status === 0) assert.ok(readFileSync(output, 'utf8').includes(expected));
    else assert.match(result.stdout, /partially configured/);
  }
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

  const tapBlock = workflow.split('      - name: Update Homebrew cask\n')[1];
  const tapRun = tapBlock.split('        run: |\n')[1].split('\n      - name:')[0]
    .replace(/^          /gm, '').replaceAll('${{ steps.version.outputs.version }}', '2.3.19');
  write('bin/git', '#!/bin/sh\nexit 0\n', true);
  write('Burette-2.3.19.zip.sha256', 'a'.repeat(64) + '  Burette-2.3.19.zip\n');
  write('tap/Casks/burette.rb', `cask "burette" do\n  version "2.3.18"\n  sha256 "${'b'.repeat(64)}"\n  depends_on macos: :monterey\n  app "Burette.app"\nend\n`);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = spawnSync('bash', ['-e', '-c', tapRun], { cwd: path.join(temporary, 'tap'), encoding: 'utf8',
      env: { ...cleanEnv, PATH: `${temporary}/bin:${process.env.PATH}` } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(path.join(temporary, 'tap/Casks/burette.rb'), 'utf8'),
      `cask "burette" do\n  version "2.3.19"\n  sha256 "${'a'.repeat(64)}"\n  auto_updates true\n  depends_on arch: :arm64\n  depends_on macos: :monterey\n  app "Burette.app"\nend\n`);
  }
  rmSync(path.join(temporary, 'bin/git'));

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
