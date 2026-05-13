import type { ShellTab } from "../../types";
import { NewTabPage } from "../new-tab-page";
import { definePageKind } from "./types";

type LauncherTab = ShellTab & { kind: "launcher" };

function LauncherPage({ state, actions }: { tab: LauncherTab; isActive: boolean } & Parameters<typeof NewTabPage>[0]) {
  return <NewTabPage state={state} actions={actions} />;
}

export const launcherKind = definePageKind<LauncherTab>({
  kind: "launcher",
  title: () => "New tab",
  description: "Open a new tab",
  Component: LauncherPage,
});
