import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime, trackTauriListener } from "../../lib/tauri";

export type NativeMemoryPressureLevel = "normal" | "warn" | "critical";

export const MEMORY_PRESSURE_EVENT = "memory-pressure";

type NativeMemoryPressurePayload = {
  level?: unknown;
};

export function normalizeMemoryPressureLevel(value: unknown): NativeMemoryPressureLevel | null {
  return value === "normal" || value === "warn" || value === "critical" ? value : null;
}

export function useNativeMemoryPressure(): NativeMemoryPressureLevel {
  const [level, setLevel] = useState<NativeMemoryPressureLevel>("normal");

  useEffect(() => {
    if (!isTauriRuntime()) return;
    return trackTauriListener(
      listen<NativeMemoryPressurePayload>(MEMORY_PRESSURE_EVENT, (event) => {
        const next = normalizeMemoryPressureLevel(event.payload?.level);
        if (next) setLevel(next);
      }),
      "memory-pressure",
    );
  }, []);

  return level;
}
