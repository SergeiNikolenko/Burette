import { openScientificDocument } from "./generated-document-open";
export { openGeneratedStructure, openScientificDocument } from "./generated-document-open";
import type { ShellActions } from "../../components/types";
import { toast } from "../../components/ui/toast";
import { pickBrowserFiles } from "../browser-file-picker";
import { runReaderTask } from "./reader-task";
import { COMPRESSED_FILE_ACCEPT, compressedName } from "../compressed-files/formats";
import { decodeCompressedFile } from "../compressed-files/task";
import { SCIENTIFIC_FILE_ACCEPT, SCIENTIFIC_FILE_LIMIT } from "./scientific-files";
import { isTauriRuntime } from "../tauri";
import { registerDroppedBrowserFiles } from "../web-demo-workspace";

export const QUANTUM_OUTPUT_ACCEPT = `${SCIENTIFIC_FILE_ACCEPT},.xyz,${COMPRESSED_FILE_ACCEPT}`;


/**
 * Opens an ORCA output/Hessian, Gaussian formatted checkpoint, Molden file, cube or XYZ trajectory with its
 * scientific data attached, so the Orbitals, Vibrations and Plots tabs can use it.
 */
async function openScientificFile(actions: Pick<ShellActions, "openStructureRecords">, file: File) {
  if (file.size > SCIENTIFIC_FILE_LIMIT) throw new Error("Quantum outputs can be at most 16 MiB.");
  // A compressed output is parsed as the file inside it, decoded within the same limit.
  const compressed = compressedName(file.name);
  const { name, text } = compressed
    ? { name: compressed.innerName, text: (await decodeCompressedFile(file.name, file, { maxBytes: SCIENTIFIC_FILE_LIMIT })).text }
    : { name: file.name, text: await file.text() };
  const parsed = await runReaderTask({ action: "parse", name, text });
  // Live mode animation and orbital surfaces edit one frame; a pure trajectory keeps its steps.
  // When several geometries carry their own modes (an ORCA scan or optimization with
  // frequencies), the steps open so each frame's modes can be inspected on it.
  const framesWithModes = parsed.frames.filter((frame) => frame.modes?.length).length;
  const steps = parsed.frames.length > 1 && !parsed.basis?.length && !parsed.grid && (!parsed.modes.length || framesWithModes > 1);
  // The parser reads decoded text; the download keeps the uploaded bytes, BOM and compression included.
  await openScientificDocument(actions, name, parsed, steps ? "steps" : "final", { name: file.name, file });
}

type ScientificOpenActions = Pick<ShellActions, "openStructureRecords"> & Partial<Pick<ShellActions, "openPaths">>;

export async function importQuantumOutput(actions: ScientificOpenActions) {
  const [file] = await pickBrowserFiles({ accept: QUANTUM_OUTPUT_ACCEPT });
  if (file) await openScientificFiles(actions, [file]);
}

const SCIENTIFIC_FILES_AT_ONCE = 16;

/**
 * Opens files an ordinary Open or drop recognised as scientific, one at a time.
 * A file that fails to parse reports its own error and opens nothing: a recognised
 * output never falls back to its bare geometry.
 */
export async function openScientificFiles(actions: ScientificOpenActions, files: File[]) {
  if (files.length > SCIENTIFIC_FILES_AT_ONCE) {
    toast.add({ title: `Open up to ${SCIENTIFIC_FILES_AT_ONCE} quantum outputs at a time`, type: "error" });
    return;
  }
  if (!isTauriRuntime() && actions.openPaths) {
    const saved = await registerDroppedBrowserFiles(files, SCIENTIFIC_FILE_LIMIT, { scientific: true });
    for (const message of saved.errors) toast.add({ title: "Could not import quantum output", description: message, type: "error" });
    if (saved.paths.length) await actions.openPaths(saved.paths);
    return;
  }
  for (const file of files) {
    try {
      await openScientificFile(actions, file);
    } catch (error) {
      toast.add({ title: `Could not open ${file.name}`, description: error instanceof Error ? error.message : String(error), type: "error" });
    }
  }
}

export function runQuantumImport(actions: ScientificOpenActions) {
  return importQuantumOutput(actions).catch((error) => {
    toast.add({ title: "Could not open the quantum output", description: error instanceof Error ? error.message : String(error), type: "error" });
  });
}
