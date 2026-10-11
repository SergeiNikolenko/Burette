import { Checkbox } from "./ui/checkbox";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
import { Button } from "./ui/button";

import { PROPERTY_GROUPS, type PropertyRunOptions } from "../lib/derived-columns";
import {
  cancelDescriptorRuntimeInstall,
  descriptorRuntimeStatus,
  installDescriptorRuntime,
  type DescriptorRuntimeStatus,
} from "../lib/descriptors";
import { Spinner } from "./ui/spinner";

export type CalculatePropertiesRequest = {
  documentId: string;
  documentTitle: string;
};

// DataWarrior-style property picker: checkbox groups over the two in-process
// engines, plus the optional Mordred pass that reuses the descriptor pipeline.
// Selection persists for the session so a re-run keeps the previous picks.
const DEFAULT_SELECTION = ["cLogP", "cLogS", "HAcceptors", "HDonors", "TPSA", "RotatableBonds", "MolWeight"];

export function CalculatePropertiesDialog({
  request,
  onDismiss,
  onRun,
}: {
  request: CalculatePropertiesRequest | null;
  onDismiss: () => void;
  onRun: (documentId: string, propertyIds: string[], options: PropertyRunOptions & { mordred: boolean }) => void;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(DEFAULT_SELECTION));
  const [largestFragment, setLargestFragment] = useState(true);
  const [mordred, setMordred] = useState(false);

  useEffect(() => {
    if (request) setMordred(false);
  }, [request]);

  const selectedCount = useMemo(
    () => PROPERTY_GROUPS.reduce(
      (count, group) => count + group.properties.filter((property) => selected.has(property.id)).length,
      0,
    ),
    [selected],
  );

  const toggle = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGroup = (groupId: string) => {
    const group = PROPERTY_GROUPS.find((candidate) => candidate.id === groupId);
    if (!group) return;
    setSelected((previous) => {
      const next = new Set(previous);
      const allOn = group.properties.every((property) => next.has(property.id));
      for (const property of group.properties) {
        if (allOn) next.delete(property.id);
        else next.add(property.id);
      }
      return next;
    });
  };

  const run = () => {
    if (!request || (selectedCount === 0 && !mordred)) return;
    onRun(request.documentId, [...selected], { largestFragment, mordred });
    onDismiss();
  };

  return (
    <Dialog open={request !== null} onOpenChange={open => { if (!open) onDismiss(); }}>
      <DialogContent variant="form" size="wide" className="overscroll-contain">
        <DialogHeader>
          <DialogTitle>Calculate properties</DialogTitle>
          <DialogDescription className="sr-only">Choose properties to calculate for {request?.documentTitle}.</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[min(60dvh,520px)] min-w-0 flex-col gap-3 overflow-y-auto overscroll-contain">
          {PROPERTY_GROUPS.map(group => (
            <fieldset key={group.id} className="min-w-0">
              <legend className="mb-1">
                <Button type="button" variant="ghost" size="xs" className="-ml-2"
                  aria-pressed={group.properties.every(property => selected.has(property.id))}
                  onClick={() => toggleGroup(group.id)}>{group.label.replace(/\s+\([^)]*\)$/u, "")}</Button>
              </legend>
              <div className="grid grid-cols-1 gap-x-3 gap-y-0.5 min-[480px]:grid-cols-2 min-[640px]:grid-cols-3">
                {group.properties.map(property => (
                  <label key={property.id} className="flex min-w-0 cursor-pointer items-center gap-2 py-0.5 text-sm">
                    <Checkbox checked={selected.has(property.id)} onCheckedChange={() => toggle(property.id)} />
                    <span className="min-w-0 break-words">{property.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <fieldset className="min-w-0">
            <legend className="mb-2 text-xs font-medium">Extended descriptors</legend>
            <label className="flex cursor-pointer items-center gap-2 py-1 text-sm">
              <Checkbox checked={mordred} onCheckedChange={() => setMordred(value => !value)} />
              <span>All 2D descriptors (~1,600 columns)</span>
            </label>
            <DescriptorRuntimeInstall open={request !== null} />
          </fieldset>
        </div>
        <label className="flex cursor-pointer items-center gap-2 py-1 text-sm">
          <Checkbox checked={largestFragment} onCheckedChange={() => setLargestFragment(value => !value)} />
          <span>Use largest fragment (strip salts and solvents)</span>
        </label>
        <DialogFooter className="items-center gap-2">
          <span className="mr-auto text-xs text-(--color-text-secondary) tabular-nums" role="status">
            {selectedCount.toLocaleString()} propert{selectedCount === 1 ? "y" : "ies"} selected{mordred ? " + extended descriptors" : ""}
          </span>
          <Button type="button" variant="secondary" onClick={onDismiss}>Cancel</Button>
          <Button type="button" disabled={selectedCount === 0 && !mordred} onClick={run}>Calculate</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// The Mordred pass is the only group that leaves the webview, so it is the only
// one that can be unavailable. Same flow as the learned-model runtime in the
// chemical-space panel: the command starts the install and returns, and the
// status poll is what reports the current step, the failure and the finish.
function DescriptorRuntimeInstall({ open }: { open: boolean }) {
  const [status, setStatus] = useState<DescriptorRuntimeStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const disposed = useRef(false);

  useEffect(() => {
    if (!open) return undefined;
    disposed.current = false;
    setChecking(true);
    setInstallError(null);
    void descriptorRuntimeStatus()
      .then((next) => {
        if (disposed.current) return;
        setStatus(next);
        if (next.installPhase === "installing") setInstalling(true);
      })
      .catch((cause: unknown) => {
        if (disposed.current) return;
        setStatus(null);
        console.error("[Descriptor installation]", cause);
        setInstallError("Could not check availability. Reopen this dialog to try again.");
      })
      .finally(() => {
        if (!disposed.current) setChecking(false);
      });
    return () => {
      disposed.current = true;
    };
  }, [open]);

  useEffect(() => {
    if (!installing) return undefined;
    let stopped = false;
    const poll = window.setInterval(() => {
      void descriptorRuntimeStatus()
        .then((next) => {
          if (stopped) return;
          setStatus(next);
          if (next.installPhase === "completed" && next.available) {
            setInstalling(false);
          } else if (next.installPhase === "cancelled") {
            // The cancel kills the running step, so its own error is the kill,
            // not a reason worth putting in front of whoever asked for it.
            setInstalling(false);
            setInstallError("Installation cancelled.");
          } else if (next.installPhase === "failed") {
            setInstalling(false);
            console.error("[Descriptor installation]", next.installError);
            setInstallError("Installation failed. Try again.");
          }
        })
        .catch(() => undefined);
    }, 1_000);
    return () => {
      stopped = true;
      window.clearInterval(poll);
    };
  }, [installing]);

  return <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-(--color-text-secondary)">
    {checking && !status ? <span className="flex items-center gap-2" role="status"><Spinner className="size-3" aria-hidden />Checking…</span>
      : installing ? <>
        <span className="flex items-center gap-2" role="status"><Spinner className="size-3" aria-hidden />Installing…</span>
        <Button type="button" variant="secondary" size="xs" onClick={() => {
          void cancelDescriptorRuntimeInstall().catch((cause: unknown) => {
            if (disposed.current) return;
            console.error("[Descriptor installation]", cause);
            setInstallError("Could not cancel installation. Try again.");
          });
        }}>Cancel installation</Button>
      </> : status?.available ? <span role="status">Ready</span>
      : status?.installerAvailable ? <Button type="button" variant="secondary" size="xs" onClick={() => {
        setInstallError(null); setInstalling(true);
        void installDescriptorRuntime().catch((cause: unknown) => {
          if (disposed.current) return;
          console.error("[Descriptor installation]", cause);
          setInstalling(false); setInstallError("Installation failed. Try again.");
        });
      }}>Install{status.installSizeHint ? ` (${status.installSizeHint})` : ""}</Button>
      : !installError && <span>Extended descriptors unavailable</span>}
    {installError && <span className="basis-full text-(--color-text-danger)" role="alert">{installError}</span>}
  </div>;
}
