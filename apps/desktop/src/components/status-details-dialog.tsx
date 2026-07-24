import { Dialog } from "radix-ui";

import type { StatusDetailsRequest } from "../hooks/use-app-status";
import { useAppShellPortalContainer } from "./ui/portal-container";
import { CloseIcon } from "./close-icon";

export function StatusDetailsDialog({
  request,
  onDismiss,
}: {
  request: StatusDetailsRequest | null;
  onDismiss: () => void;
}) {
  const portalContainer = useAppShellPortalContainer();

  return (
    <Dialog.Root
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <Dialog.Portal container={portalContainer}>
        <Dialog.Overlay className="radix-dialog-overlay" />
        <Dialog.Content className="radix-dialog" aria-describedby="status-details-body">
          <div className="radix-dialog-header">
            <Dialog.Title>{request?.kind === "error" ? "Issue details" : "Status details"}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="radix-dialog-close" aria-label="Close details">
                <CloseIcon size={14} />
              </button>
            </Dialog.Close>
          </div>
          <div id="status-details-body" className="radix-dialog-body">
            <ul>
              {(request?.details ?? []).map((detail, index) => (
                <li key={`${index}:${detail}`}>{detail}</li>
              ))}
            </ul>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
