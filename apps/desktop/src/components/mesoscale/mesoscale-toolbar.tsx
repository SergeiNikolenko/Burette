import { useState } from "react";
import { ChevronDown, GripVertical, SunMoon } from "lucide-react";
import type { ViewerDocument, ViewerPreferences } from "../../types";
import type { ShellActions } from "../types";
import { requestMesoscale, useMesoscaleStore } from "../../stores/mesoscale-store";
import type { MesoscaleGraphicsMode } from "../../lib/mesoscale-contract";

const GRAPHICS: Array<{ value: MesoscaleGraphicsMode; label: string }> = [
  { value: "ultra", label: "Ultra" },
  { value: "quality", label: "Quality" },
  { value: "balanced", label: "Balanced" },
  { value: "performance", label: "Performance" },
];

export function MesoscaleToolbar({ document, actions, preferences }: { document: ViewerDocument; actions: ShellActions; preferences: ViewerPreferences }) {
  const session = useMesoscaleStore((state) => state.sessions[document.id]);
  const [collapsed, setCollapsed] = useState(false);
  const disabled = !session || session.status === "loading" || session.status === "disposed";
  const run = (action: Parameters<typeof requestMesoscale>[1]) => void requestMesoscale(document.id, action).catch(() => undefined);
  const toggleRegion = (region: "left" | "right") => run({
    type: "setLayoutRegion",
    region,
    visible: !(session?.summary?.layout[region] ?? false),
  });

  return (
    <div className={`mesoscale-toolbar${collapsed ? " collapsed" : ""}`} role="toolbar" aria-label="Mesoscale preview controls">
      <div className="mesoscale-toolbar-content">
        <button
          type="button"
          className={`mesoscale-toolbar-letter${session?.summary?.layout.left ? " active" : ""}`}
          disabled={disabled}
          aria-pressed={session?.summary?.layout.left ?? false}
          onClick={() => toggleRegion("left")}
          title="Toggle Mol* left object tree"
          aria-label="Toggle Mol* left object tree"
        >L</button>
        <button
          type="button"
          className={`mesoscale-toolbar-letter${session?.summary?.layout.right ? " active" : ""}`}
          disabled={disabled}
          aria-pressed={session?.summary?.layout.right ?? false}
          onClick={() => toggleRegion("right")}
          title="Toggle Mol* right properties panel"
          aria-label="Toggle Mol* right properties panel"
        >R</button>
        <label className="mesoscale-toolbar-select">
          <span className="sr-only">Graphics quality</span>
          <select
            value={session?.summary?.graphics ?? "balanced"}
            disabled={disabled}
            onChange={(event) => run({ type: "setGraphics", graphics: event.target.value as MesoscaleGraphicsMode })}
          >
            {GRAPHICS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <ChevronDown size={13} aria-hidden="true" />
        </label>
        <label className="mesoscale-toolbar-select mesoscale-toolbar-theme" title="Viewer theme">
          <SunMoon size={13} aria-hidden="true" />
          <span className="sr-only">Viewer theme</span>
          <select value={preferences.theme} aria-label="Viewer theme" onChange={(event) => actions.setPreference("theme", event.target.value as ViewerPreferences["theme"])}>
            <option value="auto">Auto</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
          <ChevronDown size={13} aria-hidden="true" />
        </label>
      </div>
      <button
        type="button"
        className="mesoscale-toolbar-grip"
        aria-label={collapsed ? "Expand viewer toolbar" : "Collapse viewer toolbar"}
        title={collapsed ? "Expand viewer toolbar" : "Collapse viewer toolbar"}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((value) => !value)}
      >
        <GripVertical size={15} />
      </button>
    </div>
  );
}
