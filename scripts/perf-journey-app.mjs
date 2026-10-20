// Packaged development-app lifecycle and bounded trace reading for perf-journeys.mjs.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
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

function hostInventory(operation, value) {
  const helper = join(repoRoot, 'build/perf-host');
  if (!existsSync(helper)) throw new Error('Build the perf host helper first: swiftc scripts/perf-host.swift -o build/perf-host');
  return execFileSync(helper, [operation, ...(value === undefined ? [] : [String(value)])], { encoding: 'utf8' });
}

function runningBundlePids(bundleId) {
  return JSON.parse(hostInventory('pids', bundleId));
}

function screens() {
  return JSON.parse(hostInventory('screens'));
}

class Trace {
  constructor(path, limits = {}) {
    const bounds = { lineBytes: 64 * 1024, retainedLines: 100_000, retainedBytes: 32 * 1024 * 1024, streams: 256, streamKeyBytes: 512 };
    this.limits = Object.fromEntries(Object.entries(bounds).map(([key, maximum]) => {
      const value = limits[key] ?? maximum;
      if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`Invalid trace reader bound: ${key}`);
      return [key, value];
    }));
    this.path = path;
    this.offset = 0;
    this.partial = '';
    this.partialBytes = 0;
    this.decoder = new StringDecoder('utf8');
    this.lines = [];
    this.lineSizes = [];
    this.retainedBytes = 0;
    this.captureFrom = Date.now();
    this.evidencePath = null;
    this.identity = null;
    this.sequences = new Map();
    this.transportTotals = new Map();
    this.streamKeys = new Set();
    this.integrityError = null;
    // sequenceGaps counts missing INTERNAL sequence numbers after the first
    // captured mark of a producer; an excluded historical prefix is unknown.
    this.diagnostics = { droppedEntries: 0, failedBatches: 0, duplicateEntries: 0, malformedLines: 0, rotationGaps: 0,
      sequenceGaps: 0, readerOverflows: 0, oversizedLines: 0, integrityErrors: 0 };
  }

  fail(message, counter) {
    if (!this.integrityError) {
      if (counter) this.diagnostics[counter] += 1;
      this.diagnostics.integrityErrors += 1;
      this.integrityError = new Error(`Trace reader integrity failure: ${message}`);
    }
    throw this.integrityError;
  }

  sync() {
    if (this.integrityError) throw this.integrityError;
    let fd;
    try {
      fd = openSync(this.path, 'r');
    } catch {
      return;
    }
    try {
      // Stat the opened descriptor so a concurrent rename cannot pair the old
      // inode's size/offset with a newly created live file.
      const info = fstatSync(fd);
      const identity = `${info.dev}:${info.ino}`;
      if (this.identity !== identity) {
        if (this.identity !== null) {
          let archive;
          try {
            archive = openSync(this.path.replace(/\.jsonl$/, '.1.jsonl'), 'r');
            const archived = fstatSync(archive);
            if (`${archived.dev}:${archived.ino}` === this.identity) this.readLines(archive, archived.size);
            else this.diagnostics.rotationGaps += 1;
          } catch {
            if (this.integrityError) throw this.integrityError;
            this.diagnostics.rotationGaps += 1;
          } finally {
            if (archive !== undefined) closeSync(archive);
          }
        }
        if (this.partialBytes) this.fail('unterminated line at rotation', 'malformedLines');
        this.offset = 0;
        this.partial = '';
        this.partialBytes = 0;
        this.decoder = new StringDecoder('utf8');
        this.identity = identity;
      }
      this.readLines(fd, info.size);
    } finally {
      closeSync(fd);
    }
  }

  readLines(fd, size) {
    if (size < this.offset) {
      this.diagnostics.rotationGaps += 1;
      this.offset = 0;
      this.partial = '';
      this.partialBytes = 0;
      this.decoder = new StringDecoder('utf8');
    }
    while (this.offset < size) {
      const buffer = Buffer.alloc(Math.min(size - this.offset, 64 * 1024));
      const bytes = readSync(fd, buffer, 0, buffer.length, this.offset);
      if (bytes === 0) break;
      this.offset += bytes;
      this.consume(this.decoder.write(buffer.subarray(0, bytes)));
    }
  }

  consume(text) {
    if (this.integrityError) throw this.integrityError;
    let cursor = 0;
    while (cursor < text.length) {
      const newline = text.indexOf('\n', cursor);
      const piece = text.slice(cursor, newline < 0 ? text.length : newline);
      const bytes = this.partialBytes + Buffer.byteLength(piece);
      if (bytes > this.limits.lineBytes) {
        this.partial = '';
        this.partialBytes = 0;
        this.fail(`line exceeds ${this.limits.lineBytes} UTF-8 bytes`, 'oversizedLines');
      }
      this.partial += piece;
      this.partialBytes = bytes;
      if (newline < 0) break;
      const part = this.partial;
      this.partial = '';
      this.partialBytes = 0;
      cursor = newline + 1;
      let line;
      try {
        line = JSON.parse(part);
      } catch {
        this.diagnostics.malformedLines += 1;
        continue;
      }
      if (!line || typeof line !== 'object' || Array.isArray(line)) {
        this.diagnostics.malformedLines += 1;
        continue;
      }
      if (!Number.isFinite(line.at)) {
        this.diagnostics.malformedLines += 1;
        continue;
      }
      // Initial cache priming must not retain old records or allocate replay
      // state for producer streams outside this measurement's capture scope.
      if (line.at < this.captureFrom) continue;
      let stream;
      if ((line.source === 'web' && typeof line.stream === 'string') || line.name === 'trace:transport') {
        if ((line.window != null && typeof line.window !== 'string') || (line.stream != null && typeof line.stream !== 'string')) {
          this.fail('invalid producer identity fields', 'malformedLines');
        }
        stream = JSON.stringify([line.window, line.stream]);
        if (Buffer.byteLength(stream) > this.limits.streamKeyBytes) this.fail('producer key exceeds byte bound', 'readerOverflows');
        if (!this.streamKeys.has(stream)) {
          if (this.streamKeys.size >= this.limits.streams) this.fail('producer stream capacity exceeded', 'readerOverflows');
          this.streamKeys.add(stream);
        }
      }
      if (line.source === 'web' && typeof line.stream === 'string' && Number.isSafeInteger(line.seq)) {
        if (line.seq < 1) this.fail('invalid producer sequence', 'malformedLines');
        const previous = this.sequences.get(stream);
        if (previous !== undefined && line.seq <= previous) {
          this.diagnostics.duplicateEntries += 1;
          continue;
        }
        if (previous !== undefined && line.seq !== previous + 1) {
          this.diagnostics.sequenceGaps += line.seq - previous - 1;
          this.fail('missing internal producer sequence numbers');
        }
        this.sequences.set(stream, line.seq);
      }
      if (line.name === 'trace:transport') {
        const previous = this.transportTotals.get(stream) ?? { droppedEntries: 0, failedBatches: 0 };
        for (const key of ['droppedEntries', 'failedBatches']) {
          const totalKey = `total${key[0].toUpperCase()}${key.slice(1)}`;
          const total = line.detail?.[totalKey];
          if (Number.isSafeInteger(total) && total >= previous[key]) {
            this.diagnostics[key] += total - previous[key];
            previous[key] = total;
          }
        }
        this.transportTotals.set(stream, previous);
      }
      if (this.lines.length >= this.limits.retainedLines || this.retainedBytes + bytes > this.limits.retainedBytes) {
        this.fail('retained event/byte capacity exceeded; reduce or explicitly forget completed intervals', 'readerOverflows');
      }
      this.lines.push(line);
      this.lineSizes.push(bytes);
      this.retainedBytes += bytes;
      if (this.evidencePath) appendFileSync(this.evidencePath, `${part}\n`);
    }
  }

  // Drops lines older than `at` so a long benchmark keeps a bounded buffer.
  forget(at) {
    if (this.integrityError) throw this.integrityError;
    const lines = [], sizes = [];
    let bytes = 0;
    this.lines.forEach((line, index) => {
      if (line.at < at) return;
      lines.push(line);
      sizes.push(this.lineSizes[index]);
      bytes += this.lineSizes[index];
    });
    this.lines = lines;
    this.lineSizes = sizes;
    this.retainedBytes = bytes;
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
    if (this.integrityError) throw this.integrityError;
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

  assertUnlocked() {
    if (frontmostBundleId() === 'com.apple.loginwindow') {
      throw new Error('The Mac screen is locked. Unlock it before measuring a visible app; locked-screen timings are invalid.');
    }
  }

  async launch() {
    this.assertUnlocked();
    if (runningBundlePids(this.bundleId).length) throw new Error(`${this.bundleId} is already running; existing sessions are never taken over.`);
    this.screen = this.placeWindow();
    await this.waitForIdle();
    const previous = frontmostBundleId();
    this.previousBundleId = previous;
    this.trace.sync();
    const startedAt = Date.now();
    execFileSync('open', ['-n', ...(this.options.foreground ? [] : ['-g']), '--env', 'BURETTE_PERF_TRACE=1', this.path, '--args', '--burette-agent-session', this.sessionDir]);
    this.owned = true;
    // The app activates itself when its window shows. Hand focus back the
    // moment it does; `open -b` needs no Automation consent.
    let shell = null;
    let restored = this.options.foreground || !previous || previous === this.bundleId;
    const deadline = Date.now() + 60_000;
    let checkedAt = startedAt;
    while (!shell || Date.now() < shell.at + 1_500) {
      if (Date.now() - checkedAt >= 1_000) {
        this.assertUnlocked();
        checkedAt = Date.now();
      }
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
    this.quitDiagnostics = { cleanupFailure: null, traceDrain: { status: 'not-running' } };
    if (!this.pids().length) return;
    const restoreFocus = this.options.foreground && frontmostBundleId() === this.bundleId;
    try {
      await this.closeAllTabs();
    } catch (error) {
      this.quitDiagnostics.cleanupFailure = String(error.message ?? error).slice(0, 800);
      this.quitDiagnostics.traceDrain = { status: 'cleanup-refused' };
      // Owning the process does not authorize discarding a dirty draft. Keep
      // the session and app alive for explicit, coordinated UI cleanup.
      throw new Error(`Preserving owned app after unconfirmed cleanup: ${this.quitDiagnostics.cleanupFailure}`);
    }
    // Completion of the CLI/observation is earlier than the frontend's 1s
    // transport flush. Wait for the actual last action, not a quiet-file guess.
    const actionId = this.lastActionId ?? null;
    const drain = this.quitDiagnostics.traceDrain = { actionId, status: 'unverified' };
    const drainDeadline = Date.now() + (actionId ? 3_000 : 1_200);
    try {
      do {
        this.trace.sync();
        if (actionId && this.trace.lines.some(line => line.name === 'agent:action' && line.detail?.id === actionId)) {
          drain.status = 'confirmed';
          break;
        }
        await sleep(50);
      } while (Date.now() < drainDeadline);
      this.trace.sync();
      if (drain.status !== 'confirmed') drain.status = actionId ? 'timeout' : 'no-action-id';
    } catch (error) {
      drain.status = 'error';
      drain.error = String(error.message ?? error).slice(0, 800);
    }
    if (drain.status !== 'confirmed') {
      console.error(`Shutdown evidence incomplete: ${JSON.stringify(this.quitDiagnostics)}`);
    }
    for (const pid of this.pids()) {
      hostInventory('terminate', pid);
    }
    const deadline = Date.now() + 20_000;
    while (this.pids().length && Date.now() < deadline) await sleep(100);
    for (const pid of this.pids()) process.kill(pid, 'SIGKILL');
    while (this.pids().length) await sleep(100);
    this.owned = false;
    try { this.trace.sync(); } catch (error) { this.quitDiagnostics.finalSyncFailure = String(error.message ?? error).slice(0, 800); }
    if (restoreFocus && this.previousBundleId && this.previousBundleId !== this.bundleId) spawnSync('open', ['-b', this.previousBundleId]);
  }

  act(action, waitMs = 30_000) {
    this.assertUnlocked();
    const result = spawnSync(process.execPath, [agentCli, 'act', '--session-dir', this.sessionDir, JSON.stringify(action), '--wait-ms', String(waitMs)], { encoding: 'utf8' });
    let parsed = null;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      // Reported below with stderr.
    }
    if (typeof parsed?.result?.action?.id === 'string' && parsed.result.action.id.length <= 512) {
      this.lastActionId = parsed.result.action.id;
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
    if (!this.owned) throw new Error('Cannot clean up an app this runner does not own.');
    const deadline = Date.now() + 60_000;
    const waitForObservation = async (startedAt, previousAt, predicate, label) => {
      const until = Math.min(deadline, Date.now() + 5_000);
      while (Date.now() <= until) {
        const current = this.observe();
        const at = Date.parse(current?.reportedAt);
        if (at >= startedAt && at > previousAt && predicate(current)) return current;
        await sleep(50);
      }
      throw new Error(`Cleanup ${label}: stale observation, refused close, or no progress.`);
    };
    let closed = 0;
    let verified = false;
    for (;;) {
      const observation = this.observe();
      const tabs = observation?.tabs;
      const documents = observation?.bounds?.documents?.total;
      const totalTabs = observation?.bounds?.tabs?.total;
      if (!Array.isArray(tabs) || !Number.isInteger(documents) || !Number.isInteger(totalTabs)) {
        throw new Error('Cleanup requires an independently observed workspace with document/tab bounds.');
      }
      const target = tabs.find(tab => tab?.path);
      if (!target) {
        if (documents !== 0 || totalTabs !== tabs.length || tabs.some(tab => tab.kind !== 'launcher')) {
          throw new Error(`Cleanup cannot confirm an empty workspace: ${documents} documents, ${totalTabs} tabs, ${tabs.length} observed.`);
        }
        if (!verified) {
          // An old empty snapshot could precede an outstanding open. A focus
          // acknowledgement requests a fresh observation without closing data.
          const tabId = observation.activeTabId ?? tabs[0]?.id;
          if (!tabId) throw new Error('Cleanup cannot request a fresh empty-workspace observation.');
          const startedAt = Date.now();
          this.act({ type: 'manage_tabs', operation: 'focus', tabId }, 15_000);
          await waitForObservation(startedAt, Date.parse(observation.reportedAt), current =>
            Array.isArray(current.tabs) && current.bounds?.documents?.total === 0 && current.bounds?.tabs?.total === current.tabs.length
            && current.tabs.every(tab => tab.kind === 'launcher'), 'empty-workspace confirmation failed');
        }
        return { closed, documents: 0 };
      }
      if (closed >= 32 || documents > 32 || totalTabs > 33 || Date.now() >= deadline) {
        throw new Error('Automatic cleanup is limited to 32 file tabs / 60 seconds; use CUA File > Close All Tabs for scale workloads.');
      }
      const startedAt = Date.now();
      this.act({ type: 'manage_tabs', operation: 'close', tabId: target.id }, 15_000);
      await waitForObservation(startedAt, Date.parse(observation.reportedAt), current => {
        const nextDocuments = current.bounds?.documents?.total;
        const nextTabs = current.bounds?.tabs?.total;
        return Array.isArray(current.tabs) && !current.tabs.some(tab => tab.id === target.id)
          && Number.isInteger(nextDocuments) && nextDocuments >= 0 && nextDocuments <= documents
          && Number.isInteger(nextTabs) && nextTabs === current.tabs.length && nextTabs <= totalTabs
          // Closing the final file creates a new launcher: tab count stays one,
          // but the source document is gone. Other closes must remove a tab.
          && (nextTabs < totalTabs || (nextDocuments < documents && nextDocuments === 0
            && current.tabs.every(tab => tab.kind === 'launcher')));
      }, `did not remove tab ${target.id}`);
      closed += 1;
      verified = true;
    }
  }
}

