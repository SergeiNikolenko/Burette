import type { FepSetupRequest, ViewerDocument } from "../../../types";
import { ViewerFrame } from "../viewer-frame";
import { definePageKind } from "./types";

export type FepSetupLocation = {
  kind: "fep-setup";
} & FepSetupRequest;

export const fepSetupKind = definePageKind<"fep-setup", FepSetupLocation>({
  kind: "fep-setup",
  title: (location, state) => {
    const grid = findDocument(location.gridDocumentId, location.gridPath, state.documents);
    return grid ? `FEP Setup: ${grid.title}` : "FEP Setup";
  },
  description: "FEP setup workspace",
  Component: ({ location, state }) => {
    const docking = findDocument(location.dockingDocumentId, location.dockingPath, state.documents);
    const grid = findDocument(location.gridDocumentId, location.gridPath, state.documents);
    if (!docking || !grid) {
      return (
        <div className="fep-setup-missing">
          <strong>FEP setup workspace is unavailable</strong>
          <span>Open the receptor and ligand grid again to rebuild this workspace.</span>
        </div>
      );
    }
    return <FepSetupWorkspace location={location} docking={docking} grid={grid} />;
  },
  keepAlive: false,
  fromPayload: (data) => (
    typeof data.receptorPath === "string" &&
    typeof data.gridDocumentId === "string" &&
    typeof data.gridPath === "string" &&
    typeof data.dockingDocumentId === "string" &&
    typeof data.dockingPath === "string" &&
    typeof data.referencePose === "number"
      ? {
          kind: "fep-setup",
          receptorPath: data.receptorPath,
          gridDocumentId: data.gridDocumentId,
          gridPath: data.gridPath,
          dockingDocumentId: data.dockingDocumentId,
          dockingPath: data.dockingPath,
          referencePose: data.referencePose,
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

function FepSetupWorkspace({
  location,
  docking,
  grid,
}: {
  location: FepSetupLocation;
  docking: ViewerDocument;
  grid: ViewerDocument;
}) {
  return (
    <section className="fep-setup-workspace" aria-label="FEP setup workspace">
      <div className="fep-setup-pane fep-setup-pane-docking">
        <ViewerFrame document={docking} readOnly />
      </div>
      <aside className="fep-setup-panel">
        <header>
          <span>FEP Setup</span>
          <h2>{grid.title}</h2>
        </header>
        <dl>
          <div>
            <dt>Receptor</dt>
            <dd>{fileName(location.receptorPath)}</dd>
          </div>
          <div>
            <dt>Reference pose</dt>
            <dd>{location.referencePose + 1}</dd>
          </div>
          <div>
            <dt>Ligand collection</dt>
            <dd>{grid.title}</dd>
          </div>
          {location.candidatePayload && (location.candidatePayload.paths.length > 0 || location.candidatePayload.records.length > 0) && (
            <div>
              <dt>Candidate ligand input</dt>
              <dd>
                <span>{payloadSummary(location.candidatePayload)}</span>
                <ul className="fep-setup-candidates">
                  {candidateLabels(location.candidatePayload).map((label) => <li key={label}>{label}</li>)}
                </ul>
              </dd>
            </div>
          )}
        </dl>
        <p>Source files remain unchanged.</p>
      </aside>
      <div className="fep-setup-pane fep-setup-pane-grid">
        <ViewerFrame document={grid} readOnly />
      </div>
    </section>
  );
}

function fileName(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;
}

function payloadSummary(payload: NonNullable<FepSetupRequest["candidatePayload"]>) {
  const pathCount = payload.paths.length;
  const recordCount = payload.records.length;
  const parts = [];
  if (pathCount > 0) parts.push(`${pathCount} path${pathCount === 1 ? "" : "s"}`);
  if (recordCount > 0) parts.push(`${recordCount} inline record${recordCount === 1 ? "" : "s"}`);
  return parts.join(", ");
}

function candidateLabels(payload: NonNullable<FepSetupRequest["candidatePayload"]>) {
  return [
    ...payload.paths.map(fileName),
    ...payload.records.map((record) => record.path.trim() || `structure.${record.inputExtension}`),
  ].slice(0, 6);
}
