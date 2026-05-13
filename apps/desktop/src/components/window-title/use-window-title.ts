import { useEffect } from "react";

import { isDevInstance } from "../../dev-instance";

export function useWindowTitle(title: string) {
  useEffect(() => {
    document.title = title;
    if (!isDevInstance() || !("__TAURI_INTERNALS__" in window)) return;
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(title))
      .catch(() => undefined);
  }, [title]);
}
