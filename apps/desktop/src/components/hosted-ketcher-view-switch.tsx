import { useState } from "react";

import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import type { ShellActions, ShellViewState } from "./types";

type HostedKetcherView = "ketcher" | "molstar" | "xyzrender";

const VIEWS: ReadonlyArray<{ value: HostedKetcherView; label: string }> = [
  { value: "ketcher", label: "Ketcher" },
  { value: "molstar", label: "Mol*" },
  { value: "xyzrender", label: "xyzrender" },
];

// The ChatGPT Ketcher widget has no tabs, so this switch moves the sketch between
// the editor and the two renderers. The renderers read the editor's saved draft;
// the Ketcher tab stays mounted, so returning to it keeps the user's edits.
export function HostedKetcherViewSwitch({ state, actions }: {
  state: Pick<ShellViewState, "activeTab" | "activeDocument" | "ketcherDraftMolfile">;
  actions: Pick<ShellActions, "openKetcher" | "openKetcherSketch">;
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
        title: "ketcher-sketch.sdf",
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

  return (
    <nav className="hosted-ketcher-view-switch" aria-label="Sketch view">
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
    </nav>
  );
}
