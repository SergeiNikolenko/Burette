import { lazy, Suspense } from "react";
import { closeWorkbenchDialog, useWorkbenchDialogRequest } from "../../lib/workbench/dialog-store";
import type { ShellActions } from "../types";
import { Dialog, DialogContent } from "../ui/dialog";
import { Spinner } from "../ui/spinner";
const Body = lazy(() => import("./properties-dialog").then(module => ({ default: module.PropertiesDialogBody })));

/** Properties opened from outside Info, such as the 3D context menu. */
export function PropertiesDialogHost({ actions }: { actions: ShellActions }) {
  const request = useWorkbenchDialogRequest();
  const properties = request?.kind === "properties" && request.document ? request : null;
  return (
    <Dialog open={Boolean(properties)} onOpenChange={(open) => { if (!open && properties) closeWorkbenchDialog(); }}>
      {properties ? <DialogContent variant="form" size="wide" className="flex max-h-[88vh] flex-col gap-4 overflow-y-auto" aria-describedby={undefined}>
        <Suspense fallback={<Spinner aria-label="Opening properties" />}>
          <Body key={properties.document!.id} document={properties.document!} actions={actions} onDone={closeWorkbenchDialog} />
        </Suspense>
      </DialogContent> : null}
    </Dialog>
  );
}
