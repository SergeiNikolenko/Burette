import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime } from "../lib/tauri";
import type { UpdatePreferences, UpdateState } from "../update";

type Availability = { engine: "legacy" | "sparkle" } | { engine: "unavailable"; reason: string };

export function useNativeUpdates(
  enabled: boolean,
  preferences: UpdatePreferences,
  setUpdate: Dispatch<SetStateAction<UpdateState>>,
) {
  const [availability, setAvailability] = useState<Availability | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    if (!isTauriRuntime()) {
      setAvailability({ engine: "legacy" });
      return;
    }
    void invoke<Availability>("native_update", {
      operation: { type: "configure", ...preferences },
    }).then((result) => {
      if (disposed) return;
      setAvailability(result);
      if (result.engine !== "legacy") {
        setUpdate((previous) => ({
          ...previous,
          nativeUpdates: result.engine === "sparkle",
          availableRelease: null,
          statusText: result.engine === "unavailable" ? result.reason : "Updates are managed by Sparkle.",
        }));
      }
    }).catch((error: unknown) => {
      if (disposed) return;
      const reason = "Update initialization failed: " + String(error);
      setAvailability({ engine: "unavailable", reason });
      setUpdate((previous) => ({ ...previous, statusText: reason }));
    });
    return () => { disposed = true; };
  }, [enabled, preferences.checkAutomatically, preferences.channel, setUpdate]);

  useEffect(() => {
    if (!enabled || availability?.engine !== "sparkle") return;
    const subscriptions = [
      ["will-download-update", "Downloading update in the background…"],
      ["did-extract-update", "Update ready. Check to review and restart, or install when quitting."],
      ["will-install-update-on-quit", "Update downloaded. Check to review and restart, or install when quitting."],
      ["user-did-cancel-download", "Update download cancelled."],
      ["did-finish-update-cycle", "Update check finished. Details are shown in the update window."],
    ].map(([event, message]) => listen("sparkle://" + event, () => {
      setUpdate((previous) => ({ ...previous, statusText: message }));
    }));
    return () => {
      for (const subscription of subscriptions) void subscription.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [availability?.engine, enabled, setUpdate]);

  const check = useCallback(async () => {
    if (!availability) throw new Error("Update checks are not ready yet.");
    if (availability.engine === "unavailable") throw new Error(availability.reason);
    await invoke("native_update", { operation: { type: "check" } });
  }, [availability]);

  return useMemo(() => ({ engine: availability?.engine ?? "pending", check }), [availability?.engine, check]);
}
