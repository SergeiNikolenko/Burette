import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../lib/tauri";
import { safeExportFileName } from "../lib/file-export";
import type { StructureDragRecord } from "../lib/structure-drag";

export async function saveStructureRecordsInFolder(records: StructureDragRecord[], directory: string) {
  if (records.length > 200 || records.reduce((size, record) => size + new TextEncoder().encode(record.text).length, 0) > 24 * 1024 * 1024) {
    throw new Error("Drop at most 200 molecules and 24 MB at a time.");
  }
  const paths: string[] = [];
  const errors: string[] = [];
  for (const record of records) {
    const name = safeExportFileName(record.path.replace(/\\/g, "/").split("/").pop() || `molecule.${record.inputExtension}`);
    const request = { operation: "createText", path: directory, name, contents: record.text };
    try {
      if (isTauriRuntime()) paths.push(await invoke<string>("operate_sidebar_file", { request }));
      else {
        const response = await fetch("/__burette/create-text-file", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
        });
        const result = await response.json();
        if (!response.ok || typeof result.path !== "string") throw new Error(result.error || "Could not create file");
        paths.push(result.path);
      }
    } catch (error) { errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return { paths, errors };
}
