import { EditorPane } from "../editor-pane";
import { DocumentFooter } from "../document-footer";
import type { ShellTab } from "../../types";
import { definePageKind } from "./types";

export type FileTab = Extract<ShellTab, { kind: "document" }>;

function FilePage({ tab, isActive }: { tab: FileTab; isActive: boolean }) {
  return <EditorPane document={tab.document} isActive={isActive} />;
}

export const fileKind = definePageKind<FileTab>({
  kind: "document",
  title: (tab) => tab.document.title,
  description: "Open structure",
  Component: FilePage,
  keepAlive: true,
  supportsFileContextMenu: true,
  renderFooter: (tab, state) => <DocumentFooter document={tab.document} workspaceRoot={state.workspaceRoot} />,
});
