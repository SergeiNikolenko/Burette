import type { ChemicalEditorTarget } from "../components/types";

type FileAction = { path: string } & (
  | { type: "list_apps" | "reveal" | "open_default" }
  | { type: "open_with"; targetId: string }
);

/** Derived scenes and editor sketches have an identity, not a filesystem path. */
export function isLocalFilePath(path: string) {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path);
}

/** The native workspace transport authorizes the document path before dispatch. */
export async function browserFileAction(action: FileAction): Promise<{ targets?: ChemicalEditorTarget[]; supported?: boolean; ok?: boolean }> {
  if (!isLocalFilePath(action.path)) {
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
