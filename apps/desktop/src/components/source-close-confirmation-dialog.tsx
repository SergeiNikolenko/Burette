import { useRef } from "react";
import type { SourceCloseConfirmationRequest } from "../hooks/use-source-close-confirmation";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog";

export function SourceCloseConfirmationDialog({ request }: { request: SourceCloseConfirmationRequest | null }) {
  return request ? <Confirmation key={request.id} request={request} /> : null;
}

function Confirmation({ request }: { request: SourceCloseConfirmationRequest }) {
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  return <AlertDialog open onOpenChange={open => { if (!open && !request.busy) request.cancel(); }}>
    <AlertDialogContent aria-busy={request.busy} onEscapeKeyDown={event => { if (request.busy) event.preventDefault(); }}
      onCloseAutoFocus={event => {
        event.preventDefault();
        const target = returnFocus.current?.isConnected ? returnFocus.current
          : document.querySelector<HTMLElement>('.tab-strip [role="tab"][aria-selected="true"]');
        target?.focus({ preventScroll: true });
      }}>
      <AlertDialogHeader>
        <AlertDialogTitle>Unsaved Source Changes</AlertDialogTitle>
        <AlertDialogDescription>{request.message}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={request.busy} onClick={request.cancel}>Cancel</AlertDialogCancel>
        <AlertDialogAction variant="destructive" disabled={request.busy} onClick={request.discard}>Discard</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
