import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "radix-ui";

import { PROPERTY_GROUPS, type PropertyRunOptions } from "../lib/derived-columns";
import {
  cancelDescriptorRuntimeInstall,
  descriptorRuntimeStatus,
  installDescriptorRuntime,
  type DescriptorRuntimeStatus,
} from "../lib/descriptors";
import { useAppShellPortalContainer } from "./ui/portal-container";
import { Spinner } from "./ui/spinner";
import { CloseIcon } from "./close-icon";

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
  const portalContainer = useAppShellPortalContainer();
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
    <Dialog.Root
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <Dialog.Portal container={portalContainer}>
        <Dialog.Overlay className="radix-dialog-overlay" />
        <Dialog.Content className="radix-dialog calculate-properties-dialog" aria-describedby="calculate-properties-body">
          <div className="radix-dialog-header">
            <Dialog.Title>Calculate Properties</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="radix-dialog-close" aria-label="Close calculate properties">
                <CloseIcon size={14} />
              </button>
            </Dialog.Close>
          </div>
          <div id="calculate-properties-body" className="radix-dialog-body">
            <p className="calculate-properties-target">
              Adds the selected property columns to <strong>{request?.documentTitle}</strong>.
            </p>
            {PROPERTY_GROUPS.map((group) => (
              <fieldset key={group.id} className="calculate-properties-group">
                <legend>
                  <button type="button" className="calculate-properties-group-toggle" onClick={() => toggleGroup(group.id)}>
                    {group.label}
                  </button>
                </legend>
                <div className="calculate-properties-grid">
                  {group.properties.map((property) => (
                    <label key={property.id} className="calculate-properties-option">
                      <input
                        type="checkbox"
                        checked={selected.has(property.id)}
                        onChange={() => toggle(property.id)}
                      />
                      <span>{property.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <fieldset className="calculate-properties-group">
              <legend>Extended (Mordred)</legend>
              <label className="calculate-properties-option">
                <input
                  type="checkbox"
                  checked={mordred}
                  onChange={() => setMordred((value) => !value)}
                />
                <span>All Mordred 2D descriptors (~1,600 columns, needs the Python runtime)</span>
              </label>
              <DescriptorRuntimeInstall open={request !== null} />
            </fieldset>
            <fieldset className="calculate-properties-group">
              <legend>Options</legend>
              <label className="calculate-properties-option">
                <input
                  type="checkbox"
                  checked={largestFragment}
                  onChange={() => setLargestFragment((value) => !value)}
                />
                <span>Use largest fragment (strip salts and solvents)</span>
              </label>
            </fieldset>
          </div>
          <div className="radix-dialog-footer calculate-properties-footer">
            <span className="calculate-properties-count">
              {selectedCount.toLocaleString()} propert{selectedCount === 1 ? "y" : "ies"} selected{mordred ? " + Mordred" : ""}
            </span>
            <div className="calculate-properties-actions">
              <Dialog.Close asChild>
                <button type="button" className="dock-action">Cancel</button>
              </Dialog.Close>
              <button
                type="button"
                className="dock-action calculate-properties-run"
                disabled={selectedCount === 0 && !mordred}
                onClick={run}
              >
                Calculate
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
        setInstallError(errorMessage(cause));
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
            setInstallError("The descriptor runtime installation was cancelled.");
          } else if (next.installPhase === "failed") {
            setInstalling(false);
            setInstallError(next.installError ?? "The descriptor runtime installation failed.");
          }
        })
        .catch(() => undefined);
    }, 1_000);
    return () => {
      stopped = true;
      window.clearInterval(poll);
    };
  }, [installing]);

  if (checking && !status) {
    return <p className="calculate-properties-runtime">Checking the descriptor runtime...</p>;
  }
  if (installing) {
    return (
      <div className="calculate-properties-runtime">
        <span className="calculate-properties-runtime-progress">
          <Spinner /> Installing the descriptor runtime...
        </span>
        {status?.installLine ? (
          <span className="calculate-properties-runtime-line">{status.installLine}</span>
        ) : null}
        <button
          type="button"
          className="dock-action"
          onClick={() => {
            void cancelDescriptorRuntimeInstall().catch((cause: unknown) => setInstallError(errorMessage(cause)));
          }}
        >
          Cancel installation
        </button>
      </div>
    );
  }
  if (status?.available) {
    const versions = [
      status.rdkitVersion ? `RDKit ${status.rdkitVersion}` : null,
      status.mordredVersion ? `Mordred ${status.mordredVersion}` : null,
    ].filter(Boolean).join(" / ");
    return (
      <p className="calculate-properties-runtime" data-tone="ready">
        Runtime installed{versions ? `: ${versions}` : ""}.
      </p>
    );
  }
  return (
    <div className="calculate-properties-runtime" data-tone="missing">
      <span>{status?.message ?? "The descriptor runtime is not available."}</span>
      {status?.installerAvailable ? (
        <button
          type="button"
          className="dock-action"
          onClick={() => {
            setInstallError(null);
            setInstalling(true);
            void installDescriptorRuntime().catch((cause: unknown) => {
              setInstalling(false);
              setInstallError(errorMessage(cause));
            });
          }}
        >
          Install runtime ({status.installSizeHint})
        </button>
      ) : null}
      {status?.installHint ? <span className="calculate-properties-runtime-hint">{status.installHint}</span> : null}
      {installError ? <span className="calculate-properties-runtime-error">{installError}</span> : null}
    </div>
  );
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}
