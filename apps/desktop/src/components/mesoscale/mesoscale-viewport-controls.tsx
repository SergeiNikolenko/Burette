import { Camera, Focus, Lightbulb, MousePointer2, Rotate3D } from "lucide-react";
import type { ViewerDocument } from "../../types";
import type { MesoscaleMotion } from "../../lib/mesoscale-contract";
import { requestMesoscale, useMesoscaleStore } from "../../stores/mesoscale-store";

const NEXT_MOTION: Record<MesoscaleMotion, MesoscaleMotion> = { off: "spin", spin: "rock", rock: "off" };

export function MesoscaleViewportControls({ document }: { document: ViewerDocument }) {
  const session = useMesoscaleStore((state) => state.sessions[document.id]);
  const disabled = !session || session.status === "loading" || session.status === "disposed";
  const run = (action: Parameters<typeof requestMesoscale>[1]) => void requestMesoscale(document.id, action).catch(() => undefined);
  const motion = session?.summary?.motion ?? "off";

  return (
    <div className="mesoscale-viewport-rail" role="toolbar" aria-label="Mesoscale viewport controls">
      <button type="button" disabled={disabled} onClick={() => run({ type: "resetCamera" })} title="Reset camera" aria-label="Reset camera">
        <Focus size={16} />
      </button>
      <button type="button" disabled={disabled} onClick={() => run({ type: "exportPng" })} title="Save PNG" aria-label="Save PNG">
        <Camera size={16} />
      </button>
      <button
        type="button"
        className={session?.summary?.illumination ? "active" : ""}
        disabled={disabled}
        aria-pressed={session?.summary?.illumination ?? false}
        onClick={() => run({ type: "setIllumination", enabled: !session?.summary?.illumination })}
        title="Realistic lighting"
        aria-label="Realistic lighting"
      >
        <Lightbulb size={16} />
      </button>
      <button
        type="button"
        className={motion !== "off" ? "active" : ""}
        disabled={disabled}
        aria-pressed={motion !== "off"}
        onClick={() => run({ type: "setMotion", motion: NEXT_MOTION[motion] })}
        title={`Scene motion: ${motion}. Click for ${NEXT_MOTION[motion]}`}
        aria-label={`Scene motion: ${motion}`}
      >
        <Rotate3D size={16} />
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
        <MousePointer2 size={16} />
      </button>
    </div>
  );
}
