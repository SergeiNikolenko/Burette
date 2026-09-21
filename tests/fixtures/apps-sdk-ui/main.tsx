import React from "react";
import { createRoot } from "react-dom/client";
import "../../../apps/desktop/src/styles.css";
import { NativeWorkspacePlacementControl } from "../../../apps/desktop/src/components/native-workspace-placement-control";

// Exercises the real component against the real placement state machine;
// only the Codex host transport is simulated. No molecule or native-UI claim.
import { createWorkspacePlacement } from "../../../plugins/burette-agent/ui/native-workspace-placement.mjs";
const status = document.createElement("p");
status.id = "status";
status.setAttribute("role", "status");
document.body.append(status);
let rejectPlacement = false;
const placement = createWorkspacePlacement({
  getHostContext: () => ({ displayMode: "inline", availableDisplayModes: ["inline", "fullscreen"] }),
  sendSizeChanged: async () => {},
  requestDisplayMode: async ({ mode }: { mode: string }) => {
    if (rejectPlacement) throw new Error("Host rejected the display change");
    status.textContent = `Host confirmed: ${mode}`;
    return { mode };
  },
}, status);
window.BuretteMcpWorkspace = {
  sessionId: "sdk-ui-fixture", initialPaths: [], closed: false, theme: "light",
  preparePreview: (html: string) => html, placement,
};
function Fixture() {
  const [theme, setTheme] = React.useState("light");
  return <>
    <div style={{ padding: 24, display: "flex", gap: 24 }}>
      <button onClick={() => {
        const next = theme === "light" ? "dark" : "light";
        setTheme(next);
        document.documentElement.dataset.theme = next;
        window.BuretteMcpWorkspace!.theme = next;
        window.dispatchEvent(new Event("burette-host-theme"));
      }}>Toggle test theme</button>
      <label><input type="checkbox" onChange={(event) => { rejectPlacement = event.target.checked; }} /> Reject placement</label>
      <label><input type="checkbox" onChange={(event) => placement.update({ availableDisplayModes: event.target.checked ? ["inline"] : ["inline", "fullscreen"] })} /> Disable expansion</label>
    </div>
    <main className="app-shell" data-theme={theme} data-effective-theme={theme} style={{ height: "60vh", background: theme === "light" ? "white" : "#212121" }}>
      <p style={{ padding: 24 }}>Real Apps SDK UI menu · simulated host</p>
    </main>
    <NativeWorkspacePlacementControl />
  </>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
