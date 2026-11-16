import type { ViewerDocument } from "../../types";

// Metadata updates (for example clearing sceneUnsaved after Save) keep the same
// source lifetime. Native claims and viewer runtime changes identify a new load.
const SOURCE_KEYS = ["path", "runtimePath", "openClaimId", "extension", "renderer", "viewerProfile", "byteCount"] as const;
export const sameSceneSource = (left: ViewerDocument, right: ViewerDocument) => SOURCE_KEYS.every((key) => left[key] === right[key]);
