import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../PreviewExtension/Web/grid-viewer.js', import.meta.url), 'utf8');
function body(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n  function ', start + 1);
  return source.slice(start, end);
}
const frames = [];
let measurements = 0;
let rendered = [];
const state = {
  rdkit: {}, rdkitCardRendering: false,
  rdkitCardQueue: Array.from({ length: 40 }, (_, i) => ({ key: i, row: i, target: { distance: 40 - i }, seq: i })),
  rdkitCardPending: new Map(), svgCache: new Map(),
};
const pump = new Function('state', 'requestAnimationFrame', 'cardRenderPriority', 'nowMs', 'drawRdkit', 'updateRdkitCard', 'window', 'emitGridPerfMetric', 'config', 'postGridReady', `
  const RDKIT_CARD_FRAME_BATCH = 6, RDKIT_CARD_FRAME_BUDGET_MS = 8;
  ${body('compareCardRenderJobs')}
  ${body('pumpRdkitCardQueue')}
  return pumpRdkitCardQueue;
`)(state, fn => frames.push(fn), target => { measurements++; return target.distance; }, () => rendered.length * 9, row => { rendered.push(row); return ''; }, () => {}, { setTimeout() {} }, () => {}, () => ({}), () => {});
pump();
frames.shift()();
assert.equal(measurements, 40, 'measure each queued card once, outside the comparator');
assert.deepEqual(rendered, [39], 'nearest card first; yield after one expensive rendering');

state.xyzrenderCardQueue = [{ key: 'queued' }];
state.xyzrenderCardCache = new Map([['queued', { pending: true }], ['running', { pending: true }], ['cached', { html: 'svg' }]]);
state.xyzrenderBatchesRunning = 2;
state.xyzrenderBatchTimer = 0;
new Function('state', 'window', `${body('resetCardRenderQueues')} resetCardRenderQueues();`)(state, {});
assert.equal(state.xyzrenderBatchesRunning, 2, 'repainting must not reset active concurrency');
assert.deepEqual([...state.xyzrenderCardCache.keys()], ['running', 'cached'], 'keep in-flight work deduplicated, discard unstarted work');

const timers = [];
const started = [];
state.xyzrenderCardPrefetchTimer = 0;
state.xyzrenderCardLazyTargets = [{ distance: 0 }, { distance: 599 }, { distance: 10000 }];
new Function('state', 'window', 'isElementNearViewport', 'startLazyXyzrenderCard', `const XYZRENDER_CARD_PREFETCH_DELAY_MS=200; ${body('scheduleXyzrenderCardPrefetch')} scheduleXyzrenderCardPrefetch();`)(state, { setTimeout(fn) { timers.push(fn); return 1; } }, (target, margin) => target.distance <= margin, target => started.push(target.distance));
timers.shift()();
assert.deepEqual(started, [0, 599], 'offscreen images do not compete with nearby cards');

state.svgCache = new Map([['hot', '<svg/>'], ['cold', '<svg/>']]);
const placeholder = new Function('state', 'rdkitCardKey', 'escapeAttr', `${body('drawRdkitPlaceholder')}
return drawRdkitPlaceholder;`)(state, row => row.key, text => text);
assert.equal(placeholder({ key: 'hot' }), '<svg/>');
assert.deepEqual([...state.svgCache.keys()], ['cold', 'hot'], 'recently viewed drawings survive cache eviction');
console.log('Grid card scheduling: priority, frame budget, in-flight deduplication, bounded prefetch and LRU passed.');

{
  const callbacks = [];
  const scrolling = { tableScrollLeft: 0, tableColumnScrollFrame: 0, rows: [{}], token: 1 };
  let columns = [{ id: 'name' }, { id: 'smiles' }], rebuilds = 0;
  const scroll = new Function('state', 'window', 'tableColumnWindow', 'tableVisibleColumns',
    'tableColumnCatalog', 'startVisibleRdkitCards', 'renderVirtualWindow', `
      ${body('handleTableColumnScroll')} return handleTableColumnScroll;
    `)(scrolling, { requestAnimationFrame(fn) { callbacks.push(fn); return 1; } },
    () => ({ windowColumns: columns }), value => value, () => [], () => {}, () => { rebuilds++; });
  const wrapper = { scrollLeft: 20, dataset: { columnWindow: 'name|smiles' } };
  scroll(wrapper, {});
  callbacks.shift()();
  assert.equal(rebuilds, 0, 'scrolling within mounted columns preserves the table and its drawings');
  columns = [{ id: 'smiles' }, { id: 'prop:RGroup_Core' }];
  wrapper.scrollLeft = 200;
  scroll(wrapper, {});
  callbacks.shift()();
  assert.equal(rebuilds, 1, 'crossing the column window mounts newly visible columns');
}

{
  const pendingFrames = [], updates = [];
  let draws = 0;
  const shared = { rdkit: {}, rdkitCardRendering: false, rdkitCardQueue: [], rdkitCardPending: new Map(), rdkitCardSeq: 0, svgCache: new Map() };
  const enqueue = new Function('state', 'requestAnimationFrame', 'cardRenderPriority', 'nowMs', 'drawRdkit', 'updateRdkitCard', 'window', 'emitGridPerfMetric', 'config', 'postGridReady', `
    const RDKIT_CARD_FRAME_BATCH = 6, RDKIT_CARD_FRAME_BUDGET_MS = 8;
    ${body('compareCardRenderJobs')}
    ${body('pumpRdkitCardQueue')}
    ${body('enqueueRdkitCard')}
    return enqueueRdkitCard;
  `)(shared, fn => pendingFrames.push(fn), () => 0, () => 0, () => { draws++; return '<svg/>'; }, (key, html, target) => updates.push(target), { setTimeout() {} }, () => {}, () => ({}), () => {});
  enqueue({ smiles: 'C[*:1]' }, 'shared-fragment', 'cell-one');
  enqueue({ smiles: 'C[*:1]' }, 'shared-fragment', 'cell-two');
  pendingFrames.shift()();
  assert.equal(draws, 1, 'identical fragments share one depiction');
  assert.deepEqual(updates, ['cell-one', 'cell-two'], 'every cell receives the shared drawing');
}

{
  const cell = new Function('escapeAttr', 'drawRdkitPlaceholder', 'tableHighlightedTextHTML', `${body('tableCellHTML')} return tableCellHTML;`)(
    value => value.replaceAll('"', '&quot;'), row => `<drawing>${row.smiles}</drawing>`, value => value,
  );
  for (const id of ['descriptor:RGroup_Core', 'prop:RGroup_R1', 'prop:RGroup_Components', 'descriptor:Scaffold']) {
    assert.match(cell({}, { id, get: () => 'C[*:1]' }, {}), /data-buret-fragment-smiles="C\[\*:1\]"/);
  }
  assert.doesNotMatch(cell({}, { id: 'prop:RGroup_Status', get: () => 'Matched' }, {}), /drawing/);
  assert.doesNotMatch(cell({}, { id: 'prop:RGroup_R1', get: () => '' }, {}), /drawing/);
}
