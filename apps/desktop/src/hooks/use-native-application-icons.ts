import { useEffect, useState } from "react";
import type { ChemicalEditorTarget } from "../components/types";

/** Native MCP images must be materialized: an img request cannot use the fetch bridge. */
export function useNativeApplicationIcons(path: string | null, targets: ChemicalEditorTarget[]) {
  const [icons, setIcons] = useState<Record<string, string>>({});
  useEffect(() => {
    setIcons({});
    if (!window.BuretteMcpWorkspace || !path) return;
    let cancelled = false;
    void (async () => {
      for (const targetId of ["finder", "default", ...targets.map(target => target.id)]) {
        if (cancelled) break;
        try {
          const response = await fetch("/__burette/file-action", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "app_icon", path, targetId }),
          });
          if (!response.ok) continue;
          const { iconUrl } = await response.json();
          if (!cancelled && typeof iconUrl === "string" && iconUrl.startsWith("data:image/png;base64,")) {
            setIcons(current => ({ ...current, [targetId]: iconUrl }));
          }
        } catch { /* An unavailable application icon must not break Open With. */ }
      }
    })();
    return () => { cancelled = true; };
  }, [path, targets]);
  return icons;
}
