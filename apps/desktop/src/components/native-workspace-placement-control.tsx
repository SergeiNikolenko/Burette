import { createPortal } from "react-dom";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { ChevronUp, ExpandLarge, CollapseLarge } from "@openai/apps-sdk-ui/components/Icon";
import { Menu } from "@openai/apps-sdk-ui/components/Menu";
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
      <Menu>
        <Menu.Trigger>
          <Button color="secondary" variant="outline" size="sm" aria-label="Codex workspace menu">
            Codex <ChevronUp aria-hidden="true" />
          </Button>
        </Menu.Trigger>
        <Menu.Content side="top" align="end" minWidth={220}>
          <Menu.Item disabled={state.disabled} onSelect={() => { void placement.set(state.target).catch(() => {}); }}>
            {state.mode === "inline" ? <ExpandLarge aria-hidden="true" /> : <CollapseLarge aria-hidden="true" />}
            {label}
          </Menu.Item>
          {state.disabled && <Menu.Item>Changing placement is unavailable in this host.</Menu.Item>}
        </Menu.Content>
      </Menu>
    </div>, container.ownerDocument.body
  );
}
