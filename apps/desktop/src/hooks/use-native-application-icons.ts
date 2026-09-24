import { useEffect, useState } from "react";
import type { ChemicalEditorTarget } from "../components/types";

// Header remounts and target-list refreshes must not blank already loaded icons.
// Cache is scoped to this JS workspace and bounded; file authorization still
// happens on the first request for each file/target pair.
const icons = new Map<string, string>();
const pending = new Map<string, Promise<void>>();

/** Native MCP images must be materialized: an img request cannot use the fetch bridge. */
export function useNativeApplicationIcons(path: string | null, targets: ChemicalEditorTarget[]) {
  const [, refresh] = useState(0);
  const targetKey = JSON.stringify(["finder", "default", ...targets.map(target => target.id)]);
  useEffect(() => {
    if (!window.BuretteMcpWorkspace || !path) return;
    let cancelled = false;
    void (async () => {
      for (const targetId of JSON.parse(targetKey) as string[]) {
        if (cancelled) break;
        const key = JSON.stringify([path, targetId]);
        if (icons.has(key)) continue;
        if (!pending.has(key)) pending.set(key, (async () => {
          try {
            const response = await fetch("/__burette/file-action", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ type: "app_icon", path, targetId }),
            });
            if (!response.ok) return;
            const { iconUrl } = await response.json();
            if (typeof iconUrl === "string" && iconUrl.startsWith("data:image/png;base64,")) {
              icons.set(key, iconUrl);
              if (icons.size > 128) icons.delete(icons.keys().next().value!);
            }
          } catch { /* Missing artwork must not break Open With. */ }
        })().finally(() => pending.delete(key)));
        await pending.get(key);
        if (!cancelled) refresh(value => value + 1);
      }
    })();
    return () => { cancelled = true; };
  }, [path, targetKey]);
  return Object.fromEntries((JSON.parse(targetKey) as string[]).flatMap(id => {
    const icon = icons.get(JSON.stringify([path, id]));
    return icon ? [[id, icon]] : [];
  }));
}
