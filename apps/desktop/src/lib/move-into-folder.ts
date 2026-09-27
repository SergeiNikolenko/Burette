import { parentDirectory } from "./sidebar-projects";

// Drops on a sidebar folder row move files and folders into it, like Finder.
// The sidebar file operations own tab, pin and project-root bookkeeping, so
// drop handlers hand the request over through this window event.
export const MOVE_INTO_FOLDER_EVENT = "burette-move-into-folder";

export type MoveIntoFolderRequest = {
  directory: string;
  paths: string[];
};

/** Paths that would change location; drops onto their own folder or into themselves are no-ops. */
export function movableEntries(paths: string[], directory: string) {
  return Array.from(new Set(paths)).filter((path) => (
    parentDirectory(path) !== directory
    && path !== directory
    && !directory.startsWith(`${path}/`)
  ));
}

export function requestMoveIntoFolder(request: MoveIntoFolderRequest) {
  window.dispatchEvent(new CustomEvent<MoveIntoFolderRequest>(MOVE_INTO_FOLDER_EVENT, { detail: request }));
}
