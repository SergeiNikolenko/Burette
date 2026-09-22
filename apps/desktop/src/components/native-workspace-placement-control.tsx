import { createPortal } from "react-dom";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { ExpandLarge, CollapseLarge } from "@openai/apps-sdk-ui/components/Icon";
import { useThemePortalContainer } from "./radix-menu";
import { useNativeWorkspacePlacement } from "../hooks/use-native-workspace-placement";
import "../plugin-ui.css";

export function NativeWorkspacePlacementControl() {
  const placement = window.BuretteMcpWorkspace?.placement;
  const state = useNativeWorkspacePlacement();
  const container = useThemePortalContainer();
  if (!placement || !state || !container) return null;
  const label = state.mode === "inline" ? "Open in side pane" : "Return to chat";
  return createPortal(
    <div className="absolute right-3 bottom-3 z-20" data-workspace-placement-control>
      <Button color="secondary" variant="solid" size="sm" disabled={state.disabled}
        aria-label={label} onClick={() => { void placement.set(state.target).catch(() => {}); }}>
        Codex {state.mode === "inline" ? <ExpandLarge aria-hidden="true" /> : <CollapseLarge aria-hidden="true" />}
      </Button>
    </div>, container.ownerDocument.body
  );
}
