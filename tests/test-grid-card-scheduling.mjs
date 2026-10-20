import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../PreviewExtension/Web/grid-viewer.js', import.meta.url), 'utf8');
function body(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n  function ', start + 1);
  return source.slice(start, end);
}
const makeCache = (count = 2000, bytes = 128, entry = 64) => new Function(
  'RDKIT_SVG_CACHE_LIMIT', 'RDKIT_SVG_CACHE_BYTES', 'RDKIT_SVG_ENTRY_BYTES',
  `${body('createRdkitSvgCache')} return createRdkitSvgCache();`,
)(count, bytes, entry);
{
  const cache = makeCache(3, 32, 24);
  cache.set('a', '1234567').set('b', '1234567');
  assert.equal(cache.retainedBytes, 32, 'exact byte boundary is admitted');
  cache.set('c', '1234567');
  assert.deepEqual([...cache.keys()], ['b', 'c'], 'byte eviction happens below the count cap');
  cache.delete('b');
  cache.set('b', '1234567');
  assert.equal(cache.retainedBytes, 32, 'LRU promotion does not inflate accounting');
  cache.set('b', 'x');
  assert.equal(cache.retainedBytes, 20, 'replacement releases the previous payload');
  cache.set('oversized-key', '');
  assert.equal(cache.has('oversized-key'), false, 'keys are charged even without SVG');
  assert.deepEqual([...cache.keys()], ['c', 'b'], 'oversized insertion does not flush useful drawings');
  cache.set('b', 'x'.repeat(20));
  assert.equal(cache.has('b'), false, 'oversized replacement cannot leave an obsolete drawing');
  assert.equal(cache.retainedBytes, 16);
  assert.equal(cache.delete('missing'), false);
  cache.clear();
  assert.equal(cache.retainedBytes, 0);
  cache.set('分', '🧪');
  assert.equal(cache.retainedBytes, 6, 'UTF-16 accounting includes surrogate pairs');
  const small = makeCache(2, 128, 64);
  for (const key of ['a', 'b', 'c']) small.set(key, 'x');
  assert.deepEqual([...small.keys()], ['b', 'c'], 'small entries still obey the count cap');
}
{
  let moleculeCalls = 0, reactionCalls = 0;
  const normal = '<svg>normal</svg>', oversized = `<svg>${'x'.repeat(100)}</svg>`;
  const drawingState = {
    svgCache: makeCache(2000, 128, 64), smartsMatches: new Map(), rdkitUseInputCoords: false,
    rdkit: {
      get_mol(text) { moleculeCalls++; return { get_svg: () => text === 'large' ? oversized : normal, delete() {} }; },
      get_rxn(text) { reactionCalls++; return { get_svg: () => text === 'large' ? oversized : normal, delete() {} }; },
    },
  };
  const dependencies = {
    state: drawingState, RDKIT_SVG_SIZE: 200, RDKIT_REACTION_SVG_WIDTH: 300, RDKIT_REACTION_SVG_HEIGHT: 100,
    rowReactionText: row => row.reaction || '', rdkitCardKey: row => row.key,
    hasMolblockInputCoordinates: () => false, applyHydrogenDisplay: (_mol, match) => match,
    sanitizeSVG: value => value, stripSVGClipping: value => value, padSVGViewBox: value => value,
    isDegenerateMoleculeSVG: () => false, moleculeErrorHTML: () => { throw new Error('Unexpected draw error'); },
    omitInvalidCard: () => { throw new Error('Unexpected invalid molecule'); }, escapeHTML: value => value,
  };
  const draw = new Function(...Object.keys(dependencies), `
    ${body('drawRdkitReaction')}
    ${body('drawRdkit')}
    return drawRdkit;
  `)(...Object.values(dependencies));
  for (let i = 0; i < 2; i++) assert.equal(draw({ key: 'm', smiles: 'C' }), normal);
  for (let i = 0; i < 2; i++) assert.equal(draw({ key: 'r', reaction: 'C>>O' }), normal);
  assert.equal(moleculeCalls, 1);
  assert.equal(reactionCalls, 1);
  assert.equal(draw({ key: 'big-m', smiles: 'large' }), oversized);
  assert.equal(draw({ key: 'big-r', reaction: 'large' }), oversized);
  assert.equal(drawingState.svgCache.has('big-m'), false);
  assert.equal(drawingState.svgCache.has('big-r'), false);
  assert.equal(drawingState.svgCache.retainedBytes, 2 * (normal.length + 1) * 2);
  const callbacks = [];
  Object.assign(drawingState, { rdkitCardRendering: false, rdkitCardQueue: [], rdkitCardPending: new Map(), rdkitCardSeq: 0 });
  const enqueue = new Function('state', 'drawRdkit', 'requestAnimationFrame', 'cardRenderPriority', 'nowMs', 'window', 'emitGridPerfMetric', 'config', 'postGridReady', 'fitCardSVGs', 'repostInspectorRow', `
    const RDKIT_CARD_FRAME_BATCH = 6, RDKIT_CARD_FRAME_BUDGET_MS = 8;
    ${body('compareCardRenderJobs')}
    ${body('pumpRdkitCardQueue')}
    ${body('enqueueRdkitCard')}
    ${body('updateRdkitCard')}
    return enqueueRdkitCard;
  `)(drawingState, draw, fn => callbacks.push(fn), () => 0, () => 0, { setTimeout() {} }, () => {}, () => ({}), () => {}, () => {}, () => {});
  const targets = Array.from({ length: 2 }, () => ({
    attributes: new Map([['data-buret-rdkit-card-key', 'big-m'], ['aria-label', 'Rendering']]),
    classList: { remove() {} }, innerHTML: '', closest: () => null,
    getAttribute(name) { return this.attributes.get(name); },
    removeAttribute(name) { this.attributes.delete(name); },
  }));
  const before = moleculeCalls;
  for (const target of targets) enqueue({ key: 'big-m', smiles: 'large' }, 'big-m', target);
  callbacks.shift()();
  assert.equal(moleculeCalls, before + 1, 'oversized pending drawings remain deduplicated');
  for (const target of targets) {
    assert.equal(target.innerHTML, oversized, 'uncached SVG reaches every waiting card without truncation');
    assert.equal(target.attributes.size, 0, 'rendered cards leave the loading state');
  }
  assert.equal(drawingState.svgCache.has('big-m'), false);
  assert.equal(drawingState.rdkitCardPending.size, 0);
}
const frames = [];

{
  const pending = new Map();
  const calls = [];
  let nextTimer = 0;
  const resizing = { resizeTimer: 0 };
  const win = {
    addEventListener() {}, removeEventListener() {},
    setTimeout(callback) { pending.set(++nextTimer, callback); return nextTimer; },
    clearTimeout(id) { pending.delete(id); },
  };
  const init = new Function('state', 'window', 'document', 'handleGridScroll',
    'updateVirtualGridMetrics', 'scheduleVirtualWindowRender', 'updateGridRailActive',
    'updateTableHeaderStick', 'maybeLoadMore', `${body('initInfiniteLoading')} return initInfiniteLoading;`)(
    resizing, win, { getElementById: () => ({}) }, () => {},
    ...['measure', 'render', 'rail', 'header', 'load'].map(name => () => calls.push(name)),
  );
  init({});
  for (let i = 0; i < 60; i++) resizing.resizeHandler();
  assert.deepEqual(calls, [], 'a continuous drag must not rebuild virtual rows');
  assert.equal(pending.size, 1, 'only the latest viewport is measured after settling');
  const callback = [...pending.values()][0]; pending.clear(); callback();
  assert.deepEqual(calls, ['measure', 'render', 'rail', 'header', 'load']);
  resizing.resizeHandler();
  init({});
  assert.equal(pending.size, 0, 'reinitializing the grid cancels the stale resize pass');
}

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

// A virtual-window rebuild can mount a placeholder while its previous request
// is completing. The observer must attach the ready image, not enqueue it again.
state.xyzrenderCardCache = new Map();
state.xyzrenderCardQueue = [];
state.xyzrenderCardSeq = 0;
let pumps = 0;
const updates = [];
const enqueue = new Function('state', 'pumpXyzrenderCardQueue', 'updateXyzrenderCard', 'drawXyzrenderCard', `${body('enqueueXyzrenderCard')} return enqueueXyzrenderCard;`)(
  state, () => pumps++, (key, html) => updates.push([key, html]), row => state.xyzrenderCardCache.get(row.key).html || '<div>Failed molecule</div>',
);
const oldTarget = { isConnected: false };
const newTarget = { isConnected: true };
const row = { key: 'racing' };
enqueue(row, {}, {}, row.key, oldTarget);
enqueue(row, {}, {}, row.key, newTarget);
assert.equal(pumps, 1, 'remount does not duplicate an in-flight render');
assert.equal(state.xyzrenderCardQueue[0].target, newTarget, 'priority follows the mounted target');
state.xyzrenderCardCache.set(row.key, { html: '<img alt="Molecule"/>' });
enqueue(row, {}, {}, row.key, newTarget);
assert.deepEqual(updates, [['racing', '<img alt="Molecule"/>']], 'late observer consumes a finished image');
state.xyzrenderCardCache.set(row.key, { error: 'render failed' });
enqueue(row, {}, {}, row.key, newTarget);
assert.deepEqual(updates.at(-1), ['racing', '<div>Failed molecule</div>'], 'late observer also resolves failed placeholders');
assert.equal(pumps, 1, 'ready images and failures never restart work');

const priority = new Function('window', 'document', `${body('cardRenderPriority')} return cardRenderPriority;`)(
  { innerHeight: 600 }, {},
);
const targetAt = (top, bottom, isConnected = true) => ({ isConnected, getBoundingClientRect: () => ({ top, bottom }) });
assert.equal(priority(targetAt(0, 0, false)), Number.MAX_SAFE_INTEGER, 'detached nodes are not visible');
state.xyzrenderCardQueue = [
  { key: 'distant', target: targetAt(1200, 1300), seq: 0 },
  { key: 'nearby', target: targetAt(700, 800), seq: 1 },
  { key: 'visible', target: targetAt(50, 150), seq: 2 },
];
const takeBatch = new Function('state', 'cardRenderPriority', `const XYZRENDER_CARD_BATCH_SIZE = 12; ${body('sortXyzrenderCardQueue')} ${body('takeXyzrenderCardBatchJobs')} return takeXyzrenderCardBatchJobs;`)(state, priority);
assert.deepEqual(takeBatch().map(job => job.key), ['visible']);
assert.deepEqual(takeBatch().map(job => job.key), ['nearby', 'distant'], 'prefetch stays closest-first after scrolling');

state.xyzrenderPreset = 'default';
state.xyzrenderCardCache = new Map([['default', { html: '<svg/>' }], ['failed', { error: 'Timeout' }]]);
state.cardRenderer = 'xyzrender';
const preset = new Function('state', 'normalizeXyzrenderPreset', 'currentXyzrenderPreset', 'resetXyzrenderCardObserver', 'resetCardRenderQueues', 'refreshGridControls', 'applyGridPreferences', 'render', `${body('setXyzrenderPreset')}
return setXyzrenderPreset;`)(
  state, value => value, () => state.xyzrenderPreset, () => {}, () => {}, () => {}, () => {}, () => {},
);
preset('flat', {});
preset('default', {});
assert.equal(state.xyzrenderCardCache.get('default').html, '<svg/>', 'returning to a preset retains ready images');
assert.equal(state.xyzrenderCardCache.has('failed'), false, 'returning to a preset allows failed renders to retry');

// Exercise the real batch consumer with deliberately expensive SVG processing.
// Its promise remains pending at each yield, allowing input before all 12 cards.
const asyncBody = source.slice(source.indexOf('  async function requestXyzrenderCardBatch('), source.indexOf('\n  function markXyzrenderCardError('));
const batchUpdates = [];
let clock = 0;
let yields = 0;
const jobs = Array.from({ length: 12 }, (_, i) => ({ key: `batch-${i}`, row: { index: i }, cfg: {}, record: {} }));
const consumeBatch = new Function('state', 'hostRequest', 'currentXyzrenderPreset', 'xyzrenderCardControls', 'textToBase64', 'xyzrenderCardInputText', 'prepareXyzrenderCardSVG', 'svgDataImageHTML', 'evictXyzrenderCardCache', 'updateXyzrenderCard', 'emitGridPerfMetric', 'xyzrenderCardBatchConcurrency', 'markXyzrenderCardError', 'nowMs', 'window', `
  const XYZRENDER_CARD_BATCH_TIMEOUT_MS = 60000, RDKIT_CARD_FRAME_BUDGET_MS = 8;
  ${asyncBody}
  return requestXyzrenderCardBatch;
`)(state, async () => ({ items: jobs.map(job => ({ id: job.key, svg: '<svg/>' })) }), () => 'default', () => ({}), x => x, () => '', svg => { clock += 9; return svg; }, svg => svg, () => {}, key => batchUpdates.push(key), () => {}, () => 1, (_job, error) => assert.fail(error), () => clock, {
  setTimeout(resolve) { yields++; assert.ok(batchUpdates.length > 0 && batchUpdates.length < jobs.length); setTimeout(resolve, 0); },
});
await consumeBatch(jobs);
assert.equal(yields, 11, 'each expensive card yields before processing the next');
assert.deepEqual(batchUpdates, jobs.map(job => job.key));
console.log('3D cards: late cache delivery, remount priority, preset reuse and UI-thread yields passed.');
