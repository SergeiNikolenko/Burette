import { findIndexedDocument } from "./document-index";
import type { ShellViewState } from "../types";
import { FileKindIcon, fileKindForPath } from "../sidebar/file-kind-icon";
import { Chart, Compare, Edit, Flask, Plus, SettingsCog, Stopwatch } from "../ui/app-icons";
import type { Location } from "./page-kinds";
import "../workspace-panes/workspace-panes.css";

// Every screen shows what it is by its glyph, the way Codex marks a chat tab
// apart from a browser tab. Files reuse the sidebar's scientific file kinds, so
// a receptor reads the same in the tree, the strip and the side panel.
export function TabKindIcon({ location, state }: { location: Location; state: Pick<ShellViewState, "documents"> }) {
  switch (location.kind) {
    case "file": {
      const document = findIndexedDocument(state.documents, location, "first");
      return <FileKindIcon kind={fileKindForPath(location.path, document?.extension)} />;
    }
    case "text-file":
    case "document":
      return <FileKindIcon kind={fileKindForPath(location.path)} />;
    case "launcher":
      return <Plus size={16} aria-hidden />;
    case "tool":
    case "settings":
      return <SettingsCog size={16} aria-hidden />;
    case "ketcher":
      return <Edit size={16} aria-hidden />;
    case "fep-setup":
    case "fep-network":
      return <Flask size={16} aria-hidden />;
    case "pose-review":
      return <Compare size={16} aria-hidden />;
    case "jobs":
      return <Stopwatch size={16} aria-hidden />;
    case "chemical-space":
      return <Chart size={16} aria-hidden />;
  }
}
