import type { AssemblyFormat } from "../molecular-workbench/biological-assembly";
import { sourceExtension } from "../science-session/state";
import type { ViewerDocument } from "../../types";
import { useOwnedSourceText } from "./owned-source-text";

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
  return useOwnedSourceText(assemblySourceFormat(document) ? document : null, ASSEMBLY_TEXT_LIMIT, ASSEMBLY_TOO_LARGE);
}
