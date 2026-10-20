import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { journalAction } from "../lib/action-journal";
import { isTauriRuntime } from "../lib/tauri";
import { useSettingsStore } from "../stores/settings-store";

type LifecycleJob = {
  id: string;
  status: string;
  startedAt: number;
  completedAt?: number | null;
};

const ACTIVE_STATUSES = new Set(["queued", "running"]);
/** Jobs shorter than this finish before anyone looks away; they never notify. */
const NOTIFY_MIN_DURATION_MS = 15_000;
const RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const STATUS_PHRASES: Record<string, string> = {
  success: "finished",
  recovered: "finished with some failures",
  failed: "failed",
  cancelled: "was cancelled",
};

const isActive = (job: LifecycleJob) => ACTIVE_STATUSES.has(job.status);

const JOURNAL_FIELDS = ["operation", "host", "inputLabel", "inputTitle", "documentTitle", "query", "progress", "backend", "durableJobId", "workDir", "logPath", "reportPath", "primaryOpenPath", "error"];
const JOURNAL_RESULT_FIELDS = ["inputPath", "workDir", "primaryOpenPath", "exitCode", "errorSummary", "error"];

function pickFields(source: unknown, fields: string[]) {
  if (!source || typeof source !== "object") return undefined;
  const record = source as Record<string, unknown>;
  const picked = Object.fromEntries(fields
    .filter(field => typeof record[field] === "string" || typeof record[field] === "number")
    .map(field => [field, record[field]]));
  return Object.keys(picked).length > 0 ? picked : undefined;
}

/** Journals each status change with the inputs and run folder needed to replay it. */
function journalJobTransition(listKey: string, title: string, job: LifecycleJob) {
  const result = pickFields((job as { result?: unknown }).result, JOURNAL_RESULT_FIELDS);
  journalAction("job", `${listKey}:${job.status}`, {
    target: title,
    detail: { id: job.id, ...pickFields(job, JOURNAL_FIELDS), ...(result ? { result } : {}) },
  });
}

// Running-job counts per job list, aggregated so one window holds a single
// sleep-prevention request no matter how many lists have work in flight.
const runningJobCounts = new Map<string, number>();
let sleepPreventionRequested = false;

function syncSleepPrevention() {
  const running = [...runningJobCounts.values()].some((count) => count > 0);
  const active = running && useSettingsStore.getState().preferences.preventSleepDuringJobs;
  if (active === sleepPreventionRequested || !isTauriRuntime()) return;
  sleepPreventionRequested = active;
  void invoke("set_sleep_prevention", { active }).catch(() => {
    sleepPreventionRequested = !active;
  });
}

useSettingsStore.subscribe((state, previous) => {
  if (state.preferences.preventSleepDuringJobs !== previous.preferences.preventSleepDuringJobs) syncSleepPrevention();
});

function notifyFinished(title: string, status: string) {
  if (!isTauriRuntime()) return;
  const phrase = STATUS_PHRASES[status] ?? "finished";
  void invoke("notify_job_finished", { title: "Burette", body: `${title} ${phrase}` }).catch(() => {});
}

/**
 * App-level job behavior shared by every job list: keeps the Mac awake while
 * jobs run, notifies when a long job ends while the window is in the
 * background, and drops finished jobs past the history retention window.
 */
export function useJobLifecycle<T extends LifecycleJob>(
  listKey: string,
  jobs: T[],
  setJobs: Dispatch<SetStateAction<T[]>>,
  jobTitle: (job: T) => string,
) {
  const previousStatusesRef = useRef(new Map<string, string>());
  const retentionDays = useSettingsStore((state) => state.preferences.jobHistoryRetentionDays);

  useEffect(() => {
    const previousStatuses = previousStatusesRef.current;
    const { notifyOnJobCompletion } = useSettingsStore.getState().preferences;
    const now = Date.now();
    for (const job of jobs) {
      const previous = previousStatuses.get(job.id);
      if (previous !== job.status) journalJobTransition(listKey, jobTitle(job), job);
      if (
        notifyOnJobCompletion
        && previous && ACTIVE_STATUSES.has(previous) && !isActive(job)
        && (job.completedAt ?? now) - job.startedAt >= NOTIFY_MIN_DURATION_MS
        && !document.hasFocus()
      ) notifyFinished(jobTitle(job), job.status);
    }
    previousStatusesRef.current = new Map(jobs.map((job) => [job.id, job.status]));
    runningJobCounts.set(listKey, jobs.filter(isActive).length);
    syncSleepPrevention();
  }, [jobTitle, jobs, listKey]);

  useEffect(() => () => {
    runningJobCounts.delete(listKey);
    syncSleepPrevention();
  }, [listKey]);

  useEffect(() => {
    if (retentionDays <= 0) return;
    const prune = () => {
      const cutoff = Date.now() - retentionDays * DAY_MS;
      setJobs((previous) => {
        const kept = previous.filter((job) => isActive(job) || (job.completedAt ?? job.startedAt) >= cutoff);
        return kept.length === previous.length ? previous : kept;
      });
    };
    prune();
    const timer = window.setInterval(prune, RETENTION_SWEEP_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [retentionDays, setJobs]);
}
