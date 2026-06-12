import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./tauri";

export async function readStructureText(path: string) {
  if (isTauriRuntime()) {
    return invoke<string>("read_structure_text", { path });
  }
  const response = await fetch(`/__burette/read-file?path=${encodeURIComponent(path)}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.text();
}
