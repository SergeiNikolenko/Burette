import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { StatusDetailsRequest } from "../hooks/use-app-status";

export function StatusDetailsDialog({
  request,
  onDismiss,
}: {
  request: StatusDetailsRequest | null;
  onDismiss: () => void;
}) {
  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <DialogContent aria-describedby="status-details-body">
        <DialogHeader>
          <DialogTitle>{request?.kind === "error" ? "Issue details" : "Status details"}</DialogTitle>
          <DialogDescription className="sr-only">
            Details for the current workspace status message.
          </DialogDescription>
        </DialogHeader>
        <ul id="status-details-body" className="grid max-h-[50vh] gap-1.5 overflow-auto text-sm">
          {(request?.details ?? []).map((detail, index) => (
            <li key={`${index}:${detail}`} className="break-words text-muted-foreground">
              {detail}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
