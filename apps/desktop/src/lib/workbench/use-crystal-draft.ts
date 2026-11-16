import type { CrystalEdit } from "../molecular-workbench/crystal-edit";
import { periodicCrystalFormat, type CrystalDocument, type CrystalFormat } from "../molecular-workbench/crystal-io";
import { SOURCE_EDIT_MAX_BYTES, utf8ByteCount } from "../source-editing/policy";
import { useStructureSourceText } from "../source-editing/use-structure-source-text";
import { sourceExtension, useLogicalSource } from "../science-session/state";
import { runCrystalTask } from "./crystal-task";
import { runReaderTask } from "./reader-task";
import { workbenchSupportsDocument } from "./structure";
import { useTextDraft, type TextRevision } from "./use-text-draft";
import type { ViewerDocument } from "../../types";

export type CrystalRevision = TextRevision<CrystalDocument, CrystalEdit["kind"]>;

const PERIODIC_EXTENSIONS = new Set(["cif", "mmcif", "mcif", "vasp", "xyz"]);

/** Documents whose source can be a crystal the panel edits; only these are read to find out. */
function crystalDocument(document: ViewerDocument | null, extension: string) {
  return document && workbenchSupportsDocument(document) && PERIODIC_EXTENSIONS.has(extension)
    && document.byteCount <= SOURCE_EDIT_MAX_BYTES ? document : null;
}

/** The extension the document is edited as. A reopened scene publishes its source after it
 * mounts, so the extension comes from the store as a value the memoized hooks depend on. */
function useEditedExtension(document: ViewerDocument | null) {
  const logical = useLogicalSource(document?.id ?? null);
  return document ? logical?.extension ?? sourceExtension(document) : "";
}

/** Whether the document's current source is a crystal the Crystal panel can open. */
export function useCrystalAvailable(document: ViewerDocument | null) {
  const extension = useEditedExtension(document);
  const candidate = crystalDocument(document, extension);
  const { text } = useStructureSourceText(candidate);
  return Boolean(candidate && text !== null && periodicCrystalFormat(extension, text));
}

/**
 * The undoable crystal draft of a CIF, extended XYZ or POSCAR document: each edit runs
 * in the crystal worker and becomes one Undo step of the document's own source. An
 * asymmetric unit of a source that cannot carry symmetry opens as a new CIF instead.
 */
export function useCrystalDraft(document: ViewerDocument | null, openCif: (name: string, text: string) => Promise<unknown>) {
  const edited = useEditedExtension(document);
  const candidate = crystalDocument(document, edited);
  const extension = candidate ? edited : "";
  const formatOf = (text: string): CrystalFormat | null => periodicCrystalFormat(extension, text);
  const draft = useTextDraft<CrystalDocument, CrystalEdit["kind"]>("crystal", candidate, candidate ? {
    accepts: (text) => formatOf(text) !== null,
    read: (text, signal) => runReaderTask({ action: "crystal", format: formatOf(text)!, text }, { signal }),
  } : null, "crystal");
  const apply = (edit: CrystalEdit) => draft.apply(edit.kind, async (current, signal) => {
    const result = await runCrystalTask({ action: "edit", source: { format: formatOf(current.text)!, text: current.text }, edit }, { signal });
    if (!result.newDocument) {
      if (utf8ByteCount(result.text) > SOURCE_EDIT_MAX_BYTES) {
        throw new Error(edit.kind === "supercell"
          ? "The supercell exceeds the 3 MB source editing limit. Use fewer repeats."
          : "The edited crystal exceeds the 3 MB source editing limit.");
      }
      return result.text;
    }
    await openCif(`${candidate!.title.replace(/\.[^.]+$/u, "")}-asymmetric-unit`, result.text);
    return null;
  });
  return { ...draft, format: draft.history ? formatOf(draft.history.current.text) : null, apply };
}
