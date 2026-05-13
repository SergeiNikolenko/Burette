type StartupMetric = {
  label: string;
  startedAt: number;
  finishedAt?: number;
};

const metrics: StartupMetric[] = [];

export function startStartupMetric(label: string) {
  const metric: StartupMetric = {
    label,
    startedAt: performance.now(),
  };
  metrics.push(metric);
  return () => {
    metric.finishedAt = performance.now();
  };
}

export function getStartupMetrics() {
  return metrics.map((metric) => ({
    label: metric.label,
    durationMs: metric.finishedAt === undefined ? null : metric.finishedAt - metric.startedAt,
  }));
}
