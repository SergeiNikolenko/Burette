import type { ChemicalEditorTarget } from "../components/types";

type FileAction = { path: string } & (
  | { type: "list_apps" | "reveal" | "open_default" }
  | { type: "open_with"; targetId: string }
);

export async function browserFileAction(action: FileAction): Promise<{ targets?: ChemicalEditorTarget[]; supported?: boolean; ok?: boolean }> {
  const response = await fetch("/__burette/file-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action),
  });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error || "File action failed.");
  return result;
}
