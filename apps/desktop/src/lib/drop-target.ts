import { dockTabCatalog, type DockArea, type DockTabKind } from "./dock";

export type DropTargetDescriptor =
  | {
      kind: "document";
      documentPath: string;
      documentId: string | null;
      renderer: string | null;
    }
  | {
      kind: "dock";
      area: DockArea;
      tabKind: DockTabKind;
    }
  | {
      kind: "sidebar" | "tab-strip" | "ketcher";
    };

export function describeDropTargetElement(element: Element | null): DropTargetDescriptor | null {
  const dockTarget = element?.closest<HTMLElement>(".dock-panel[data-area]");
  const area = dockTarget?.dataset.area;
  if (area === "right" || area === "bottom") {
    const activeTab = dockTarget?.dataset.activeTab as DockTabKind | undefined;
    const tabKind = activeTab && dockTabCatalog(area).includes(activeTab) ? activeTab : "files";
    return { kind: "dock", area, tabKind };
  }

  const documentTarget = element?.closest<HTMLElement>("[data-drop-document-path]");
  const documentPath = documentTarget?.dataset.dropDocumentPath?.trim();
  if (documentPath) {
    return {
      kind: "document",
      documentPath,
      documentId: documentTarget?.dataset.dropDocumentId?.trim() || null,
      renderer: documentTarget?.dataset.dropDocumentRenderer?.trim() || null,
    };
  }

  const zoneTarget = element?.closest<HTMLElement>("[data-file-drop-zone]");
  const zone = zoneTarget?.dataset.fileDropZone;
  if (zone === "sidebar" || zone === "tab-strip" || zone === "ketcher") {
    return { kind: zone };
  }
  if (element?.closest(".ketcher-page")) return { kind: "ketcher" };
  return null;
}
