import { WelcomeScreen } from "../../welcome";
import { definePageKind } from "./types";

export type LauncherLocation = { kind: "launcher" };

export const launcherKind = definePageKind<"launcher", LauncherLocation>({
  kind: "launcher",
  title: () => "New tab",
  description: "Open a structure",
  Component: ({ actions, isActive }) => <WelcomeScreen actions={actions} isActive={isActive} />,
  serialize: () => null,
});
