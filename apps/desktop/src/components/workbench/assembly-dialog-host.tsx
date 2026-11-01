import { lazy, Suspense, useState } from "react";
import { closeWorkbenchDialog, isWorkbenchDialogRequestCurrent, useWorkbenchDialogRequest } from "../../lib/workbench/dialog-store";
import type { ShellActions } from "../types";
import { Dialog, DialogContent } from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import "./workbench-layout.css";

const Body = lazy(() => import("./assembly-dialog").then(module => ({ default: module.AssemblyDialogBody })));
/** Each assembly request has its own lifetime, including same-document replacements. */
export function AssemblyDialogHost({ actions }: { actions: Pick<ShellActions, "openStructureRecords"> }) {
  const request = useWorkbenchDialogRequest();
  const [lifetime, setLifetime] = useState({ request, revision: 0 });
  if (lifetime.request !== request) setLifetime({ request, revision: lifetime.revision + 1 });
  const assembly = request?.kind === "assembly" ? request : null;
  const current = () => assembly !== null && isWorkbenchDialogRequestCurrent(assembly);
  const close = () => { if (current()) closeWorkbenchDialog(); };
  return <Dialog open={Boolean(assembly)} onOpenChange={open => { if (!open) close(); }}>
    {assembly ? <DialogContent variant="form" size="wide" className="flex max-h-[88vh] flex-col gap-4 overflow-y-auto overscroll-contain">
      <Suspense fallback={<Spinner aria-label="Opening biological assembly" />}>
        <Body key={lifetime.revision} document={assembly.document} actions={actions} isCurrent={current} onDone={close} />
      </Suspense>
    </DialogContent> : null}
  </Dialog>;
}
