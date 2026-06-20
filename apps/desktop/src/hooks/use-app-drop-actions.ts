import { useCallback } from "react";
import { showNativeContextMenu } from "../components/native-context-menu";
import type { DropActionChoice } from "../lib/drop-actions";

type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;

type UseAppDropActionsOptions = {
  addProjectRoot: (path: string) => void;
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
  setWorkspacePath: (path: string | null) => void;
};

export function useAppDropActions({
  addProjectRoot,
  pushErrorStatus,
  pushStatus,
  setWorkspacePath,
}: UseAppDropActionsOptions) {
  const chooseDropAction = useCallback((
    choices: DropActionChoice[],
    at: { x: number; y: number } | null | undefined,
    runChoice: (choice: DropActionChoice) => void,
  ) => {
    if (choices.length < 2) return false;
    void showNativeContextMenu(
      choices.map((choice, index) => ({
        kind: "item" as const,
        id: `drop-action-${index}-${choice.id}`,
        text: choice.confidence === "default" ? `${choice.label} (default)` : choice.label,
        action: () => runChoice(choice),
      })),
      at ?? undefined,
    ).catch((error) => {
      pushErrorStatus(error, "Drop action menu failed");
      runChoice(choices[0]);
    });
    return true;
  }, [pushErrorStatus]);

  const addDroppedProjectRoots = useCallback((paths: string[]) => {
    const cleanPaths = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
    if (cleanPaths.length === 0) return;
    for (const path of cleanPaths) addProjectRoot(path);
    setWorkspacePath(cleanPaths[0]);
    pushStatus("Project folder added");
  }, [addProjectRoot, pushStatus, setWorkspacePath]);

  return {
    addDroppedProjectRoots,
    chooseDropAction,
  };
}
