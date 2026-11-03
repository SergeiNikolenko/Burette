import { lazy, Suspense, useState } from "react";
import { closeWorkbenchDialog, isWorkbenchDialogRequestCurrent, useWorkbenchDialogRequest } from "../../lib/workbench/dialog-store";
import type { ShellActions } from "../types";
import { Dialog, DialogContent } from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import "./workbench-layout.css";

const Body = lazy(() => import("./metal-complex-builder").then(module => ({ default: module.MetalComplexBuilderBody })));

/** Owns only the metal-complex request (`{ kind: "builder", builder: "metal" }`); the complex always opens as a new document. */
export function MetalComplexBuilderDialogHost({ actions }: { actions: Pick<ShellActions, "openStructureRecords"> }) {
  const request = useWorkbenchDialogRequest();
  const [lifetime, setLifetime] = useState({ request, revision: 0 });
  if (lifetime.request !== request) setLifetime({ request, revision: lifetime.revision + 1 });
  const metal = request?.kind === "builder" && request.builder === "metal" ? request : null;
  const current = () => metal !== null && isWorkbenchDialogRequestCurrent(metal);
  const close = () => { if (current()) closeWorkbenchDialog(); };
  return <Dialog open={Boolean(metal)} onOpenChange={open => { if (!open) close(); }}>
    {metal ? <DialogContent aria-describedby={undefined} variant="form" size="wide" className="flex max-h-[88vh] flex-col gap-4 overflow-y-auto overscroll-contain">
      <Suspense fallback={<Spinner aria-label="Opening metal complex builder" />}>
        <Body key={lifetime.revision} actions={actions} isCurrent={current} onDone={close} />
      </Suspense>
    </DialogContent> : null}
  </Dialog>;
}
