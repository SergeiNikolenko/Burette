import type { ConformerJob } from "../types";

const listeners = new Set<(job: ConformerJob) => void>();

export function publishConformerJob(job: ConformerJob) {
  for (const listener of listeners) listener(job);
}

export function subscribeConformerJobs(listener: (job: ConformerJob) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
