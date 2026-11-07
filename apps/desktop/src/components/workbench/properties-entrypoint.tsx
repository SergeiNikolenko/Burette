import { lazy, Suspense, useEffect, useState } from "react";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../types";
import { useLogicalSource } from "../../lib/science-session/state";
import { workbenchSupportsDocument } from "../../lib/workbench/structure";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTrigger } from "../ui/dialog";
import { Spinner } from "../ui/spinner";
const PropertiesDialogBody = lazy(() => import("./properties-dialog").then(module => ({ default: module.PropertiesDialogBody })));

/** Info owns this dialog; replacing the document closes its previous lifetime. */
export function PropertiesToolRow({ document, actions }: { document: ViewerDocument; actions: ShellActions }) {
  useLogicalSource(document.id);
  const [opened, setOpened] = useState<ViewerDocument | null>(null);
  const open = opened === document;
  useEffect(() => setOpened(null), [document]);
  if (!workbenchSupportsDocument(document)) return null;
  return (
    <Dialog open={open} onOpenChange={(value) => setOpened(value ? document : null)}>
      <div className="flex min-w-0 items-center gap-2 py-1" role="listitem">
        <span className="min-w-0 flex-1 truncate px-2 text-sm">Properties</span>
        <DialogTrigger asChild><Button type="button" variant="secondary" size="xs" aria-label="Calculate properties">Calculate</Button></DialogTrigger>
      </div>
      <DialogContent variant="form" size="wide" className="flex max-h-[88vh] flex-col gap-4 overflow-y-auto" aria-describedby={undefined}>
        {open ? <Suspense fallback={<Spinner aria-label="Opening properties" />}><PropertiesDialogBody document={document} actions={actions} onDone={() => setOpened(null)} /></Suspense> : null}
      </DialogContent>
    </Dialog>
  );
}
