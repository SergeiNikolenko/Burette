import type { ViewerDocument } from "../../types";
import { appInstanceLabel } from "../../lib/instance";
import { useWindowTitle } from "./use-window-title";

export function WindowTitle({ activeDocument }: { activeDocument: ViewerDocument | null }) {
  useWindowTitle(activeDocument ? `${activeDocument.title} - ${appInstanceLabel}` : appInstanceLabel);
  return null;
}
