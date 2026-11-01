import { lazy, Suspense, useState } from "react";
import { closeWorkbenchDialog, isWorkbenchDialogRequestCurrent, useWorkbenchDialogRequest } from "../../lib/workbench/dialog-store";
import type { ShellActions } from "../types";
import { Dialog, DialogContent } from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import "./workbench-layout.css";
const Body = lazy(() => import("./polymer-builder").then(module => ({ default: module.PolymerBuilderBody })));

export function PolymerBuilderDialogHost({ actions }: { actions: Pick<ShellActions, "openStructureRecords"> }) {
  const request = useWorkbenchDialogRequest(), [lifetime, setLifetime] = useState({ request, revision: 0 });
  if (lifetime.request !== request) setLifetime({ request, revision: lifetime.revision + 1 });
  const polymer = request?.kind === "builder" && request.builder === "polymer" ? request : null;
  const current = () => polymer !== null && isWorkbenchDialogRequestCurrent(polymer), close = () => { if (current()) closeWorkbenchDialog(); };
  return <Dialog modal={false} open={Boolean(polymer)} onOpenChange={open => { if (!open) close(); }}>
    {polymer ? <DialogContent aria-describedby={undefined} variant="form" size="compact" className="left-auto right-4 top-16 w-80 max-h-[calc(100dvh-5rem)] translate-x-0 translate-y-0 flex flex-col gap-3 overscroll-contain"
      onInteractOutside={event => event.preventDefault()}>
      <Suspense fallback={<Spinner aria-label="Opening polymer builder" />}><Body key={lifetime.revision} document={polymer.document} actions={actions} isCurrent={current} onDone={close} /></Suspense>
    </DialogContent> : null}
  </Dialog>;
}
