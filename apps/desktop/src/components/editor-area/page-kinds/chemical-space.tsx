import { Suspense, lazy } from "react";
import type { ViewerDocument } from "../../../types";
import type { ShellViewState } from "../../types";
import { definePageKind } from "./types";

// three.js stays out of the entry chunk, as it does for the dock tab.
const ChemicalSpacePanel = lazy(() => import("../../chemical-space-panel").then((module) => ({
  default: module.ChemicalSpacePanel,
})));

export type ChemicalSpaceLocation = { kind: "chemical-space"; collectionPath?: string };

function supportsChemicalSpace(document: ViewerDocument | null | undefined): document is ViewerDocument {
  return document?.renderer === "grid2d"
    || ["csv", "tsv", "dwar", "smi", "smiles"].includes(document?.extension.toLowerCase() ?? "");
}

// A screen opened for a collection keeps mapping it; one opened without a
// path follows whichever collection is in front.
function chemicalSpaceDocument(location: ChemicalSpaceLocation, state: ShellViewState) {
  if (location.collectionPath) {
    const pinned = state.documents.find((document) => document.path === location.collectionPath);
    if (supportsChemicalSpace(pinned)) return pinned;
  }
  if (supportsChemicalSpace(state.activeDocument)) return state.activeDocument;
  return state.documents.find(supportsChemicalSpace) ?? null;
}

export const chemicalSpaceKind = definePageKind<"chemical-space", ChemicalSpaceLocation>({
  kind: "chemical-space",
  title: (location, state) => {
    const document = location.collectionPath ? chemicalSpaceDocument(location, state) : null;
    return document ? `Chemical space · ${document.title}` : "Chemical space";
  },
  description: "Chemical space map",
  keepAlive: true,
  fromPayload: (data) => ({ kind: "chemical-space", ...(typeof data.path === "string" ? { collectionPath: data.path } : {}) }),
  serialize: (location) => (location.collectionPath ? { path: location.collectionPath } : {}),
  Component: ({ location, state, isActive }) => (
    <div className="screen-stage">
      <Suspense fallback={null}>
        <ChemicalSpacePanel document={chemicalSpaceDocument(location, state)} visible={isActive} />
      </Suspense>
    </div>
  ),
});
