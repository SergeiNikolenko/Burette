import type { ViewerDocument } from "../../types";
import type { ScientificDocument } from "../molecular-workbench/scientific-types";
import type { SourceEditingContextValue } from "../source-editing/context";
import { atomicNumber } from "../molecular-workbench/elements";
import { readOrcaMcdBlocks } from "../molecular-workbench/orca-circular-spectra";
import { sha256Hex } from "../source-editing/source-identity";
import { scientificDocumentPayload } from "../science-session/codec";
import { captureLogicalSourceOwner, logicalSourceFor } from "../science-session/state";
import { readBrowserDevVirtualTextDocument } from "../browser-dev-documents";
import { readBrowserSourceCheckpoint } from "../browser-source-checkpoint";
import { BROWSER_SOURCE_CHECKPOINT_BYTES, browserSourceSessionScope, browserSourceOriginal, readBrowserSourceRecord, writeBrowserSourceRecord } from "../browser-source-storage";
import { compressedName } from "../compressed-files/formats";
import { decodeCompressedFile } from "../compressed-files/task";
import { useMoleculeStore } from "../../stores/molecule-store";
import { adoptRestoredScientificSource, scientificStateFor } from "./scientific-source-state";
import { SCIENTIFIC_FILE_LIMIT } from "./scientific-files";

export const readBrowserScientificAttachment = (path: string) => readBrowserSourceRecord("scientific-attachments", path);

type Admission = {
  document: ViewerDocument;
  science: ScientificDocument;
  sourceText: string;
  sourceFrameIndex: number;
  sourceEditing: Pick<SourceEditingContextValue, "sessionForDocument" | "captureOperation">;
};
const stale = () => new DOMException("The source changed before its companion could be attached.", "AbortError");

/** Capture at the owner before opening a picker, not after reading its selected file. */
export function captureBrowserMcdAdmission({ document, science, sourceText, sourceFrameIndex, sourceEditing }: Admission) {
  const scope = browserSourceSessionScope(), sourceOwner = captureLogicalSourceOwner(document.id);
  const before = scientificStateFor(document.id, sourceText), original = before.original;
  const initialSession = sourceEditing.sessionForDocument(document);
  if (!scope || !document.virtual || logicalSourceFor(document.id) || !original || before.revision?.document !== science
    || !Number.isSafeInteger(sourceFrameIndex) || sourceFrameIndex < 0 || sourceFrameIndex >= science.frames.length) {
    throw new Error("Open an imported scientific source before attaching its MCD companion.");
  }
  let operation: ReturnType<SourceEditingContextValue["captureOperation"]> | undefined;
  const current = () => {
    const state = scientificStateFor(document.id, sourceText), session = sourceEditing.sessionForDocument(document);
    return browserSourceSessionScope() === scope && sourceOwner() && (operation?.isCurrent() ?? true)
      && useMoleculeStore.getState().documents.some(item => item === document)
      && state.revisions === before.revisions && state.revision === before.revision && state.original === original && state.companions === before.companions
      && readBrowserDevVirtualTextDocument(document.path) === sourceText
      && session === initialSession
      && (!session || (!session.dirty && session.content === sourceText));
  };
  if (!current()) throw new Error("Save or discard source edits before attaching a clean MCD companion.");
  const payload = scientificDocumentPayload(science);
  if (payload.byteLength > BROWSER_SOURCE_CHECKPOINT_BYTES) throw new Error("The scientific source exceeds the browser attachment limit.");
  const capturedScience = payload.clone();
  const capturedCompanions = before.companions ? structuredClone(before.companions) : [];

  operation = sourceEditing.captureOperation(document);
  return {
    release: operation.release,
    async prepare(file: File) {
      if (!current()) throw stale();
      if (file.size > SCIENTIFIC_FILE_LIMIT) throw new Error("MCD companions can be at most 16 MiB.");
      const name = file.name;
      const identity = await browserSourceOriginal(document.path);
      if (!current()) throw stale();
      if (!identity || identity.scope !== scope || identity.originalName !== original.name || identity.originalBytes !== original.file.size
        || identity.originalSha256 !== await sha256Hex(new Uint8Array(await original.file.arrayBuffer()))) throw new Error("The original source file changed.");
      if (!current()) throw stale();
      if (await readBrowserSourceCheckpoint(document.path)) throw new Error("Recover or discard the saved draft before attaching a clean MCD companion.");
      const prior = await readBrowserScientificAttachment(document.path);
      if (!current()) throw stale();
      const text = compressedName(name)
        ? (await decodeCompressedFile(name, file, { maxBytes: SCIENTIFIC_FILE_LIMIT })).text
        : await file.text();
      if (!current()) throw stale();
      const blocks = readOrcaMcdBlocks(text);
      const companionOriginalSha256 = await sha256Hex(new Uint8Array(await file.arrayBuffer()));
      const sourceRevisionSha256 = await sha256Hex(sourceText);
      if (!current()) throw stale();
      const binding = { primaryOriginalSha256: identity.originalSha256, companionOriginalSha256, sourceRevisionSha256 };
      let applied = false;
      return {
        blocks: blocks.map((block, index) => ({ index, rows: block.spectrum.positions.length,
          fromCm1: block.spectrum.positions[0], toCm1: block.spectrum.positions.at(-1)! })),
        async apply(blockIndex: number) {
          if (applied || !current()) throw stale();
          if (!Number.isSafeInteger(blockIndex) || blockIndex < 0 || blockIndex >= blocks.length) throw new Error("Select one MCD source block.");
          const frame = capturedScience.frames[sourceFrameIndex];
          const nextScience: ScientificDocument = { ...capturedScience, frames: capturedScience.frames.map((value, index) => index !== sourceFrameIndex ? value : {
            ...value, mcdCompanion: { ...binding, spectra: { kind: "scientific-spectra", version: 1,
              source: { name, format: "orca-mcd", scope: "frame", frameIndex: sourceFrameIndex, frameCount: capturedScience.frames.length },
              atomicNumbers: frame.atoms.map(atom => atomicNumber(atom.element)), spectra: [blocks[blockIndex].spectrum] } },
          }) };
          const companion = { ...binding, role: "orca-mcd" as const, frameIndex: sourceFrameIndex, frameCount: capturedScience.frames.length, name, file };
          const companions = [...capturedCompanions.filter(value => value.primaryOriginalSha256 !== binding.primaryOriginalSha256
            || value.companionOriginalSha256 !== binding.companionOriginalSha256 || value.sourceRevisionSha256 !== binding.sourceRevisionSha256
            || value.frameIndex !== sourceFrameIndex || value.frameCount !== capturedScience.frames.length), companion];
          const stored = await writeBrowserSourceRecord("scientific-attachments", identity, prior?.id ?? null, {
            ...identity, kind: "scientific-attachment", version: 1, id: crypto.randomUUID(), title: document.title, text: sourceText, science: nextScience, companions,
          }, current);
          if (!stored) throw stale();
          applied = true;
          if (!current()) throw stale();
          adoptRestoredScientificSource(document.id, { text: sourceText, document: nextScience }, original, companions);
        },
      };
    },
  };
}
