import { mainThread, stats } from './perf-journey-metrics.mjs';

// The CLI starts before dispatch; scientific completion belongs to the actual
// document journey, and must precede the next actual focus, not its CLI launch.
export function scaleFocusScene(lines, action, startUntil = Infinity) {
  const starts = lines.filter(event => event.name === 'tab:switch' && event.at >= action.startedAt - 1
    && event.at < startUntil && (!action.documentId || event.detail?.documentId === action.documentId));
  if (starts.length !== 1) return { status: starts.length ? 'ambiguous' : 'pending' };
  const journey = starts[0], documentId = journey.detail.documentId;
  const next = lines.filter(event => event.name === 'tab:switch' && event.at > journey.at)
    .reduce((at, event) => Math.min(at, event.at), Infinity);
  const events = lines.filter(event => ['document:visible', 'document:ready'].includes(event.name)
    && event.detail?.kind === 'tab' && event.detail.documentId === documentId && event.at === journey.at
    && Number.isFinite(event.ms) && event.ms >= 0 && event.at + event.ms < next);
  const visible = events.filter(event => event.name === 'document:visible');
  const ready = events.filter(event => event.name === 'document:ready');
  if (visible.length > 1 || ready.length > 1) return { status: 'ambiguous' };
  const mounts = lines.filter(event => event.name === 'iframe:mount' && event.detail?.documentId === documentId
    && event.at >= journey.at && event.at < next);
  const cold = mounts.length > 0 || visible[0]?.detail.remounted === true || (visible[0]?.detail.loads ?? 0) > 0;
  const warm = !cold && !ready.length && visible[0]?.detail.remounted === false && visible[0]?.detail.loads === 0;
  const terminal = cold && mounts.length && ready[0] && ready[0].at + ready[0].ms >= Math.max(...mounts.map(event => event.at))
    ? ready[0] : warm ? visible[0] : null;
  return { status: terminal ? 'complete' : 'pending', journey, visible: visible[0] ?? null, ready: ready[0] ?? null,
    mounts, classification: cold ? 'remounted' : warm ? 'mounted-warm' : 'unknown',
    terminalAt: terminal ? terminal.at + terminal.ms : null };
}

// Match after the transport has drained; delivery time is not journey time.
export function reduceScaleSwitches(lines, actions, until) {
  const switches = [];
  const missing = [];
  const ambiguous = [];
  for (const [index, action] of actions.entries()) {
    const end = actions[index + 1]?.startedAt ?? until;
    if (action.path && (!Number.isFinite(action.readyWallMs) || action.readyWallMs < 0
      || action.readyObservation?.path !== action.path || action.readyObservation?.tabId !== action.tabId
      || typeof action.documentId !== 'string' || action.readyObservation?.documentId !== action.documentId
      || action.readyObservation?.ready !== true || !(Date.parse(action.readyObservation?.reportedAt) >= action.startedAt)
      || !(Date.parse(action.readyObservation?.reportedAt) < end) || action.startedAt + action.readyWallMs >= end
      || !(Date.parse(action.readyObservation?.reportedAt) > action.previousReportedAt))) {
      missing.push(index);
      continue;
    }
    const scene = scaleFocusScene(lines, action, end);
    if (scene.status !== 'complete' || (action.path && (action.sceneJourneyAt !== scene.journey.at
      || action.readyObservation?.sceneTerminalAt !== scene.terminalAt
      || Date.parse(action.readyObservation.reportedAt) < scene.terminalAt))) {
      (scene.status === 'ambiguous' ? ambiguous : missing).push(index);
      continue;
    }
    const { journey, visible, ready, mounts, classification, terminalAt } = scene;
    switches.push({ actionIndex: index, startedAt: journey.at, ...(visible ?? ready).detail,
      visibleMs: visible?.ms ?? null, sceneReadyMs: terminalAt - action.startedAt,
      readyTerminalMs: ready ? ready.at + ready.ms - action.startedAt : null,
      readyWallMs: action.readyWallMs ?? null, classification, mountCount: mounts.length,
      stallMs: mainThread(lines, journey.at, terminalAt).stallMs });
  }
  const summarize = selected => Object.fromEntries(['visibleMs', 'sceneReadyMs', 'readyWallMs', 'readyTerminalMs', 'stallMs']
    .map(metric => [metric, stats(selected.map(sample => sample[metric]))]));
  return {
    switches,
    summary: summarize(switches),
    subsets: Object.fromEntries(['mounted-warm', 'remounted', 'unknown'].map(kind => {
      const selected = switches.filter(sample => sample.classification === kind);
      return [kind, { count: selected.length, summary: summarize(selected) }];
    })),
    integrity: { requested: actions.length, matched: switches.length, visible: switches.filter(sample => Number.isFinite(sample.visibleMs)).length,
      readyTerminal: switches.filter(sample => Number.isFinite(sample.readyTerminalMs)).length,
      readyObserved: switches.filter(sample => Number.isFinite(sample.readyWallMs)).length,
      missingActionIndices: missing, ambiguousActionIndices: ambiguous },
  };
}

export function scaleDocumentIntegrity(samples) {
  const failures = [];
  const documents = samples.map(sample => {
    const observed = sample.tracedUniqueDocumentsAdded ?? sample.tracedDocumentsAdded;
    const registered = sample.registeredBounds?.documents?.total;
    const missing = Math.max(0, sample.added - observed);
    const extra = Math.max(0, observed - sample.added);
    const duplicates = Math.max(0, sample.tracedDocumentsAdded - observed);
    const pass = observed === sample.added && duplicates === 0 && registered === sample.total;
    if (!pass) failures.push(`document conservation at ${sample.total}: expected ${sample.added}, traced ${observed}, duplicates ${duplicates}, registered ${registered}`);
    return { total: sample.total, expectedAdded: sample.added, tracedUniqueAdded: observed, registered, missing, extra, duplicates, status: pass ? 'pass' : 'fail' };
  });
  if (JSON.stringify(samples.map(sample => sample.total)) !== '[1,10,100,1000]') failures.push('the 1/10/100/1000 document series is incomplete');
  return { documents, failures };
}

export function traceIntegrity(protocol, diagnostics) {
  const failures = [];
  for (const key of ['droppedEntries', 'failedBatches', 'malformedLines', 'rotationGaps']) {
    if (!Number.isSafeInteger(diagnostics?.[key]) || diagnostics[key] !== 0) failures.push(`trace ${key}: ${diagnostics?.[key] ?? 'unknown'}`);
  }
  if (protocol !== 'sequenced') failures.push('legacy trace has no sequence/drop accounting; zero diagnostics do not establish conservation');
  return failures;
}

export function scaleIntegrity(report) {
  const { documents, failures } = scaleDocumentIntegrity(report.samples);
  if (report.failure || report.shutdownFailure) failures.push('native campaign or owned shutdown failed');
  const switchCount = report.switches.length;
  const expectedSwitches = report.switchMeasurement?.expected ?? 24;
  if (switchCount !== expectedSwitches || report.switchActions?.length !== expectedSwitches || report.switchIntegrity?.matched !== expectedSwitches
    || report.switchIntegrity?.missingActionIndices?.length || report.switchIntegrity?.ambiguousActionIndices?.length) {
    failures.push(`switch conservation: expected ${expectedSwitches}, recorded ${switchCount}, actions ${report.switchActions?.length ?? 'unknown'}`);
  }
  if (report.switchMetricDefinitions && report.switchIntegrity?.readyObserved !== expectedSwitches) {
    failures.push(`fresh ready observation conservation: expected ${expectedSwitches}, recorded ${report.switchIntegrity?.readyObserved ?? 0}`);
  }
  // Successful retries may recover marks, but a measurement with retries is
  // flagged for review because tracing itself can perturb its timing.
  failures.push(...traceIntegrity(report.traceProtocol, report.traceDiagnostics));
  if (report.switchMetricDefinitions && (report.quitDiagnostics?.cleanupFailure || report.quitDiagnostics?.finalSyncFailure
    || report.quitDiagnostics?.traceDrain?.status !== 'confirmed')) failures.push('owned cleanup/final trace drain was not confirmed');
  if (report.close?.bounds?.documents?.total !== 0) failures.push('close-all did not independently confirm zero documents');
  return {
    status: failures.length === 0 ? 'pass' : 'fail', failures, documents,
    switches: { expected: expectedSwitches, recorded: switchCount, ...report.switchIntegrity },
    traceProtocol: report.traceProtocol ?? 'unknown',
    limitation: 'Integrity checks validate this workload and captured journeys, not OS presentation, total app memory, scientific equivalence or unloaded-Mac performance.',
  };
}
