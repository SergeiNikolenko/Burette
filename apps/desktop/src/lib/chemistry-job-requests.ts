import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "./tauri";
import type {
  ConformerPreparedRun,
  ConformerRunRequest,
  ConformerRunResult,
  ConformerStatus,
  XtbRunRequest,
  XtbRunResult,
  XtbStatus,
} from "../types";

export async function requestXtbStatus(): Promise<XtbStatus> {
  if (isTauriRuntime()) return invoke<XtbStatus>("xtb_status");
  return browserDevXtbJson<XtbStatus>("/__burette/xtb-status");
}

export async function selectXtbExecutableRequest(executablePath: string | null): Promise<XtbStatus> {
  if (isTauriRuntime()) {
    return invoke<XtbStatus>("select_xtb_executable", { executablePath });
  }
  return browserDevXtbJson<XtbStatus>("/__burette/select-xtb-executable", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ executablePath }),
  });
}

export async function requestConformerStatus(): Promise<ConformerStatus> {
  if (isTauriRuntime()) return invoke<ConformerStatus>("conformer_status");
  return browserDevConformerJson<ConformerStatus>("/__burette/conformer-status");
}

export async function prepareConformerRequest(request: ConformerRunRequest): Promise<ConformerPreparedRun> {
  if (isTauriRuntime()) return invoke<ConformerPreparedRun>("prepare_conformer_job", { request });
  return browserDevConformerJson<ConformerPreparedRun>("/__burette/prepare-conformer-job", request);
}

export async function runConformerRequest(request: ConformerRunRequest): Promise<ConformerRunResult> {
  if (isTauriRuntime()) return invoke<ConformerRunResult>("run_conformer_job", { request });
  return browserDevConformerJson<ConformerRunResult>("/__burette/run-conformer-job", request);
}

export async function cancelConformerRequest(jobId: string): Promise<void> {
  if (isTauriRuntime()) return invoke<void>("cancel_conformer_job", { jobId });
  await browserDevConformerJson<{ ok: boolean }>("/__burette/cancel-conformer-job", { jobId });
}

export async function installXtbRequest(): Promise<XtbStatus> {
  if (isTauriRuntime()) return invoke<XtbStatus>("install_xtb");
  return browserDevXtbJson<XtbStatus>("/__burette/install-xtb", {
    method: "POST",
  });
}

export async function runXtbRequest(request: XtbRunRequest): Promise<XtbRunResult> {
  if (isTauriRuntime()) return invoke<XtbRunResult>("run_xtb_job", { request });
  return browserDevXtbJson<XtbRunResult>("/__burette/run-xtb-job", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}

export async function cancelXtbRequest(jobId: string): Promise<void> {
  if (isTauriRuntime()) return invoke<void>("cancel_xtb_job", { jobId });
  await browserDevXtbJson<{ ok: boolean }>("/__burette/cancel-xtb-job", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId }),
  });
}

async function browserDevXtbJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => null) as { error?: unknown } | T | null;
  if (!response.ok) {
    const message = payload && typeof (payload as { error?: unknown }).error === "string"
      ? String((payload as { error: string }).error)
      : `xTB browser-dev request failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

async function browserDevConformerJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? { cache: "no-store" } : {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as { error?: unknown } | T | null;
  if (!response.ok) {
    const message = payload && typeof (payload as { error?: unknown }).error === "string"
      ? String((payload as { error: string }).error)
      : `CREST/PRISM browser-dev request failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}
