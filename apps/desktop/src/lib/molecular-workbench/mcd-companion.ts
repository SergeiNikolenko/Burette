import { checkScientificSpectra, type ScientificSpectra } from "./scientific-spectra";

/** Exact byte identities plus the acknowledged logical source revision. */
export type McdCompanionBinding = {
  readonly primaryOriginalSha256: string;
  readonly companionOriginalSha256: string;
  readonly sourceRevisionSha256: string;
};
export type ScientificMcdCompanion = McdCompanionBinding & { readonly spectra: ScientificSpectra };
export type McdCompanionOwner = McdCompanionBinding & {
  readonly frameIndex: number; readonly frameCount: number; readonly atomicNumbers: readonly number[];
};

const HASHES = ["primaryOriginalSha256", "companionOriginalSha256", "sourceRevisionSha256"] as const;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
function fail(message: string): never { throw new Error(`Invalid MCD companion: ${message}`); }

/**
 * Validate a prepared pair against an independently retained source/frame owner.
 * The caller captures that owner before reading the explicitly selected file.
 * This does not acquire a source, discover a sibling, or publish a revision.
 */
export function checkMcdCompanion(value: unknown, owner: McdCompanionOwner): ScientificMcdCompanion {
  if (!Number.isSafeInteger(owner.frameIndex) || !Number.isSafeInteger(owner.frameCount)
    || owner.frameIndex < 0 || owner.frameIndex >= owner.frameCount || !owner.atomicNumbers.length) fail("invalid source frame owner.");
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("expected a prepared pair.");
  const pair = value as Record<string, unknown>;
  if (Object.keys(pair).some(key => key !== "spectra" && !HASHES.includes(key as typeof HASHES[number]))) fail("unknown pairing fields.");
  for (const key of HASHES) {
    if (!hash(pair[key]) || !hash(owner[key]) || pair[key] !== owner[key]) fail(`${key} does not match the retained source owner.`);
  }
  const data = checkScientificSpectra(pair.spectra);
  if (data.source.format !== "orca-mcd" || data.source.scope !== "frame"
    || data.source.frameIndex !== owner.frameIndex || data.source.frameCount !== owner.frameCount) fail("data does not belong to this exact scientific frame.");
  if (data.atomicNumbers.length !== owner.atomicNumbers.length
    || data.atomicNumbers.some((number, index) => number !== owner.atomicNumbers[index])) fail("source atom order does not match the retained frame.");
  const signal = data.spectra[0];
  if (data.spectra.length !== 1 || signal.kind !== "mcd" || signal.valueUnit !== null || signal.sourceRowIds !== undefined
    || signal.auxiliary?.length !== 1 || signal.auxiliary[0].name !== "absorption" || signal.auxiliary[0].unit !== null) {
    fail("expected the native MCD signal and its unmodified absorption column.");
  }
  if (signal.positions.some((position, index) => index > 0 && position < signal.positions[index - 1])) fail("select one monotonic source block.");
  return value as ScientificMcdCompanion;
}
