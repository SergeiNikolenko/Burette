const marked = new Set<string>();

export function markPerformance(name: string) {
  if (typeof performance === "undefined" || typeof performance.mark !== "function") return;
  try {
    performance.mark(name);
  } catch (_) {
    // Performance marks are diagnostic only and must not affect startup.
  }
}

export function markPerformanceOnce(name: string) {
  if (marked.has(name)) return;
  marked.add(name);
  markPerformance(name);
}

export type PerformanceMarkSnapshot = {
  name: string;
  startTimeMs: number;
};

export function collectPerformanceMarks(): PerformanceMarkSnapshot[] {
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") return [];
  return performance.getEntriesByType("mark").map((entry) => ({
    name: entry.name,
    startTimeMs: entry.startTime,
  }));
}

export async function measureAsync<T>(name: string, task: () => Promise<T>): Promise<T> {
  markPerformance(`${name}:start`);
  try {
    return await task();
  } finally {
    markPerformance(`${name}:end`);
  }
}
