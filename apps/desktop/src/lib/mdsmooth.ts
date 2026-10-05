import { Channel, invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "./tauri";

export type MdsmoothSignal = "rmsd" | "pc1" | "ic1" | "dpca" | "deeptica";
export type MdsmoothMode = "extrema" | "kinetic";

export type MdsmoothRequest = {
  trajectoryPath: string;
  topologyPath?: string | null;
  outputPath?: string;
  // Used when no outputPath names the extension; "dcd" writes coordinates only.
  outputFormat?: "pdb" | "xyz" | "dcd";
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
  // "pdb" when the run had a real topology to write back, "xyz" when all it knew
  // was elements and positions. The viewer needs it to parse the result correctly.
  outputFormat?: "pdb" | "xyz" | "dcd";
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

/** Runner progress; `fraction` covers the whole run, `done`/`total` count frames. */
export type MdsmoothProgress = {
  stage: "read" | "analyze" | "smooth" | "write" | "done";
  fraction: number;
  done?: number;
  total?: number;
};

export type MdsmoothCapabilities = {
  ok: true;
  signals: MdsmoothSignal[];
  modes: MdsmoothMode[];
  formats: string[];
  deepTicaInstalled: boolean;
};

async function runMdsmoothOperation<T>(request: Record<string, unknown>): Promise<T> {
  if (isTauriRuntime()) return invoke<T>("run_mdsmooth", { request });
  const response = await fetch("/__burette/mdsmooth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const payload = await response.json() as T & { error?: string; ok?: boolean };
  if (!response.ok || payload.ok !== true) throw new Error(payload.error || "MDSmooth operation failed");
  return payload;
}

export function getMdsmoothCapabilities(): Promise<MdsmoothCapabilities> {
  return runMdsmoothOperation<MdsmoothCapabilities>({ operation: "capabilities" });
}

export async function runMdsmooth(
  request: MdsmoothRequest,
  onProgress: (progress: MdsmoothProgress) => void = () => {},
): Promise<MdsmoothResult> {
  if (isTauriRuntime()) {
    const channel = new Channel<MdsmoothProgress>();
    channel.onmessage = onProgress;
    return invoke<MdsmoothResult>("run_mdsmooth", { request, onProgress: channel });
  }
  let response: Response;
  try {
    response = await fetch("/__burette/mdsmooth", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
      body: JSON.stringify(request),
    });
  } catch (_) {
    throw new Error("The MDSmooth runtime is unavailable. Restart the local preview and try again.");
  }
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || "MDSmooth analysis failed");
  }
  // The browser-dev route streams NDJSON: {progress}* then {result} or {error}.
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffered += value ?? "";
    const lines = buffered.split("\n");
    buffered = done ? "" : lines.pop() ?? "";
    for (const line of lines.filter(Boolean)) {
      const message = JSON.parse(line) as { progress?: MdsmoothProgress; result?: MdsmoothResult; error?: string };
      if (message.progress) onProgress(message.progress);
      else if (message.result?.ok === true) return message.result;
      else throw new Error(message.error || "MDSmooth analysis failed");
    }
    if (done) throw new Error("MDSmooth analysis failed");
  }
}

export async function installDeepTica(): Promise<void> {
  await runMdsmoothOperation({ operation: "installDeepTica" });
}
