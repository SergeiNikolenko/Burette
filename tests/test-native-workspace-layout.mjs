import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('native Ketcher docks retain half the editor width without changing desktop bounds', async () => {
  const source = await readFile(new URL('../apps/desktop/src/components/app-layout.tsx', import.meta.url), 'utf8');
  const helpers = source.slice(source.indexOf('const MAIN_MIN_WIDTH'), source.indexOf('// Keeps an always-mounted'));
  const code = ts.transpileModule(helpers, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const { clampRightDockWidth, rightDockMaxWidth } = runInNewContext(`${code}\n({clampRightDockWidth, rightDockMaxWidth})`);
  for (const width of [320, 560, 1000]) {
    const dock = clampRightDockWidth(700, width, true);
    assert.equal(dock, Math.floor(width / 2));
    assert.ok(width - dock >= width / 2);
    assert.equal(rightDockMaxWidth(width), rightDockMaxWidth(width, false));
  }
});

test('collection filter readiness cannot auto-open the agent inspector', async () => {
  const source = await readFile(new URL('../apps/desktop/src/App.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('const openedGridFilterDockRef');
  const effect = source.slice(start, source.indexOf('const [poseReviewSelections', start));
  for (const agentShell of [true, false]) {
    const calls = [];
    const code = ts.transpileModule(effect.replace('import.meta.env.VITE_BURETTE_AGENT_SHELL', JSON.stringify(agentShell ? '1' : '0')), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    runInNewContext(code, {
      useRef: value => ({ current: value }), useEffect: effect => effect(),
      activeDocument: { id: 'collection', renderer: 'grid2d' }, activeGridFilterModel: { columns: ['pIC50'] },
      setDockOpen: (...args) => calls.push(['open', ...args]), setDockActiveTab: (...args) => calls.push(['tab', ...args]),
    });
    assert.deepEqual(calls, agentShell ? [] : [['open', 'right', true], ['tab', 'right', 'inspector']]);
  }
});

test('agent Ketcher recenters after a visible resize without editing or zooming', async () => {
  const source = await readFile(new URL('../apps/desktop/src/components/ketcher-editor.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('let resizeFrame = 0;');
  const code = source.slice(start, source.indexOf('resizeObserver.observe(root);', start));
  for (const isAgentShell of [true, false]) {
    let onResize, onFrame;
    let centered = 0;
    const root = { clientWidth: 736, clientHeight: 620 };
    runInNewContext(code, {
      root, defaultBuildInfo: { isAgentShell }, suppress() {},
      ResizeObserver: class { constructor(callback) { onResize = callback; } },
      window: { cancelAnimationFrame() {}, requestAnimationFrame(callback) { onFrame = callback; return 1; } },
      instanceRef: { current: { editor: { centerStruct() { centered++; } } } },
    });
    root.clientWidth = 420;
    onResize();
    assert.equal(Boolean(onFrame), isAgentShell);
    onFrame?.();
    assert.equal(centered, isAgentShell ? 1 : 0);
    onFrame = undefined;
    root.clientWidth = 0;
    onResize();
    assert.equal(onFrame, undefined, 'hidden tabs must not recenter');
  }
});
