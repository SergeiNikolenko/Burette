import { useEffect } from "react";
import type { DockArea } from "../dock";
import type { ViewerDocument } from "../../types";
import { releaseClosedImports } from "./scientific-source-state";

/** The always-mounted right dock owns import lifetime, including while its panels are hidden. */
export function useScientificSourceLifetime(area: DockArea, documents: readonly Pick<ViewerDocument, "id">[]) {
  useEffect(() => {
    if (area === "right") releaseClosedImports(new Set(documents.map(document => document.id)));
  }, [area, documents]);
}
