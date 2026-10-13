import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./tauri";
import { validatePdbConversion, validatePdbMolecule } from "./pdb-chemistry";

export async function prepareKetcherPdbImport(text: string) {
  if (!/^(ATOM  |HETATM)/mu.test(text)) return text;
  validatePdbMolecule(text);
  let sdf: string;
  if (isTauriRuntime()) {
    sdf = await invoke<string>("prepare_ketcher_pdb", { text });
  } else {
    const response = await fetch("/__burette/prepare-ketcher-pdb", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw new Error("Open the original SDF, or use the desktop app to import this PDB molecule.");
    }
    const result = await response.json() as { text?: string; error?: string };
    if (!response.ok || typeof result.text !== "string") throw new Error(result.error || "Could not reconstruct molecule bonds.");
    sdf = result.text;
  }
  return validatePdbConversion(text, sdf);
}
