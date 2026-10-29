import { ELEMENT_SYMBOLS } from "../molecular-workbench/elements";

const MIB = 1024 * 1024;

export const SCIENCE_SESSION_LIMITS = {
  /** MOLX files read for restore; Export → Scene writes at most 24 MiB. */
  archiveBytes: 32 * MIB,
  entries: 4096,
  assetIndexBytes: 4 * MIB,
  manifestBytes: 4 * MIB,
  attachments: 64,
  /** All attachment payloads together, excluding the manifest. */
  attachmentBytes: 20 * MIB,
  sourceBytes: 16 * MIB,
  atoms: 10_000,
  frames: 2_000,
  gridValues: 1_000_000,
  originalName: 512,
} as const;

export type ScienceSessionErrorCode = "archive" | "manifest" | "version" | "attachment" | "science" | "source" | "binding" | "limit";

/** A named reason a scientific session could not be written or restored. */
export class ScienceSessionError extends Error {
  readonly code: ScienceSessionErrorCode;
  constructor(code: ScienceSessionErrorCode, message: string) {
    super(message);
    this.name = "ScienceSessionError";
    this.code = code;
  }
}

export function normalizeElement(symbol: string) {
  if (/^\d{1,3}$/u.test(symbol)) {
    const number = Number(symbol);
    return number >= 1 && number <= ELEMENT_SYMBOLS.length ? ELEMENT_SYMBOLS[number - 1] : null;
  }
  const normalized = symbol.length ? symbol[0].toUpperCase() + symbol.slice(1).toLowerCase() : "";
  return ELEMENT_SYMBOLS.includes(normalized) ? normalized : null;
}
