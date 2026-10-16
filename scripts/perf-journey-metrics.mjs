// Trace reductions shared by the packaged journey runner and its tests.
const BUDGETS = {
  'tab:switch': { visibleMs: 100, blankFrames: 0, loads: 0, stallMs: 100 },
  'pose:step': { stepMs: 100, stallMs: 100 },
  'trajectory:step': { stepMs: 100, stallMs: 100 },
  'spin:large-cif': { frameP95Ms: 16.7 },
  launch: { stallMs: 100 },
};

export function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))];
}

export function stats(values, digits = 1) {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return null;
  const scale = 10 ** digits;
  const round = value => Math.round(value * scale) / scale;
  return {
    n: finite.length,
    p50: round(percentile(finite, 0.5)),
    p95: round(percentile(finite, 0.95)),
    p25: round(percentile(finite, 0.25)),
    p75: round(percentile(finite, 0.75)),
    min: round(Math.min(...finite)),
    max: round(Math.max(...finite)),
  };
}

export function frameIntervals(lines, from, to) {
  const intervals = [];
  for (const line of lines) {
    if (line.name !== 'frames' || !Array.isArray(line.detail?.intervals)) continue;
    let at = line.at;
    for (const interval of line.detail.intervals) {
      at += interval;
      if (at >= from && at <= to) intervals.push(interval);
    }
  }
  return intervals;
}

// Main-thread cost inside a window: IPC handlers that ran on the main thread
// and how late the main queue ran.
export function mainThread(lines, from, to) {
  const ipc = lines.filter(line => line.source === 'ipc' && line.at + line.ms >= from && line.at <= to);
  const onMain = ipc.filter(line => line.mainThread);
  const late = lines.filter(line => line.name === 'main-queue:late' && line.at + line.ms >= from && line.at <= to).map(line => line.ms);
  const slowest = onMain.filter(line => line.ms >= 16).sort((left, right) => right.ms - left.ms).slice(0, 4)
    .map(line => `${line.name} ${Math.round(line.ms)}ms`);
  const probes = ipc.filter(line => /^(xtb_status|conformer_status|rgroup_runtime_status)$/.test(line.name));
  return {
    foldingReads: ipc.filter(line => line.name === 'read_folding_result_bundle').length,
    editorMainMs: onMain.filter(line => line.name === 'list_chemical_editor_targets').reduce((sum, line) => sum + line.ms, 0),
    probeCalls: probes.length,
    probeMainMs: probes.filter(line => line.mainThread).reduce((sum, line) => sum + line.ms, 0),
    ipcCalls: ipc.length,
    ipcMainMs: onMain.reduce((sum, line) => sum + line.ms, 0),
    stallMs: Math.max(0, ...late, ...onMain.map(line => line.ms)),
    slowest,
  };
}

export function record(samples, values) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    (samples[key] ??= []).push(value);
  }
}

export function summarize(results) {
  const summary = {};
  for (const [journey, result] of Object.entries(results)) {
    summary[journey] = Object.fromEntries(Object.entries(result.samples).map(([metric, values]) => [metric, stats(values, metric === 'onTimeShare' ? 4 : 1)]));
  }
  return summary;
}

export function budgetFailures(summary) {
  const failures = [];
  for (const [journey, budget] of Object.entries(BUDGETS)) {
    if (!summary[journey]) continue;
    for (const [metric, limit] of Object.entries(budget)) {
      const value = summary[journey]?.[metric]?.p95;
      if (!Number.isFinite(value)) failures.push(`${journey} ${metric} missing`);
      else if (value > limit) failures.push(`${journey} ${metric} p95 ${value} > ${limit}`);
    }
  }
  return failures;
}

// A change counts when the medians differ by more than the larger
// interquartile range of the two runs, or 5 % of the baseline median.
export function compareSummaries(before, after) {
  const rows = [];
  const regressions = [];
  for (const journey of Object.keys(before)) {
    if (!after[journey]) regressions.push(`${journey} missing from the new report`);
    else for (const metric of Object.keys(before[journey])) {
      if (before[journey][metric] && !after[journey][metric]) regressions.push(`${journey} ${metric} missing from the new report`);
    }
  }
  for (const [journey, metrics] of Object.entries(after)) {
    for (const [metric, now] of Object.entries(metrics)) {
      const then = before[journey]?.[metric];
      if (!now || !then) continue;
      const noise = Math.max(then.p75 - then.p25, now.p75 - now.p25, Math.abs(then.p50) * 0.05, metric === 'onTimeShare' ? 0.005 : 0.5);
      const direction = metric === 'onTimeShare' ? -1 : 1;
      const delta = (now.p50 - then.p50) * direction;
      const verdict = delta < -noise ? 'faster' : delta > noise ? 'slower' : 'same';
      const p95Noise = Math.max(noise, Math.abs(then.p95) * 0.1);
      if ((now.p95 - then.p95) * direction > p95Noise) regressions.push(`${journey} ${metric} p95 ${then.p95} -> ${now.p95}`);
      rows.push(`| ${journey} | ${metric} | ${then.p50} / ${then.p95} | ${now.p50} / ${now.p95} | ${verdict} |`);
    }
  }
  return { rows, regressions };
}

export function printSummary(summary) {
  console.log('| journey | metric | n | p50 | p95 | min | max |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  for (const [journey, metrics] of Object.entries(summary)) {
    for (const [metric, value] of Object.entries(metrics)) {
      if (!value) continue;
      console.log(`| ${journey} | ${metric} | ${value.n} | ${value.p50} | ${value.p95} | ${value.min} | ${value.max} |`);
    }
  }
}

