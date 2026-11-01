import { useMemo } from "react";
import type { AssemblyFormat } from "../molecular-workbench/biological-assembly";
import { useSourceEditing } from "../source-editing/context";
import { useSourceText } from "../source-editing/use-structure-source-text";
import { captureLogicalSourceOwner, sourceExtension } from "../science-session/state";
import { readStructureTextDocument } from "../structure-text";
import { useMoleculeStore } from "../../stores/molecule-store";
import type { ViewerDocument } from "../../types";

export const ASSEMBLY_TEXT_LIMIT = 20_000_000;
export const ASSEMBLY_FILE_ACCEPT = ".pdb,.ent,.cif,.mmcif";
export const ASSEMBLY_TOO_LARGE = "Biological assemblies are built from PDB or mmCIF files up to 20 MB.";
const FORMATS: Record<string, AssemblyFormat> = { pdb: "pdb", ent: "pdb", cif: "cif", mmcif: "cif" };
export function assemblyFormatOfName(name: string): AssemblyFormat | null {
  return FORMATS[/\.([a-z0-9]+)$/iu.exec(name)?.[1]?.toLowerCase() ?? ""] ?? null;
}
export function assemblySourceFormat(document: ViewerDocument | null): AssemblyFormat | null {
  if (!document || document.renderer !== "molstar" || document.mergedCollection || document.dockingRequest) return null;
  return FORMATS[sourceExtension(document)] ?? null;
}

/** Reads the exact document lifetime or its current draft, bounded before parsing. */
export function useAssemblySourceText(document: ViewerDocument | null) {
  const editing = useSourceEditing(), session = editing?.sessionForDocument(document) ?? null;
  const open = useMoleculeStore(state => document !== null && state.documents.includes(document));
  const usable = open && assemblySourceFormat(document) ? document : null;
  const source = useSourceText(usable, (_identity, path) => ({
    text: readStructureTextDocument(path, undefined, { maxBytes: ASSEMBLY_TEXT_LIMIT + 1 }).then(result => {
      if (result.truncated || result.byteCount > ASSEMBLY_TEXT_LIMIT) throw new Error(ASSEMBLY_TOO_LARGE);
      return result.content;
    }), release() {},
  }));
  const oversized = useMemo(() => source.text !== null && (source.text.length > ASSEMBLY_TEXT_LIMIT || new TextEncoder().encode(source.text).length > ASSEMBLY_TEXT_LIMIT), [source.text]);
  const text = oversized ? null : source.text;
  const revision = useMemo(() => ({ document: usable, text, sessionId: session?.sessionId, revision: session?.revision }),
    [usable, text, session?.sessionId, session?.revision]);
  const capture = () => {
    if (!usable || text === null) return null;
    const operation = editing?.captureOperation(usable), logicalCurrent = captureLogicalSourceOwner(usable.id);
    let retired = false;
    const unsubscribe = useMoleculeStore.subscribe(state => { if (!state.documents.includes(usable)) retired = true; });
    const isCurrent = () => {
      const current = editing?.sessionForDocument(usable) ?? null;
      return !retired && useMoleculeStore.getState().documents.includes(usable) && logicalCurrent() && (!operation || operation.isCurrent())
        && current?.sessionId === session?.sessionId && current?.revision === session?.revision;
    };
    return { isCurrent, release: () => { retired = true; unsubscribe(); operation?.release(); } };
  };
  return { text, error: oversized ? ASSEMBLY_TOO_LARGE : source.error, revision, capture };
}
