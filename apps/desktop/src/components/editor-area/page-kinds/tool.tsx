import { lazy, Suspense } from "react";
import { DOCK_TAB_LABELS, dockTabCatalog, type DockTabKind, type DockArea } from "../../../lib/dock";
import { basename } from "../../../lib/sidebar-projects";
import { definePageKind } from "./types";
const ToolPage = lazy(() => import("../../workspace-panes/tool-page").then(module => ({ default: module.ToolPage })));
export type ToolLocation = { kind: "tool"; tool: DockTabKind; area: DockArea; sourcePath?: string };
export const toolKind = definePageKind<"tool", ToolLocation>({
  kind: "tool",
  title: ({ tool, sourcePath }) => sourcePath ? `${DOCK_TAB_LABELS[tool]} · ${basename(sourcePath)}` : DOCK_TAB_LABELS[tool],
  description: "Workspace tool",
  keepAlive: true,
  fromPayload: data => {
    const area = data.area === "bottom" ? "bottom" : "right";
    return typeof data.tool === "string" && dockTabCatalog(area).includes(data.tool as DockTabKind)
      ? { kind: "tool", tool: data.tool as DockTabKind, area, ...(typeof data.sourcePath === "string" ? { sourcePath: data.sourcePath } : {}) } : null;
  },
  serialize: ({ tool, area, sourcePath }) => ({ tool, area, sourcePath }),
  Component: props => <Suspense fallback={null}><ToolPage {...props} /></Suspense>,
});
