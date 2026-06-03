import { Suspense, lazy } from "react";
import { definePageKind } from "./types";

export type KetcherLocation = { kind: "ketcher" };

const KetcherPage = lazy(() => import("../../ketcher-page").then((module) => ({
  default: module.KetcherPage,
})));

export const ketcherKind = definePageKind<"ketcher", KetcherLocation>({
  kind: "ketcher",
  title: () => "Ketcher",
  description: "Molecule sketch editor",
  Component: ({ state, actions, isActive }) => (
    <Suspense fallback={null}>
      <KetcherPage state={state} actions={actions} isActive={isActive} />
    </Suspense>
  ),
  keepAlive: false,
});
