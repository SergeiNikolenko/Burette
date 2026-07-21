import type {
  ConformerExtractionWorkerRequest,
  ConformerExtractionWorkerResponse,
  ConformerVariant,
  MmffVariant,
} from "./compute-conformer";
import type { ConformerGenerationResult } from "./conformer-generation";
import type { StandaloneAlignmentResult, StandaloneComputeSource, StandaloneSemiempiricalResult } from "./standalone-compute";
import { stableTextDocumentId } from "./file-export";
import type { TextFileDocument } from "../types";

type BrowserDevNativeComputeOperation = "generate3d" | "generateEnsemble" | "optimizeGeometry" | "semiempiricalRm1" | "alignPoses";

type BrowserDevNativeComputeResponse<T> = {
  provider: "nativeMetalDevBridge";
  result: T;
};

export function runBrowserDevSemiempirical(
  source: StandaloneComputeSource,
): Promise<StandaloneSemiempiricalResult> {
  return runBrowserDevNativeCompute<StandaloneSemiempiricalResult>(source, "semiempiricalRm1")
    .then((result) => {
      if (result.backend !== "nativeMetalScfHybrid") {
        throw new Error("Metal-only semi-empirical workflow rejected a non-Metal result.");
      }
      return result;
    });
}

export function runBrowserDevAlignment(
  source: StandaloneComputeSource,
): Promise<StandaloneAlignmentResult> {
  return runBrowserDevNativeCompute(source, "alignPoses");
}

export async function runBrowserDevMetalConformer(
  source: StandaloneComputeSource,
  options: {
    variant?: ConformerVariant;
    mmffVariant?: MmffVariant;
    mode?: "single" | "ensemble";
    optimize?: boolean;
  } = {},
): Promise<ConformerGenerationResult> {
  const variant = options.variant ?? "ETKDGv3";
  const mmffVariant = options.mmffVariant ?? "MMFF94s";
  const records = standaloneExtractionRecords(source);
  const extracted = await extractStandaloneConformers(records, variant, mmffVariant);
  const operation: BrowserDevNativeComputeOperation = options.optimize
    ? "optimizeGeometry"
    : options.mode === "ensemble" ? "generateEnsemble" : "generate3d";
  const result = await runBrowserDevNativeCompute<ConformerGenerationResult & { backend?: string }>(source, operation, {
    variant,
    mmffVariant,
    records: records.map((record, index) => ({
      template: record.format === "molblock" ? record.input : null,
      conformerBase64: arrayBufferToBase64(extracted[index]?.conformer),
      mmffBase64: arrayBufferToBase64(extracted[index]?.mmff),
    })),
  });
  if (result.backend !== "nativeMetal") {
    throw new Error("Metal-only conformer workflow rejected a non-Metal result.");
  }
  return result;
}

async function runBrowserDevNativeCompute<T>(
  source: StandaloneComputeSource,
  operation: BrowserDevNativeComputeOperation,
  conformer?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch("/__burette/native-compute", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ operation, source, conformer }),
  });
  const payload = await response.json().catch(() => null) as BrowserDevNativeComputeResponse<T> & { error?: unknown } | null;
  if (!response.ok) {
    const message = typeof payload?.error === "string" && payload.error.trim()
      ? payload.error.trim()
      : `Native compute request failed with status ${response.status}`;
    throw new Error(message);
  }
  if (!payload || payload.provider !== "nativeMetalDevBridge" || !payload.result) {
    throw new Error("Native Metal dev backend returned an invalid response.");
  }
  return payload.result;
}

function standaloneExtractionRecords(source: StandaloneComputeSource) {
  const extension = source.extension.trim().replace(/^\./u, "").toLowerCase();
  if (extension === "mol") return [{ input: source.text, format: "molblock" as const }];
  if (extension === "sdf" || extension === "sd") {
    const records = source.text.split("$$$$")
      .map((record) => record.trim())
      .filter(Boolean)
      .map((input) => ({ input, format: "molblock" as const }));
    if (records.length) return records;
  }
  if (extension === "smi" || extension === "smiles") {
    const records = source.text.split(/\r?\n/u)
      .map((line) => line.trim().split(/\s+/u)[0] || "")
      .filter(Boolean)
      .map((input) => ({ input, format: "smiles" as const }));
    if (records.length) return records;
  }
  throw new Error("Native Metal conformer generation accepts MOL, SDF, or SMILES input.");
}

function extractStandaloneConformers(
  records: Array<{ input: string; format: "molblock" | "smiles" }>,
  variant: ConformerVariant,
  mmffVariant: MmffVariant,
): Promise<Array<{ conformer: ArrayBuffer; mmff: ArrayBuffer }>> {
  const worker = new Worker(new URL("../workers/conformer-extract.worker.ts", import.meta.url), {
    name: "burrete-browser-metal-conformer-extraction",
    type: "module",
  });
  const requestId = `browser-metal-conformer-${crypto.randomUUID()}`;
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(() => reject(new Error("Native conformer preprocessing timed out."))), 120_000);
    const finish = (action: () => void) => {
      window.clearTimeout(timeout);
      worker.terminate();
      action();
    };
    worker.addEventListener("message", (event: MessageEvent<ConformerExtractionWorkerResponse>) => {
      if (event.data.requestId !== requestId || event.data.type !== "standaloneConformerResult") return;
      if (event.data.error) finish(() => reject(new Error(event.data.error)));
      else {
        const extracted = event.data.records;
        if (extracted?.length === records.length) finish(() => resolve(extracted));
        else finish(() => reject(new Error("Native conformer preprocessing returned an invalid record set.")));
      }
    });
    worker.addEventListener("error", (event) => finish(() => reject(new Error(event.message || "Native conformer preprocessing failed."))));
    const request: ConformerExtractionWorkerRequest = {
      type: "extractStandaloneConformers",
      requestId,
      variant,
      mmffVariant,
      records,
    };
    worker.postMessage(request);
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer | undefined) {
  if (!buffer) throw new Error("Native conformer preprocessing returned an empty payload.");
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function browserDevComputeReportDocument(
  title: string,
  result: unknown,
): TextFileDocument {
  const content = `${JSON.stringify(result, null, 2)}\n`;
  const id = stableTextDocumentId(`browser-dev-compute:${title}:${content}`);
  return {
    id,
    path: `burrete-compute-report://${id}/${title}`,
    title,
    extension: "json",
    language: "json",
    byteCount: new TextEncoder().encode(content).byteLength,
    content,
    truncated: false,
    modifiedAt: Date.now(),
  };
}
