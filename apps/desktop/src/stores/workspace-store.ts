import { useAppStore } from "../store";

export const useWorkspaceStore = useAppStore;

export function getWorkspaceRoot() {
  return useAppStore.getState().workspaceRoot;
}

export function getRecentWorkspaces() {
  return useAppStore.getState().recentWorkspaces;
}
