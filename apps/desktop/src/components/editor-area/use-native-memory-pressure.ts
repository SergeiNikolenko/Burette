import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime, trackTauriListener } from "../../lib/tauri";

export type NativeMemoryPressureLevel = "normal" | "warn" | "critical";

export const MEMORY_PRESSURE_EVENT = "memory-pressure";
export const MEMORY_PRESSURE_LEVEL_COMMAND = "current_memory_pressure_level";

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
    let disposed = false;
    let receivedLiveEvent = false;
    const cleanup = trackTauriListener(
      listen<NativeMemoryPressurePayload>(MEMORY_PRESSURE_EVENT, (event) => {
        if (disposed) return;
        const next = normalizeMemoryPressureLevel(event.payload?.level);
        if (next) {
          receivedLiveEvent = true;
          setLevel(next);
        }
      }),
      "memory-pressure",
    );
    void invoke<NativeMemoryPressurePayload>(MEMORY_PRESSURE_LEVEL_COMMAND)
      .then((payload) => {
        if (disposed || receivedLiveEvent) return;
        const initial = normalizeMemoryPressureLevel(payload?.level);
        if (initial) setLevel(initial);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  return level;
}
