import { useState } from "react";

import { ArrowLeft } from "@/components/ui/app-icons";
import { Button } from "./ui/button";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import type { ShellActions, ShellViewState } from "./types";

type HostedKetcherView = "ketcher" | "molstar" | "xyzrender";

const VIEWS: ReadonlyArray<{ value: HostedKetcherView; label: string }> = [
  { value: "ketcher", label: "Molecular editor" },
  { value: "molstar", label: "Interactive 3D" },
  { value: "xyzrender", label: "3D render" },
];

// The ChatGPT Ketcher widget has no tabs, so this switch moves the sketch between
// the editor and the two renderers. The renderers read the editor's saved draft;
// the Ketcher tab stays mounted, so returning to it keeps the user's edits.
export function HostedKetcherViewSwitch({
  state,
  actions,
  showHomeBack = false,
  showSketchSwitch = true,
  title,
}: {
  state: Pick<ShellViewState, "activeTab" | "activeDocument" | "ketcherDraftMolfile">;
  actions: Pick<ShellActions, "openKetcher" | "openKetcherSketch" | "clearAllDocuments">;
  showHomeBack?: boolean;
  showSketchSwitch?: boolean;
  title?: string | null;
}) {
  const [pending, setPending] = useState<HostedKetcherView | null>(null);
  const current: HostedKetcherView = state.activeTab?.location.kind === "ketcher"
    ? "ketcher"
    : state.activeDocument?.renderer === "xyzrender-external" ? "xyzrender" : "molstar";
  const molfile = state.ketcherDraftMolfile.trimEnd();

  const select = async (view: HostedKetcherView) => {
    if (view === current || pending) return;
    if (view === "ketcher") {
      actions.openKetcher();
      return;
    }
    setPending(view);
    try {
      await actions.openKetcherSketch({
        title: "molecule.sdf",
        extension: "sdf",
        text: `${molfile}\n$$$$\n`,
        draftMolfile: molfile,
        target: view,
      });
    } catch {
      // openKetcherSketch already reports the failure in the status line.
    } finally {
      setPending(null);
    }
  };

  const returnHome = () => {
    window.dispatchEvent(new Event("burette-hosted-return-home"));
    void actions.clearAllDocuments();
  };

  return (
    <nav className="hosted-ketcher-view-switch" data-has-home={showHomeBack ? "true" : undefined} aria-label={showSketchSwitch ? "Sketch view" : "Workspace navigation"}>
      <div className="hosted-workspace-bar-leading">
        {showHomeBack ? (
          <Button type="button" variant="ghost" size="xs" className="hosted-home-back" onClick={returnHome}>
            <ArrowLeft size={14} aria-hidden />
            Home
          </Button>
        ) : null}
      </div>
      <div className="hosted-workspace-bar-center">
        {showSketchSwitch ? (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={pending ?? current}
            onValueChange={(value) => { if (value) void select(value as HostedKetcherView); }}
          >
            {VIEWS.map((view) => (
              <ToggleGroupItem
                key={view.value}
                value={view.value}
                className="px-3"
                disabled={view.value !== "ketcher" && !molfile}
              >
                {view.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : title ? (
          <span className="hosted-workspace-title">{title}</span>
        ) : null}
      </div>
      <div className="hosted-workspace-bar-trailing" aria-hidden />
    </nav>
  );
}
