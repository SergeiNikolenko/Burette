import { useEffect, useState } from "react";
import type { ViewerDocument } from "../../types";
import { devInstanceTitle, devInstanceTitleFor, isDevInstance } from "../../dev-instance";
import { developmentInstanceName } from "../../lib/tauri";
import { isTauriRuntime } from "../../lib/runtime";
import type { AppPage } from "../types";
import { useWindowTitle } from "./use-window-title";

export function WindowTitle({
  activeDocument,
  page,
}: {
  activeDocument: ViewerDocument | null;
  page: AppPage;
}) {
  const [nativeInstanceName, setNativeInstanceName] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void developmentInstanceName()
      .then(setNativeInstanceName)
      .catch(() => setNativeInstanceName(null));
  }, []);

  const appTitle = nativeInstanceName
    ? devInstanceTitleFor(nativeInstanceName)
    : isDevInstance()
      ? devInstanceTitle()
      : "Burrete";
  const title =
    page === "launcher"
      ? `New tab - ${appTitle}`
      : page === "settings"
        ? `Settings - ${appTitle}`
        : activeDocument
          ? `${activeDocument.title} - ${appTitle}`
          : appTitle;
  useWindowTitle(title);
  return null;
}
