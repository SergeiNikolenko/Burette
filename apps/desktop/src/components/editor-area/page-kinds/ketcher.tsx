import { Suspense, lazy } from "react";
import { definePageKind, type SerializedLocation } from "./types";

export type KetcherLocation = { kind: "ketcher"; draftKet?: string; draftMolfile?: string };

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
