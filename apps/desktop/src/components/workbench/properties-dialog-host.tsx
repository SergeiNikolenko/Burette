import { closeWorkbenchDialog, useWorkbenchDialogRequest } from "../../lib/workbench/dialog-store";
import type { ShellActions } from "../types";
import { Dialog, DialogContent } from "../ui/dialog";
import { PropertiesDialogBody } from "./properties-dialog";

/** Properties opened from outside Info, such as the 3D context menu. */
export function PropertiesDialogHost({ actions }: { actions: ShellActions }) {
  const request = useWorkbenchDialogRequest();
  const properties = request?.kind === "properties" && request.document ? request : null;
  return (
    <Dialog open={Boolean(properties)} onOpenChange={(open) => { if (!open && properties) closeWorkbenchDialog(); }}>
      {properties ? <DialogContent variant="form" size="wide" className="flex max-h-[88vh] flex-col gap-4 overflow-y-auto" aria-describedby={undefined}>
        <PropertiesDialogBody key={properties.document!.id} document={properties.document!} actions={actions} onDone={closeWorkbenchDialog} />
      </DialogContent> : null}
    </Dialog>
  );
}
