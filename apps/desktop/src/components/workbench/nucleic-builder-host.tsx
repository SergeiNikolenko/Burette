import { lazy, Suspense, useState } from "react";
import { closeWorkbenchDialog, isWorkbenchDialogRequestCurrent, useWorkbenchDialogRequest } from "../../lib/workbench/dialog-store";
import type { ShellActions } from "../types";
import { Dialog, DialogContent } from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import "./workbench-layout.css";

const Body = lazy(() => import("./nucleic-builder").then(module => ({ default: module.NucleicBuilderBody })));

/** Owns only the DNA/RNA builder request; other workbench dialogs keep their existing hosts. */
export function NucleicBuilderDialogHost({ actions }: { actions: ShellActions }) {
  const request = useWorkbenchDialogRequest();
  const [lifetime, setLifetime] = useState({ request, revision: 0 });
  if (lifetime.request !== request) setLifetime({ request, revision: lifetime.revision + 1 });
  const nucleic = request?.kind === "builder" && request.builder === "nucleic" ? request : null;
  const current = () => nucleic !== null && isWorkbenchDialogRequestCurrent(nucleic);
  const close = () => { if (current()) closeWorkbenchDialog(); };
  return <Dialog open={Boolean(nucleic)} onOpenChange={open => { if (!open) close(); }}>
    {nucleic ? <DialogContent aria-describedby={undefined} variant="form" size="wide" className="flex max-h-[88vh] flex-col gap-4 overflow-y-auto overscroll-contain">
      <Suspense fallback={<Spinner aria-label="Opening DNA and RNA builder" />}>
        <Body key={lifetime.revision} actions={actions} document={nucleic.document} isCurrent={current} onDone={close} />
      </Suspense>
    </DialogContent> : null}
  </Dialog>;
}
