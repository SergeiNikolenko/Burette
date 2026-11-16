import { lazy, Suspense } from "react";
import { closeWorkbenchDialog, isWorkbenchDialogRequestCurrent, useWorkbenchDialogRequest } from "../../lib/workbench/dialog-store";
import { Dialog, DialogContent } from "../ui/dialog";
import { Spinner } from "../ui/spinner";
const Body = lazy(() => import("./measurement-coordinate-dialog").then(module => ({ default: module.MeasurementCoordinateDialogBody })));

/** Opened from a 3D measurement; owns one request until it is applied, dismissed or replaced. */
export function MeasurementCoordinateDialogHost() {
  const request = useWorkbenchDialogRequest();
  const measurement = request?.kind === "measurement" && request.document && request.measurement ? request : null;
  const close = () => { if (measurement && isWorkbenchDialogRequestCurrent(measurement)) closeWorkbenchDialog(); };
  return <Dialog open={Boolean(measurement)} onOpenChange={open => { if (!open) close(); }}>
    {measurement ? <DialogContent variant="form" size="compact" className="flex flex-col gap-4" aria-describedby={undefined}>
      <Suspense fallback={<Spinner aria-label="Opening measurement" />}>
        {/* The request object is the lifetime: a same-measurement reopen starts fresh. */}
        <Body key={measurement.measurement!.requestId} document={measurement.document!}
          request={measurement.measurement!} isCurrent={() => isWorkbenchDialogRequestCurrent(measurement)} onDone={close} />
      </Suspense>
    </DialogContent> : null}
  </Dialog>;
}
