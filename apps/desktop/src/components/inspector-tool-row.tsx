import { useState, type ReactNode } from "react";
import { Button } from "./ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { Spinner } from "./ui/spinner";
import { History } from "./ui/app-icons";

export function InspectorToolRow({
  name, detail, detailTitle, state, primaryLabel, primaryDisabled,
  onPrimary, inputLabel, onHistory, runLabel = primaryLabel, onRun = onPrimary, children,
}: {
  name: string;
  detail: string;
  detailTitle?: string;
  state: "ready" | "running" | "missing";
  primaryLabel: string;
  primaryDisabled?: boolean;
  onPrimary: () => void;
  inputLabel: string;
  onHistory: () => void;
  runLabel?: string;
  onRun?: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const hint = detailTitle ?? detail;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="flex min-w-0 items-center gap-2 py-1" data-state={state} role="listitem">
        <TooltipProvider><Tooltip><TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="min-w-0 flex-1 justify-start text-left text-(--color-text)"
              aria-label={`${name} settings`} aria-description={hint}>
              <span className="min-w-0 truncate text-sm">{name}</span>
            </Button>
          </DialogTrigger>
        </TooltipTrigger><TooltipContent>{hint}</TooltipContent></Tooltip></TooltipProvider>
        {state === "running" ? <span role="status" className="flex items-center gap-1 text-xs text-(--color-text-secondary)"><Spinner aria-hidden className="size-3" />Running</span> : null}
        <Button type="button" variant="secondary" size="xs" disabled={primaryDisabled} onClick={onPrimary}>{primaryLabel}</Button>
      </div>
      <DialogContent variant="form" size="wide" className="flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription className="truncate" title={inputLabel}>{inputLabel}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto overscroll-contain">{children}</div>
        <DialogFooter className="shrink-0">
          <Button type="button" variant="ghost" size="xs" className="mr-auto" onClick={() => { setOpen(false); onHistory(); }}><History aria-hidden />Run history</Button>
          <DialogClose asChild><Button type="button" variant="secondary">Done</Button></DialogClose>
          <Button type="button" disabled={primaryDisabled} onClick={() => { onRun(); setOpen(false); }}>{runLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
