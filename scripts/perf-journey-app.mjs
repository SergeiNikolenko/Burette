// Packaged development-app lifecycle and bounded trace reading for perf-journeys.mjs.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const agentCli = join(repoRoot, 'scripts/burette-agent.mjs');
const sleep = ms => new Promise(done => setTimeout(done, ms));

function plistValue(plist, key) {
  return execFileSync('plutil', ['-extract', key, 'raw', '-o', '-', plist], { encoding: 'utf8' }).trim();
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hidIdleSeconds() {
  const output = execFileSync('ioreg', ['-c', 'IOHIDSystem', '-d', '4'], { encoding: 'utf8' });
  const match = output.match(/"HIDIdleTime" = (\d+)/);
  return match ? Number(match[1]) / 1e9 : Infinity;
}

function frontmostBundleId() {
  const front = spawnSync('lsappinfo', ['front'], { encoding: 'utf8' }).stdout.trim();
  const info = spawnSync('lsappinfo', ['info', '-only', 'bundleid', front], { encoding: 'utf8' }).stdout;
  return info.match(/bundleID="([^"]+)"/)?.[1] ?? null;
}

function runningBundlePids(bundleId) {
  const script = `ObjC.import('AppKit');
    const apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier(${JSON.stringify(bundleId)});
    const pids = []; for (let i = 0; i < apps.count; i++) pids.push(apps.objectAtIndex(i).processIdentifier);
    JSON.stringify(pids);`;
  return JSON.parse(execFileSync('osascript', ['-l', 'JavaScript', '-e', script], { encoding: 'utf8' }));
}

function screens() {
  const script = `ObjC.import('AppKit');
    const list = $.NSScreen.screens; const out = [];
    for (let i = 0; i < list.count; i++) {
      const s = list.objectAtIndex(i); const f = s.frame; const v = s.visibleFrame;
      out.push({ name: s.localizedName.js, frame: [f.origin.x, f.origin.y, f.size.width, f.size.height],
        visible: [v.origin.x, v.origin.y, v.size.width, v.size.height], scale: s.backingScaleFactor,
        fps: s.maximumFramesPerSecond });
    }
    JSON.stringify(out);`;
  return JSON.parse(execFileSync('osascript', ['-l', 'JavaScript', '-e', script], { encoding: 'utf8' }));
}

class Trace {
  constructor(path) {
    this.path = path;
    this.offset = 0;
    this.partial = '';
    this.lines = [];
    this.captureFrom = Date.now();
    this.evidencePath = null;
    this.identity = null;
  }

  sync() {
    let size;
    try {
      const info = statSync(this.path);
      size = info.size;
      const identity = `${info.dev}:${info.ino}`;
      if (this.identity !== identity) {
        this.offset = 0;
        this.partial = '';
        this.identity = identity;
      }
    } catch {
      return;
    }
    if (size < this.offset) {
      this.offset = 0;
      this.partial = '';
    }
    if (size === this.offset) return;
    const buffer = Buffer.alloc(size - this.offset);
    const fd = openSync(this.path, 'r');
    try {
      readSync(fd, buffer, 0, buffer.length, this.offset);
    } finally {
      closeSync(fd);
    }
    this.offset = size;
    const parts = (this.partial + buffer.toString('utf8')).split('\n');
    this.partial = parts.pop();
    for (const part of parts) {
      try {
        const line = JSON.parse(part);
        this.lines.push(line);
        if (this.evidencePath && line.at >= this.captureFrom) appendFileSync(this.evidencePath, `${part}\n`);
      } catch {
        // A torn line from a concurrent append; the writer never splits one.
      }
    }
  }

  // Drops lines older than `at` so a long benchmark keeps a bounded buffer.
  forget(at) {
    this.lines = this.lines.filter(line => line.at >= at);
  }

  async waitFor(label, predicate, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      this.sync();
      const found = this.lines.find(predicate);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${label}.`);
      await sleep(50);
    }
  }

  between(from, to) {
    return this.lines.filter(line => line.at >= from && line.at <= to);
  }
}

export class PerfApp {
  constructor(path, options) {
    this.path = resolve(path);
    if (!existsSync(this.path)) throw new Error(`App bundle not found: ${this.path}`);
    const plist = join(this.path, 'Contents/Info.plist');
    this.bundleId = plistValue(plist, 'CFBundleIdentifier');
    if (!this.bundleId.startsWith('com.local.BuretteV10.Dev.')) throw new Error('Journey benchmarks require a namespaced development app.');
    this.version = plistValue(plist, 'CFBundleShortVersionString');
    this.executable = join(this.path, 'Contents/MacOS', plistValue(plist, 'CFBundleExecutable'));
    const existing = spawnSync('pgrep', ['-f', `^${escapeRegex(this.executable)}( |$)`], { encoding: 'utf8' });
    if (existing.stdout.trim()) throw new Error('This app is already running; the benchmark will not take over an existing session.');
    this.owned = false;
    this.executableSha256 = createHash('sha256').update(readFileSync(this.executable)).digest('hex');
    this.cacheDir = join(homedir(), 'Library/Caches', this.bundleId);
    this.supportDir = join(homedir(), 'Library/Application Support', this.bundleId);
    this.trace = new Trace(join(this.cacheDir, 'PerfTrace.jsonl'));
    this.options = options;
    this.sessionDir = mkdtempSync(join(tmpdir(), 'burette-perf-session-'));
    writeFileSync(join(this.sessionDir, 'session.json'), JSON.stringify({
      apiVersion: 'burette-agent-cli/v1',
      mode: 'desktop-app',
      token: randomUUID(),
      createdAt: new Date().toISOString(),
      initialPaths: [],
    }, null, 2));
    writeFileSync(join(this.sessionDir, 'actions.json'), JSON.stringify({ apiVersion: 'burette-agent-control/v1', actions: [] }, null, 2));
  }

  pids() {
    if (!this.owned) return [];
    const result = spawnSync('pgrep', ['-f', `^${escapeRegex(this.executable)} .*--burette-agent-session ${escapeRegex(this.sessionDir)}( |$)`], { encoding: 'utf8' });
    return result.stdout.split('\n').filter(Boolean).map(Number);
  }

  // Puts the next window on a screen the user is not working on, so it is
  // visible (WebKit throttles occluded windows) without covering their work.
  placeWindow() {
    const list = screens();
    const primary = list[0];
    const target = this.options.screen === 'main'
      ? primary
      : list.find(screen => this.options.screen === 'built-in' && /built-in/i.test(screen.name))
        ?? list.find((_, index) => index > 0)
        ?? primary;
    const [vx, vy, vw, vh] = target.visible;
    const width = Math.min(1180, Math.floor(vw) - 24);
    const height = Math.min(760, Math.floor(vh) - 24);
    const left = vx + (vw - width) / 2;
    const top = primary.frame[3] - (vy + vh) + (vh - height) / 2;
    const scale = target.scale;
    mkdirSync(this.supportDir, { recursive: true });
    writeFileSync(join(this.supportDir, 'workspace-windows.json'), JSON.stringify({
      version: 1,
      windows: [{
        label: 'main',
        geometry: {
          x: Math.round(left * scale),
          y: Math.round(top * scale),
          width: Math.round(width * scale),
          height: Math.round(height * scale),
          maximized: false,
          fullscreen: false,
        },
      }],
      activeLabel: null,
    }, null, 2));
    return { name: target.name, fps: target.fps, width, height };
  }

  async waitForIdle() {
    let warned = false;
    while (hidIdleSeconds() < this.options.idleSeconds) {
      if (!warned) console.error(`Waiting for ${this.options.idleSeconds} s of keyboard and mouse idle before taking focus...`);
      warned = true;
      await sleep(250);
    }
  }

  async launch() {
    if (runningBundlePids(this.bundleId).length) throw new Error(`${this.bundleId} is already running; existing sessions are never taken over.`);
    this.screen = this.placeWindow();
    await this.waitForIdle();
    const previous = frontmostBundleId();
    this.trace.sync();
    const startedAt = Date.now();
    execFileSync('open', ['-n', '-g', '--env', 'BURETTE_PERF_TRACE=1', this.path, '--args', '--burette-agent-session', this.sessionDir]);
    this.owned = true;
    // The app activates itself when its window shows. Hand focus back the
    // moment it does; `open -b` needs no Automation consent.
    let shell = null;
    let restored = !previous || previous === this.bundleId;
    const deadline = Date.now() + 60_000;
    while (!shell || Date.now() < shell.at + 1_500) {
      if (!restored && frontmostBundleId() === this.bundleId) {
        spawnSync('open', ['-b', previous]);
        restored = true;
      }
      this.trace.sync();
      shell ??= this.trace.lines.find(line => line.name === 'mark:app:shell-visible' && line.at >= startedAt) ?? null;
      if (!shell && Date.now() > deadline) throw new Error('Timed out after 60000 ms waiting for the shell to paint.');
      await sleep(50);
    }
    return { startedAt, shell };
  }

  async quit() {
    if (!this.pids().length) return;
    await this.closeAllTabs().catch(() => {});
    for (const pid of this.pids()) {
      spawnSync('osascript', ['-l', 'JavaScript', '-e', `ObjC.import('AppKit'); $.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid}).terminate();`]);
    }
    const deadline = Date.now() + 20_000;
    while (this.pids().length && Date.now() < deadline) await sleep(100);
    for (const pid of this.pids()) process.kill(pid, 'SIGKILL');
    while (this.pids().length) await sleep(100);
    this.owned = false;
  }

  act(action, waitMs = 30_000) {
    const result = spawnSync(process.execPath, [agentCli, 'act', '--session-dir', this.sessionDir, JSON.stringify(action), '--wait-ms', String(waitMs)], { encoding: 'utf8' });
    let parsed = null;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      // Reported below with stderr.
    }
    if (!parsed?.ok || parsed.result?.ok === false) {
      throw new Error(`Action ${action.type} failed: ${(result.stdout || result.stderr).slice(0, 800)}`);
    }
    return parsed.result;
  }

  observe() {
    try {
      return JSON.parse(readFileSync(join(this.sessionDir, 'observe.json'), 'utf8'));
    } catch {
      return null;
    }
  }

  async closeAllTabs() {
    for (let guard = 0; guard < 32; guard += 1) {
      const tabs = (this.observe()?.tabs ?? []).filter(tab => tab?.path);
      if (tabs.length === 0) return;
      this.act({ type: 'manage_tabs', operation: 'close', tabId: tabs[0].id }, 15_000);
    }
  }
}

