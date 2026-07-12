import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "./tauri";

export type MdsmoothSignal = "rmsd" | "pc1" | "ic1" | "dpca" | "deeptica";
export type MdsmoothMode = "extrema" | "kinetic";

export type MdsmoothRequest = {
  trajectoryPath: string;
  topologyPath?: string | null;
  outputPath?: string;
  signal: MdsmoothSignal;
  mode: MdsmoothMode;
  selection?: string;
  lag?: number;
  referenceFrame?: number;
  align?: boolean;
  targetFrames?: number;
  cutoffFrequency?: number;
  powerCutoff?: number;
  order?: number;
  includeEnds?: boolean;
  extraFrames?: number[];
  states?: number;
  microstates?: number;
  ticaDimensions?: number;
};

export type MdsmoothResult = {
  ok: true;
  trajectoryPath: string;
  topologyPath: string | null;
  outputPath: string;
  signal: MdsmoothSignal;
  selection: string;
  selectedAtomCount: number;
  frameCount: number;
  keyframes: number[];
  keyframeKinds: string[];
  rawSignal: number[];
  filteredSignal: number[];
  cutoffFrequency: number | null;
  spectrum: {
    frequencies: number[];
    power: number[];
    cumulativePower: number[];
  };
  diagnostics: Record<string, number | string | boolean | number[]>;
  interpolation: string;
};

export async function runMdsmooth(request: MdsmoothRequest): Promise<MdsmoothResult> {
  if (isTauriRuntime()) return invoke<MdsmoothResult>("run_mdsmooth", { request });
  let response: Response;
  try {
    response = await fetch("/__burette/mdsmooth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch (_) {
    throw new Error("The MDSmooth runtime is unavailable. Restart the local preview and try again.");
  }
  const payload = await response.json() as MdsmoothResult | { error?: string };
  if (!response.ok || (!("ok" in payload) || payload.ok !== true)) {
    throw new Error("error" in payload ? payload.error || "MDSmooth analysis failed" : "MDSmooth analysis failed");
  }
  return payload;
}

export async function installDeepTica(): Promise<void> {
  const request = { operation: "installDeepTica" };
  if (isTauriRuntime()) {
    await invoke("run_mdsmooth", { request });
    return;
  }
  const response = await fetch("/__burette/mdsmooth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(await response.text());
}
