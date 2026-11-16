import type { ViewerDocument } from "../../types";
import { sourceExtension } from "../science-session/state";

export function polymerSourceFormat(document: ViewerDocument | null, extension = document ? sourceExtension(document) : ""): "mol" | "sdf" | null {
  if (!document || document.renderer !== "molstar" || document.mergedCollection || document.dockingRequest) return null;
  extension = extension.replace(/^\./u, "").toLowerCase();
  return extension === "mol" ? "mol" : extension === "sdf" || extension === "sd" ? "sdf" : null;
}
