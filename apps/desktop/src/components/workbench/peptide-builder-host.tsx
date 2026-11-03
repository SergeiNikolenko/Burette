import { lazy, Suspense, useState } from "react";
import { closeWorkbenchDialog, isWorkbenchDialogRequestCurrent, useWorkbenchDialogRequest } from "../../lib/workbench/dialog-store";
import type { ShellActions } from "../types";
import { Dialog, DialogContent } from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import "./workbench-layout.css";

const Body = lazy(() => import("./peptide-builder").then(module => ({ default: module.PeptideBuilderBody })));

/** Owns only the peptide request; other workbench dialogs keep their existing hosts. */
export function PeptideBuilderDialogHost({ actions }: { actions: ShellActions }) {
  const request = useWorkbenchDialogRequest();
  const [lifetime, setLifetime] = useState({ request, revision: 0 });
  if (lifetime.request !== request) setLifetime({ request, revision: lifetime.revision + 1 });
  const peptide = request?.kind === "builder" && request.builder === "peptide" ? request : null;
  const current = () => peptide !== null && isWorkbenchDialogRequestCurrent(peptide);
  const close = () => { if (current()) closeWorkbenchDialog(); };
  return <Dialog open={Boolean(peptide)} onOpenChange={open => { if (!open) close(); }}>
    {peptide ? <DialogContent aria-describedby={undefined} variant="form" size="wide" className="flex max-h-[88vh] flex-col gap-4 overflow-y-auto overscroll-contain">
      <Suspense fallback={<Spinner aria-label="Opening peptide builder" />}>
        <Body key={lifetime.revision} actions={actions} document={peptide.document} isCurrent={current} onDone={close} />
      </Suspense>
    </DialogContent> : null}
  </Dialog>;
}
