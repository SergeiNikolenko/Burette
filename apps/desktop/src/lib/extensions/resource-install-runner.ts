import { CRYSTALS_RESOURCE, resourceAbort, type InstalledResource } from "./resource-bundle";
import { downloadCrystals } from "./crystals-download";
import { createResourceStore } from "./resource-store";

export type ResourceJob = {
  id: string; title: string; operation: "install" | "remove";
  status: "queued" | "running" | "success" | "failed" | "cancelled";
  startedAt: number; completedAt?: number; cancelable: boolean;
  phase: "reading" | "installing" | "removing"; receivedBytes: number; totalBytes: number;
  error?: string;
};
type Snapshot = { installed: InstalledResource | null; initialized: boolean; error: string | null; jobs: readonly ResourceJob[] };
type Options = { store?: ReturnType<typeof createResourceStore>; fetcher?: typeof fetch };
const active = (job: ResourceJob) => job.status === "queued" || job.status === "running";
const cancelled = (error: unknown) => error instanceof Error && error.name === "AbortError";
function failure(operation: ResourceJob["operation"], error: unknown) {
  if (error instanceof Error && error.name === "QuotaExceededError") return "Not enough storage. Free some space and retry.";
  return operation === "install" ? "Crystals could not be installed. Try again." : "Crystals could not be removed. Try again.";
}

/** One Crystals operation per runner. Mount its hook at app level, independently of Settings. */
export function createResourceInstallRunner({ store = createResourceStore(), fetcher = globalThis.fetch }: Options = {}) {
  let snapshot: Snapshot = { installed: null, initialized: false, error: null, jobs: [] }, refreshEpoch = 0, refreshRequested = false;
  const listeners = new Set<() => void>();
  let flight: { id: string; operation: ResourceJob["operation"]; controller: AbortController; promise: Promise<ResourceJob> } | undefined;
  function publish(patch: Partial<Snapshot>) {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach(listener => listener());
  }
  function update(id: string, patch: Partial<ResourceJob>) {
    const jobs = snapshot.jobs.map(job => job.id === id ? { ...job, ...patch } : job);
    const updated = jobs.find(job => job.id === id)!;
    publish({ jobs }); return updated;
  }
  async function refresh() {
    if (flight) { refreshRequested = true; return; }
    const epoch = ++refreshEpoch;
    try {
      const installed = await store.getInstalled(CRYSTALS_RESOURCE.id);
      if (epoch === refreshEpoch) publish({ installed, initialized: true, error: null });
    } catch {
      if (epoch === refreshEpoch) publish({ initialized: true, error: "Installed extensions could not be read. Retry." });
    }
  }
  function start(operation: ResourceJob["operation"]): Promise<ResourceJob> {
    if (flight) return flight.operation === operation ? flight.promise : Promise.reject(new Error("An extension operation is still running. Cancel it before retrying."));
    ++refreshEpoch;
    const id = crypto.randomUUID(), controller = new AbortController();
    const job: ResourceJob = { id, operation, title: operation === "install" ? "Install Crystals" : "Remove Crystals", status: "queued", startedAt: Date.now(),
      cancelable: true, phase: operation === "install" ? "reading" : "removing", receivedBytes: 0, totalBytes: operation === "install" ? CRYSTALS_RESOURCE.compressed.bytes : 0 };
    const promise = Promise.resolve().then(async () => {
      let completed: ResourceJob;
      update(id, { status: "running" });
      try {
        resourceAbort(controller.signal);
        let installed: InstalledResource | null = null;
        if (operation === "install") {
          const bytes = await downloadCrystals(fetcher, controller.signal, receivedBytes => update(id, { receivedBytes }));
          resourceAbort(controller.signal); update(id, { phase: "installing" });
          installed = await store.install(CRYSTALS_RESOURCE, bytes, controller.signal);
        } else await store.remove(CRYSTALS_RESOURCE.id, controller.signal);
        // Store completion is the commit point. A late signal must not undo success.
        publish({ installed, initialized: true }); completed = update(id, { status: "success", cancelable: false, completedAt: Date.now() });
      } catch (error) {
        refreshRequested = true; // Reconcile reads invalidated when the operation began.
        completed = update(id, { status: cancelled(error) || controller.signal.aborted ? "cancelled" : "failed", cancelable: false, completedAt: Date.now(),
          error: cancelled(error) || controller.signal.aborted ? undefined : failure(operation, error) });
      } finally {
        flight = undefined;
        if (refreshRequested) { refreshRequested = false; void refresh(); }
      }
      return completed;
    });
    flight = { id, operation, controller, promise };
    publish({ error: null, jobs: [job, ...snapshot.jobs].slice(0, 20) });
    return promise;
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    installCrystals: () => start("install"),
    remove: () => start("remove"),
    cancel(jobId: string) {
      if (flight?.id !== jobId || !snapshot.jobs.find(job => job.id === jobId)?.cancelable) return;
      update(jobId, { cancelable: false }); flight.controller.abort();
    },
    clearFinished() { publish({ jobs: snapshot.jobs.filter(active) }); },
    refresh,
  };
}
