import { Camera, Gauge, Lightbulb, Moon, MousePointer2, PanelRightOpen, RotateCcw, Sun } from "lucide-react";
import type { ViewerDocument, ViewerPreferences } from "../../types";
import type { ShellActions } from "../types";
import { requestMesoscale, useMesoscaleStore } from "../../stores/mesoscale-store";
import type { MesoscaleGraphicsMode } from "../../lib/mesoscale-contract";
import { resolveThemeMode, useSystemThemeMode } from "../../lib/theme";

const GRAPHICS: Array<{ value: MesoscaleGraphicsMode; label: string }> = [
  { value: "ultra", label: "Ultra" },
  { value: "quality", label: "Quality" },
  { value: "balanced", label: "Balanced" },
  { value: "performance", label: "Performance" },
];

export function MesoscaleToolbar({ document, actions, preferences }: { document: ViewerDocument; actions: ShellActions; preferences: ViewerPreferences }) {
  const session = useMesoscaleStore((state) => state.sessions[document.id]);
  const systemTheme = useSystemThemeMode();
  const effectiveTheme = resolveThemeMode(preferences.theme, systemTheme);
  const disabled = !session || session.status === "loading" || session.status === "disposed";
  const run = (action: Parameters<typeof requestMesoscale>[1]) => void requestMesoscale(document.id, action).catch(() => undefined);

  return (
    <div className="mesoscale-toolbar" role="toolbar" aria-label="Mesoscale preview controls">
      <div className="mesoscale-toolbar-title" title={document.title}>
        <span className="mesoscale-toolbar-dot" aria-hidden="true" />
        <span>Mesoscale</span>
        <span className="mesoscale-toolbar-count">{session?.summary?.counts.instances.toLocaleString() ?? "…"} instances</span>
      </div>
      <label className="mesoscale-toolbar-select">
        <Gauge size={14} aria-hidden="true" />
        <span className="sr-only">Graphics quality</span>
        <select
          value={session?.summary?.graphics ?? "balanced"}
          disabled={disabled}
          onChange={(event) => run({ type: "setGraphics", graphics: event.target.value as MesoscaleGraphicsMode })}
        >
          {GRAPHICS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <button type="button" disabled={disabled} onClick={() => run({ type: "resetCamera" })} title="Reset camera" aria-label="Reset camera">
        <RotateCcw size={15} />
      </button>
      <button type="button" disabled={disabled} onClick={() => run({ type: "exportPng" })} title="Save PNG" aria-label="Save PNG">
        <Camera size={15} />
      </button>
      <span className="mesoscale-toolbar-divider" aria-hidden="true" />
      <button
        type="button"
        className={session?.summary?.illumination ? "active" : ""}
        disabled={disabled}
        aria-pressed={session?.summary?.illumination ?? false}
        onClick={() => run({ type: "setIllumination", enabled: !session?.summary?.illumination })}
        title="Realistic lighting"
        aria-label="Realistic lighting"
      >
        <Lightbulb size={15} />
      </button>
      <button
        type="button"
        className={session?.summary?.selectionMode ? "active" : ""}
        disabled={disabled}
        aria-pressed={session?.summary?.selectionMode ?? false}
        onClick={() => run({ type: "setSelectionMode", enabled: !session?.summary?.selectionMode })}
        title="Selection mode"
        aria-label="Selection mode"
      >
        <MousePointer2 size={15} />
      </button>
      <button
        type="button"
        onClick={() => actions.setPreference("theme", effectiveTheme === "dark" ? "light" : "dark")}
        title={`Switch to ${effectiveTheme === "dark" ? "light" : "dark"} theme`}
        aria-label={`Switch to ${effectiveTheme === "dark" ? "light" : "dark"} theme`}
      >
        {effectiveTheme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
      </button>
      <button
        type="button"
        className="mesoscale-toolbar-scene"
        onClick={() => {
          actions.setDockDocument("right", document.id);
          actions.setDockOpen("right", true);
          actions.openDockTab("right", "scene");
        }}
      >
        <PanelRightOpen size={15} />
        Scene
      </button>
    </div>
  );
}
