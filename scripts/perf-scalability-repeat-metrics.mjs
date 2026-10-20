import { mainThread, stats } from './perf-journey-metrics.mjs';
import { scaleDocumentIntegrity, traceIntegrity } from './perf-scalability-metrics.mjs';

export function reduceScaleOpen(lines, sample) {
  const events = lines.filter(event => event.at >= sample.startedAt && event.at <= sample.finishedAt);
  const additions = events.filter(event => event.name === 'document:added');
  const targets = additions.filter(event => event.detail?.path === sample.firstRequestedPath);
  const documentId = targets.length === 1 ? targets[0].detail?.documentId : null;
  const targetEvents = documentId ? events.filter(event => event.detail?.documentId === documentId && event.at >= targets[0].at - 1) : [];
  const completeAt = event => event.at + event.ms;
  const first = name => targetEvents.filter(event => event.name === name && Number.isFinite(event.ms))
    .sort((a, b) => completeAt(a) - completeAt(b))[0];
  const ready = first('document:ready');
  const visible = first('document:visible');
  const activeMatches = sample.activeObservation?.path === sample.firstRequestedPath && sample.activeObservation?.ready === true;
  const failures = [];
  if (!documentId) failures.push('first requested document admission is missing or ambiguous');
  if (!activeMatches) failures.push('independent observation does not confirm the newly requested active document');
  if (!ready) failures.push('matching document:ready handshake is missing');
  return {
    ...sample, documentId,
    tracedDocumentsAdded: additions.length,
    tracedUniqueDocumentsAdded: new Set(additions.map(event => event.detail?.documentId)).size,
    firstAdmissionMs: targets.length === 1 ? targets[0].at - sample.startedAt : null,
    firstActiveReadyMs: ready && activeMatches ? completeAt(ready) - sample.startedAt : null,
    firstActiveVisibleMs: visible && activeMatches ? completeAt(visible) - sample.startedAt : null,
    traceProtocol: additions.length > 0 && additions.every(event => typeof event.stream === 'string' && Number.isSafeInteger(event.seq)) ? 'sequenced' : 'legacy-or-incomplete',
    mainThread: mainThread(lines, sample.startedAt, sample.finishedAt),
    measurementFailures: failures,
  };
}

export function repeatRunIntegrity(run) {
  const { documents, failures } = scaleDocumentIntegrity(run.samples);
  for (const sample of run.samples) {
    failures.push(...sample.measurementFailures.map(message => `${sample.total}: ${message}`));
  }
  const protocol = run.samples.length === 4 && run.samples.every(sample => sample.traceProtocol === 'sequenced') ? 'sequenced' : 'legacy-or-incomplete';
  failures.push(...traceIntegrity(protocol, run.traceDiagnostics));
  if (run.cleanup?.documents !== 0) failures.push('cleanup did not independently confirm zero documents');
  if (run.cleanup?.failure || run.quitFailure) failures.push('cleanup or owned-process shutdown failed');
  if (run.failure) failures.push('native run failed; see failure');
  return { status: failures.length ? 'fail' : 'pass', failures, documents, traceProtocol: protocol };
}

export function summarizeScaleRepeats(runs) {
  return Object.fromEntries([1, 10, 100, 1000].map(total => {
    const summarize = selected => Object.fromEntries(['ackMs', 'firstAdmissionMs', 'firstActiveVisibleMs', 'firstActiveReadyMs'].map(metric =>
      [metric, stats(selected.map(run => run.samples.find(sample => sample.total === total)?.[metric]))]));
    return [total, { observed: summarize(runs), validated: summarize(runs.filter(run => run.integrity?.status === 'pass')) }];
  }));
}
