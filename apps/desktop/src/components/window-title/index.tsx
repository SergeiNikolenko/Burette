import type { ShellViewState } from "../types";
import { pageKind } from "../editor-area/page-kinds";
import { appInstanceLabel } from "../../lib/instance";
import { isHostedKetcherWidget } from "../../lib/hosted-mcp-widget";
import { useWindowTitle } from "./use-window-title";

export function WindowTitle({ state }: { state: ShellViewState }) {
  const tab = state.activeTab;
  const title = isHostedKetcherWidget()
    ? "Molecular editor"
    : tab ? tab.title ?? pageKind(tab.location).title(tab.location, state) : null;
  useWindowTitle(title ? `${title} — ${appInstanceLabel}` : appInstanceLabel);
  return null;
}
