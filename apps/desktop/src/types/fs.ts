import type { WorkspaceEntry, WorkspaceSearchResult } from "../types";

export type DirEntry = WorkspaceEntry;
export type SearchResult = WorkspaceSearchResult;

export interface WorkspaceInfo {
  root: string;
  name: string;
  file_count: number;
}

export interface FileOpenResult {
  path: string;
  title: string;
  renderer: string;
}
