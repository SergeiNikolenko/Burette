import type { ShellViewState, ViewerLigandSelection } from "../components/types";

type AppShellViewStateInput = Omit<
  ShellViewState,
  "activeDocumentId" | "visibleDocuments" | "viewerLigandSelection"
> & {
  viewerLigandSelections: Record<string, ViewerLigandSelection | null>;
};

export function createAppShellViewState(input: AppShellViewStateInput): ShellViewState {
  const { viewerLigandSelections, ...state } = input;
  return {
    ...state,
    activeDocumentId: state.activeDocument?.id ?? null,
    visibleDocuments: state.documents,
    viewerLigandSelection: state.activeDocument
      ? viewerLigandSelections[state.activeDocument.id] ?? null
      : null,
  };
}
