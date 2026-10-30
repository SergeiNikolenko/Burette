import { useState } from "react";
import { closeWorkbenchDialog, useWorkbenchDialogRequest } from "../../lib/workbench/dialog-store";
import type { ShellActions } from "../types";
import { Dialog, DialogContent } from "../ui/dialog";
import { InputExportDialogBody } from "./input-export-dialog";
import "./workbench-layout.css";
import "./input-export.css";

/** Owns input requests until the full WorkbenchDialogs host replaces it; never mount both. */
export function InputExportDialogHost({ actions }: { actions: ShellActions }) {
  const request = useWorkbenchDialogRequest();
  const [lifetime, setLifetime] = useState({ request, revision: 0 });
  // Another request, including the same document with new edited atoms, starts fresh form state.
  if (lifetime.request !== request) setLifetime({ request, revision: lifetime.revision + 1 });
  const input = request?.kind === "input" && request.document ? request : null;
  return (
    <Dialog open={Boolean(input)} onOpenChange={(open) => { if (!open && input) closeWorkbenchDialog(); }}>
      {input ? <DialogContent variant="form" size="wide" className="flex max-h-[88vh] flex-col gap-4 overflow-y-auto">
        <InputExportDialogBody key={lifetime.revision} document={input.document!} actions={actions} atoms={input.atoms} constraints={input.constraints} />
      </DialogContent> : null}
    </Dialog>
  );
}
