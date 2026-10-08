import type { ViewerDocument } from "../types";

const MESOSCALE_EXTENSIONS = new Set(["molj", "molx", "mesozip"]);

export function isMesoscaleViewerDocument(document: ViewerDocument | null | undefined): document is ViewerDocument {
  if (!document) return false;
  if (document.viewerProfile === "mesoscale") return true;
  const extension = document.extension.toLowerCase();
  if (MESOSCALE_EXTENSIONS.has(extension)) return true;
  // Scene documents carry long paths, so the extension is checked before them.
  if (extension !== "bcif" && extension !== "cif" && extension !== "mmcif" && extension !== "mcif") return false;
  const identity = `${document.path} ${document.runtimePath}`.toLowerCase();
  return identity.includes("cellpack") || identity.includes("petworld") || identity.includes("mesoscale");
}
