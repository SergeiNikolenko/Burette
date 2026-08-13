import { useEffect, useState } from "react";
import { Dialog } from "radix-ui";

import { useAppShellPortalContainer } from "./ui/portal-container";
import { CloseIcon } from "./close-icon";

export type RGroupDecompositionRequest = {
  documentId: string;
  documentTitle: string;
};

export function RGroupDecompositionDialog({
  request,
  onDismiss,
  onRun,
}: {
  request: RGroupDecompositionRequest | null;
  onDismiss: () => void;
  // An empty core means "work it out": the run takes the scaffold the
  // collection has most of.
  onRun: (documentId: string, core: string) => void;
}) {
  const portalContainer = useAppShellPortalContainer();
  const [core, setCore] = useState("");

  useEffect(() => {
    if (request) setCore("");
  }, [request?.documentId]);

  return (
    <Dialog.Root open={request !== null} onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <Dialog.Portal container={portalContainer}>
        <Dialog.Overlay className="radix-dialog-overlay" />
        <Dialog.Content className="radix-dialog calculated-column-dialog" aria-describedby="rgroup-decomposition-body">
          <div className="radix-dialog-header">
            <Dialog.Title>Decompose R-Groups</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="radix-dialog-close" aria-label="Close R-group decomposition">
                <CloseIcon size={14} />
              </button>
            </Dialog.Close>
          </div>
          <div id="rgroup-decomposition-body" className="radix-dialog-body">
            <p className="calculate-properties-target">
              Splits every molecule of <strong>{request?.documentTitle}</strong> into a shared core and the
              groups hanging off it, one column per position.
            </p>
            <label className="calculated-column-field">
              <span>Core (SMILES or SMARTS, optional)</span>
              <input
                type="text"
                value={core}
                maxLength={400}
                spellCheck={false}
                placeholder="Leave empty to use the collection's most common scaffold"
                onChange={(event) => setCore(event.target.value)}
              />
            </label>
            <div className="calculated-column-help">
              <p className="calculated-column-note">
                Molecules that do not contain the core keep empty cells and are reported when the run finishes.
                The decomposition runs in the managed Python RDKit runtime.
              </p>
            </div>
          </div>
          <div className="radix-dialog-footer calculate-properties-footer">
            <span className="calculate-properties-count">
              {core.trim() ? "Uses the core you entered" : "Uses the most common scaffold"}
            </span>
            <div className="calculate-properties-actions">
              <Dialog.Close asChild>
                <button type="button" className="dock-action">Cancel</button>
              </Dialog.Close>
              <button
                type="button"
                className="dock-action calculate-properties-run"
                onClick={() => {
                  if (!request) return;
                  onRun(request.documentId, core.trim());
                  onDismiss();
                }}
              >
                Decompose
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
