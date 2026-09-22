import { useState } from "react";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { ExpandLarge, CollapseLarge } from "@openai/apps-sdk-ui/components/Icon";
import { useNativeWorkspacePlacement } from "../hooks/use-native-workspace-placement";
import "../plugin-ui.css";

export function NativeWorkspacePlacementControl() {
  const placement = window.BuretteMcpWorkspace?.placement;
  const state = useNativeWorkspacePlacement();
  const [error, setError] = useState("");
  if (!placement || !state) return null;
  const label = state.mode === "inline" ? "Open in side pane" : "Return to chat";
  return (
    <div data-workspace-placement-control>
      {error && <div role="alert" className="workspace-placement-error">{error}</div>}
      <Button color="secondary" variant="solid" size="sm" disabled={state.disabled}
        aria-label={label} onClick={() => {
          setError("");
          void placement.set(state.target).then(result => {
            if (!result.ok) setError("Codex did not change the panel.");
          }).catch(cause => setError(`Could not change panel: ${cause.message}`));
        }}>
        Codex {state.mode === "inline" ? <ExpandLarge aria-hidden="true" /> : <CollapseLarge aria-hidden="true" />}
      </Button>
    </div>
  );
}
