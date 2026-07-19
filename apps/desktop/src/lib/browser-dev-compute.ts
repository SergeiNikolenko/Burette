import type { StandaloneAlignmentResult, StandaloneComputeSource, StandaloneSemiempiricalResult } from "./standalone-compute";
import { stableTextDocumentId } from "./file-export";
import type { TextFileDocument } from "../types";

type BrowserDevNativeComputeOperation = "semiempiricalRm1" | "alignPoses";

type BrowserDevNativeComputeResponse<T> = {
  provider: "nativeMetalDevBridge";
  result: T;
};

async function runBrowserDevNativeCompute<T>(
  source: StandaloneComputeSource,
  operation: BrowserDevNativeComputeOperation,
): Promise<T> {
  const response = await fetch("/__burette/native-compute", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ operation, source }),
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

export function runBrowserDevSemiempirical(
  source: StandaloneComputeSource,
): Promise<StandaloneSemiempiricalResult> {
  return runBrowserDevNativeCompute(source, "semiempiricalRm1");
}

export function runBrowserDevAlignment(
  source: StandaloneComputeSource,
): Promise<StandaloneAlignmentResult> {
  return runBrowserDevNativeCompute(source, "alignPoses");
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
