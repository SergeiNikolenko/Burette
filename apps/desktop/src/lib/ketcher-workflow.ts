import type { KetcherImportRequest, KetcherSource3D } from "../components/types";

export function queueKetcherImportRequest(request: KetcherImportRequest) {
  const targetWindow = window as Window & { __buretteKetcherImportRequest?: KetcherImportRequest | null };
  targetWindow.__buretteKetcherImportRequest = request;
  window.dispatchEvent(new CustomEvent("burette:ketcher-import", { detail: request }));
}

export function ketcherSource3DFromText(title: string, text: string, extension: string): KetcherSource3D | undefined {
  const cleanText = text.trim();
  if (!cleanText) return undefined;
  const cleanExtension = extension.trim().replace(/^\./u, "").toLowerCase();
  if (!["sdf", "sd", "mol"].includes(cleanExtension)) return undefined;
  return {
    title: title.trim() || "structure",
    extension: cleanExtension,
    text: cleanText,
  };
}

export function ketcherDraftMolfileFromImportText(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  if (!normalized.trim()) return null;
  const records = normalized.split(/\n\$\$\$\$\s*(?:\n|$)/u).map((record) => record.trimEnd()).filter(Boolean);
  if (records.length === 1 && normalized !== records[0]) {
    const [record] = records;
    return record && looksLikeMolfile(record) ? record + "\n" : null;
  }
  return looksLikeMolfile(normalized) ? normalized + "\n" : null;
}

function looksLikeMolfile(text: string) {
  const lines = text.split("\n");
  return lines.length >= 4 && /^\s*\d+\s+\d+\b/u.test(lines[3] ?? "");
}
