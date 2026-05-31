import { KetcherPage } from "../../ketcher-page";
import { definePageKind } from "./types";

export type KetcherLocation = { kind: "ketcher" };

export const ketcherKind = definePageKind<"ketcher", KetcherLocation>({
  kind: "ketcher",
  title: () => "Ketcher",
  description: "Molecule sketch editor",
  Component: ({ state, actions, isActive }) => <KetcherPage state={state} actions={actions} isActive={isActive} />,
  keepAlive: false,
});
