import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";

import { isSshConnectionEnabled } from "./ssh-projects";
import { isTauriRuntime } from "./tauri";

const key = "burette.compute-host.v1";
const event = "burette-compute-host-changed";

/** The SSH alias xTB and CREST run on, or null for this Mac. */
export function computeHost(): string | null {
  if (!isTauriRuntime()) return null;
  const host = localStorage.getItem(key);
  return host && isSshConnectionEnabled(host) ? host : null;
}

export function setComputeHost(host: string | null) {
  if (host) localStorage.setItem(key, host);
  else localStorage.removeItem(key);
  window.dispatchEvent(new Event(event));
}

function subscribe(callback: () => void) {
  window.addEventListener(event, callback);
  window.addEventListener("storage", callback);
  window.addEventListener("burette-ssh-projects-changed", callback);
  return () => {
    window.removeEventListener(event, callback);
    window.removeEventListener("storage", callback);
    window.removeEventListener("burette-ssh-projects-changed", callback);
  };
}

export function useComputeHost() {
  return useSyncExternalStore(subscribe, computeHost);
}

/** A job started on an SSH host that no window follows yet, e.g. after a restart. */
export type RemoteJob = {
  id: string;
  host: string;
  tool: "xtb" | "crest" | "prism";
  workDir: string;
  logPath: string;
  context: Record<string, unknown>;
  state: string;
  submittedAt: number;
};

export function listRemoteJobs() {
  return isTauriRuntime() ? invoke<RemoteJob[]>("remote_job_list") : Promise.resolve([]);
}

/** Resolves with the same result a local run returns once the job ends and its outputs are downloaded. */
export function resumeRemoteJob<T>(jobId: string) {
  return invoke<T>("remote_job_resume", { jobId });
}
