import { sha256Hex } from "../source-editing/source-identity";
import { ScienceSessionError } from "../science-session/contracts";
import type { McdCompanionOriginal } from "../science-session/mcd-originals";
import type { ImportedRevision } from "./scientific-source-state";

/** Only a managed history transition may carry calculated data to a new source receipt. */
export async function mcdDataForExport(revision: ImportedRevision | null, text: string, companions: readonly McdCompanionOriginal[] | undefined) {
  if (revision && revision.text !== text) throw new ScienceSessionError("source", "The current source does not match its scientific revision.");
  const science = revision?.document ?? null;
  if (!science?.frames.some(frame => frame.mcdCompanion)) return { science, companions };
  const currentSha256 = await sha256Hex(text);
  if (science.frames.every(frame => !frame.mcdCompanion || frame.mcdCompanion.sourceRevisionSha256 === currentSha256)) return { science, companions };
  const origin = revision?.retainedScienceFrom;
  if (!origin || origin.document.frames !== science.frames || origin.document.atoms !== science.atoms) {
    throw new ScienceSessionError("source", "The MCD source revision changed without a managed scientific owner transition.");
  }
  const originSha256 = await sha256Hex(origin.text);
  const frames = science.frames.map(frame => {
    const pair = frame.mcdCompanion;
    if (!pair || pair.sourceRevisionSha256 === currentSha256) return frame;
    if (pair.sourceRevisionSha256 !== originSha256) throw new ScienceSessionError("source", "The MCD data does not belong to the retained scientific origin.");
    return { ...frame, mcdCompanion: { ...pair, sourceRevisionSha256: currentSha256 } };
  });
  const originals = companions?.map(original => {
    const pair = science.frames[original.frameIndex]?.mcdCompanion;
    if (!pair || pair.sourceRevisionSha256 !== original.sourceRevisionSha256 || pair.primaryOriginalSha256 !== original.primaryOriginalSha256
      || pair.companionOriginalSha256 !== original.companionOriginalSha256 || original.frameCount !== frames.length) return original;
    return { ...original, sourceRevisionSha256: currentSha256, originRevisionSha256: original.originRevisionSha256 ?? original.sourceRevisionSha256 };
  });
  return { science: { ...science, frames }, companions: originals };
}
