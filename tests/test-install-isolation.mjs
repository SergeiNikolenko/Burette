import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const source = readFileSync(new URL('../scripts/install-local.sh', import.meta.url), 'utf8');
function section(start, end) {
  const begin = source.indexOf(start);
  const finish = source.indexOf(end, begin);
  assert.ok(begin >= 0 && finish > begin, 'installer cleanup boundaries must exist');
  return source.slice(begin, finish);
}
const registrations = section('unregister_stale_dev_flavor_extensions() {', '\nassert_bundled_xyzrender_runtime() {');
const cleanup = section('mkdir -p "$DEST_DIR"', '\nif [[ -e "$STAGING_DEST" || -e "$DEST" ]]');
const scratch = mkdtempSync(join(tmpdir(), 'burette-install-isolation-'));
try {
  for (const flavor of ['1', '0']) {
    const root = join(scratch, flavor);
    const apps = join(root, 'Applications with spaces');
    const env = {
      ...process.env, ROOT: root, IS_DEV_FLAVOR: flavor, DEST_DIR: apps,
      DEST: join(apps, 'Burette-audit.app'),
      STAGING_DEST: join(apps, '.Burette-audit.installing.app'),
      APP: join(root, 'build/Burette-audit.app'),
      LEGACY_OLD_DEST: join(apps, 'Burette.app'),
      LEGACY_BURET_DEST: join(apps, 'Buret.app'),
      LEGACY_XYZ_DEST: join(apps, 'Burette XYZRender.app'),
      EXT_ID: 'com.local.BuretteV10.dev.audit.Preview',
      AUDIT_CALLS: join(root, 'calls.log'),
      AUDIT_SAME: join(apps, 'Burette-audit-copy.app/Contents/PlugIns/BurettePreview.appex'),
      AUDIT_OTHER: join(apps, 'Burette-other.app/Contents/PlugIns/BurettePreview.appex'),
    };
    env.DEST_APPEX = join(env.DEST, 'Contents/PlugIns/BurettePreview.appex');
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'scripts/prune-launch-services.sh'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
    const legacy = [env.LEGACY_OLD_DEST, env.LEGACY_BURET_DEST, env.LEGACY_XYZ_DEST];
    for (const path of [env.DEST, env.STAGING_DEST, ...legacy, env.AUDIT_OTHER]) mkdirSync(path, { recursive: true });
    const result = spawnSync('bash', ['-c', `
set -euo pipefail
pkill() { printf 'kill %s\\n' "$*" >> "$AUDIT_CALLS"; }
unregister_bundle() { printf 'unregister %s\\n' "$1" >> "$AUDIT_CALLS"; }
unregister_legacy_launch_services_bundles() { printf 'legacy sweep\\n' >> "$AUDIT_CALLS"; }
pluginkit() {
  if [[ "$1" == '-m' ]]; then
    printf '    Path = %s\\n' "$DEST_APPEX" "$AUDIT_SAME" "$AUDIT_OTHER"
  else
    printf 'plugin %s\\n' "$*" >> "$AUDIT_CALLS"
  fi
}
plutil() {
  if [[ "$*" == *"$AUDIT_SAME/Contents/Info.plist"* ]]; then
    printf '%s\\n' "$EXT_ID"
  else
    printf '%s\\n' 'com.local.BuretteV10.dev.other.Preview'
  fi
}
${registrations}
${cleanup}
`], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const calls = readFileSync(env.AUDIT_CALLS, 'utf8');
    assert.equal(existsSync(env.DEST), false);
    assert.equal(existsSync(env.STAGING_DEST), false);
    for (const path of legacy) assert.equal(existsSync(path), flavor === '1', path);
    assert.equal(existsSync(env.AUDIT_OTHER), true);
    if (flavor === '1') {
      for (const path of [...legacy, env.AUDIT_OTHER]) assert.ok(!calls.includes(path), path);
      assert.ok(calls.includes(`unregister ${env.AUDIT_SAME.split('/Contents/PlugIns/')[0]}\n`));
    } else {
      assert.ok(calls.includes('legacy sweep'));
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log('Installer isolation: release apps and other development flavors are preserved.');
