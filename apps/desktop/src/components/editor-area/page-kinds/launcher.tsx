import { WelcomeScreen } from "../../welcome";
import { definePageKind } from "./types";

export type LauncherLocation = { kind: "launcher" };

export const launcherKind = definePageKind<"launcher", LauncherLocation>({
  kind: "launcher",
  title: () => "New tab",
  description: "Open a structure",
  Component: ({ state, actions }) => <WelcomeScreen actions={actions} buildInfo={state.buildInfo} />,
  serialize: () => null,
});
