import type { SpectrumPeak } from "./spectrum";

export type MsbuddySpectrumInputPeak = {
  index: number;
  mz: number;
  intensity: number;
  annotation: string;
  annotations: Record<string, string | number | boolean | null>;
};

export type MsbuddySpectrumInput = {
  title: string;
  format: string;
  precursorMz: number | null;
  candidateFormula: string | null;
  candidateIon: string | null;
  fragmentFormulas: string[];
  metadata: Record<string, string>;
  peaks: MsbuddySpectrumInputPeak[];
};

export type MsbuddyCandidate = {
  rank: number;
  formula: string;
  score: number | null;
  massErrorPpm: number | null;
  explainedPeakIndexes: number[];
  evidence: string;
  source: "msbuddy" | "spectrum";
};

export type MsbuddyAnnotationResult = {
  ok: boolean;
  runtime: "msbuddy" | "fallback" | "unavailable";
  message: string;
  candidates: MsbuddyCandidate[];
};

export function msbuddyPeakInput(peak: SpectrumPeak, index: number): MsbuddySpectrumInputPeak {
  return {
    index,
    mz: peak.x,
    intensity: peak.y,
    annotation: String(peak.annotations?.frag_base_form ?? peak.annotations?.formula ?? peak.label ?? ""),
    annotations: peak.annotations ?? {},
  };
}

export async function annotateSpectrumWithMsbuddy(input: MsbuddySpectrumInput): Promise<MsbuddyAnnotationResult> {
  const response = await fetchBrowserDevJson<MsbuddyAnnotationResult>("/__burette/msbuddy/annotate", { input });
  if (!response.ok) {
    throw new Error(response.message || "msbuddy annotation failed.");
  }
  return response;
}

async function fetchBrowserDevJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload: unknown = {};
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch (_) {
      throw new Error(text);
    }
  }
  if (!response.ok) {
    const error = payload && typeof payload === "object" && "error" in payload ? String(payload.error) : response.statusText;
    throw new Error(error);
  }
  return payload as T;
}
