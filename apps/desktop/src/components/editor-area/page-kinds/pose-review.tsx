import type { ViewerDocument } from "../../../types";
import { ViewerFrame } from "../viewer-frame";
import { definePageKind } from "./types";

export type PoseReviewLocation = {
  kind: "pose-review";
  receptorPath: string;
  gridDocumentId: string;
  gridPath: string;
  dockingDocumentId: string;
  dockingPath: string;
};

export const poseReviewKind = definePageKind<"pose-review", PoseReviewLocation>({
  kind: "pose-review",
  title: (location, state) => {
    const grid = findDocument(location.gridDocumentId, location.gridPath, state.documents);
    return grid ? `Pose Review: ${grid.title}` : "Pose Review";
  },
  description: "Pose review workspace",
  Component: ({ location, state, actions }) => {
    const docking = findDocument(location.dockingDocumentId, location.dockingPath, state.documents);
    const grid = findDocument(location.gridDocumentId, location.gridPath, state.documents);
    if (!docking || !grid) {
      return (
        <div className="pose-review-missing">
          <strong>Pose review workspace is unavailable</strong>
          <span>Open the receptor and pose grid again to rebuild this workspace.</span>
        </div>
      );
    }
    const referencePose = state.poseReviewSelections[grid.id] ?? 0;
    return (
      <PoseReviewWorkspace
        location={location}
        docking={docking}
        grid={grid}
        referencePose={referencePose}
        onOpenFepSetup={() => actions.openFepSetupWorkspace({
          receptorPath: location.receptorPath,
          gridDocumentId: grid.id,
          gridPath: grid.path,
          dockingDocumentId: docking.id,
          dockingPath: docking.path,
          referencePose,
        })}
      />
    );
  },
  keepAlive: false,
  fromPayload: (data) => (
    typeof data.receptorPath === "string" &&
    typeof data.gridDocumentId === "string" &&
    typeof data.gridPath === "string" &&
    typeof data.dockingDocumentId === "string" &&
    typeof data.dockingPath === "string"
      ? {
          kind: "pose-review",
          receptorPath: data.receptorPath,
          gridDocumentId: data.gridDocumentId,
          gridPath: data.gridPath,
          dockingDocumentId: data.dockingDocumentId,
          dockingPath: data.dockingPath,
        }
      : null
  ),
  serialize: () => null,
});

function findDocument(documentId: string, path: string, documents: ViewerDocument[]) {
  return (
    documents.find((document) => document.id === documentId) ??
    documents.find((document) => document.path === path) ??
    null
  );
}

function PoseReviewWorkspace({
  location,
  docking,
  grid,
  referencePose,
  onOpenFepSetup,
}: {
  location: PoseReviewLocation;
  docking: ViewerDocument;
  grid: ViewerDocument;
  referencePose: number;
  onOpenFepSetup: () => void;
}) {
  return (
    <section className="pose-review-workspace" aria-label="Pose review workspace">
      <div className="pose-review-pane pose-review-pane-docking">
        <ViewerFrame document={docking} />
      </div>
      <div className="pose-review-actions" aria-label="Pose review actions">
        <button type="button" onClick={onOpenFepSetup}>FEP Setup</button>
        <span>{fileName(location.receptorPath)} - Pose {referencePose + 1}</span>
      </div>
      <div className="pose-review-pane pose-review-pane-grid">
        <ViewerFrame document={grid} />
      </div>
    </section>
  );
}

function fileName(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;
}
