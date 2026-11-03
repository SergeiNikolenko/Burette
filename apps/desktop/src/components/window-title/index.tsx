import type { ShellViewState } from "../types";
import { pageKind } from "../editor-area/page-kinds";
import { appInstanceLabel } from "../../lib/instance";
import { useWindowTitle } from "./use-window-title";

export function WindowTitle({ state }: { state: ShellViewState }) {
  const tab = state.activeTab;
  const title = tab ? tab.title ?? pageKind(tab.location).title(tab.location, state) : null;
  useWindowTitle(title ? `${title} — ${appInstanceLabel}` : appInstanceLabel);
  return null;
}
