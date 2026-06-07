import { Suspense, lazy } from "react";
import { definePageKind, type SerializedLocation } from "./types";

export type KetcherLocationImportRequest = {
  id: number;
  paths: string[];
  fragments?: Array<{
    title: string;
    text: string;
    source?: {
      kind: "grid-row";
      documentId: string;
      rowIndex: number;
      title: string;
      extension: string;
    };
  }>;
};

export type KetcherLocation = {
  kind: "ketcher";
  draftKet?: string;
  draftMolfile?: string;
  importRequestId?: number;
  importRequest?: KetcherLocationImportRequest;
};

const KetcherPage = lazy(() => import("../../ketcher-page").then((module) => ({
  default: module.KetcherPage,
})));

export const ketcherKind = definePageKind<"ketcher", KetcherLocation>({
  kind: "ketcher",
  title: () => "Ketcher",
  description: "Molecule sketch editor",
  Component: ({ location, state, actions, isActive }) => (
    <Suspense fallback={null}>
      <KetcherPage location={location} state={state} actions={actions} isActive={isActive} />
    </Suspense>
  ),
  keepAlive: true,
  fromPayload: (data: SerializedLocation) => ({
    kind: "ketcher",
    draftKet: typeof data.draftKet === "string" ? data.draftKet : undefined,
    draftMolfile: typeof data.draftMolfile === "string" ? data.draftMolfile : undefined,
  }),
  serialize: (location) => location.draftKet?.trim() || location.draftMolfile?.trim()
    ? { draftKet: location.draftKet, draftMolfile: location.draftMolfile }
    : {},
});
