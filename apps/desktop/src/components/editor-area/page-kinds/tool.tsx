import { lazy, Suspense } from "react";
import { DOCK_TAB_LABELS, dockTabCatalog, type DockTabKind, type DockArea } from "../../../lib/dock";
import { definePageKind } from "./types";
const ToolPage = lazy(() => import("../../workspace-panes/tool-page").then(module => ({ default: module.ToolPage })));
export type ToolLocation = { kind: "tool"; tool: DockTabKind; area: DockArea; sourcePath?: string };
export const toolKind = definePageKind<"tool", ToolLocation>({
  kind: "tool",
  title: location => DOCK_TAB_LABELS[location.tool],
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
