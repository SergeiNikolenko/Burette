import type { ChemicalEditorTarget } from "../components/types";
import { isAbsoluteNativeFilePath } from "./native-menu-paths";

type FileAction = { path: string } & (
  | { type: "list_apps" | "reveal" | "open_default" }
  | { type: "open_with"; targetId: string }
);

/**
 * The native workspace transport authorizes the document path before dispatch.
 * Derived scenes and editor sketches have an identity, not a filesystem path.
 */
export async function browserFileAction(action: FileAction): Promise<{ targets?: ChemicalEditorTarget[]; supported?: boolean; ok?: boolean }> {
  if (!isAbsoluteNativeFilePath(action.path)) {
    if (action.type === "list_apps") return { targets: [], supported: false };
    throw new Error("Save this generated structure to a file before opening it in another application.");
  }
  const response = await fetch("/__burette/file-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action),
  });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error || "File action failed.");
  return result;
}
