import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useNativeWorkspacePlacement } from "../hooks/use-native-workspace-placement";

export function NativeWorkspacePlacementControl() {
  const placement = window.BuretteMcpWorkspace?.placement;
  const state = useNativeWorkspacePlacement();
  const [error, setError] = useState("");
  if (!placement || !state) return null;
  const label = state.mode === "inline" ? "Open in side pane" : "Return to chat";
  return (
    <div data-workspace-placement-control>
      {error && <div role="alert" className="workspace-placement-error">{error}</div>}
      <Button variant="outline" size="sm" className="workspace-placement-trigger" disabled={state.disabled}
        aria-label={label} onClick={() => {
          setError("");
          void placement.set(state.target).then(result => {
            if (!result.ok) setError("Codex did not change the panel.");
          }).catch(cause => setError(`Could not change panel: ${cause.message}`));
        }}>{label}</Button>
    </div>
  );
}
