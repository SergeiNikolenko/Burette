import { useState, type ReactNode } from "react";
import { Button } from "./ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "./ui/item";
import { Separator } from "./ui/separator";
import { History, Play } from "./ui/app-icons";

export function InspectorToolRow({
  name, version, detail, detailTitle, state, primaryLabel, primaryDisabled,
  onPrimary, inputLabel, onHistory, runLabel = primaryLabel, onRun = onPrimary, children,
}: {
  name: string;
  version?: string | null;
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
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Item variant="outline" size="xs" className="relative hover:bg-muted/50 focus-within:bg-muted/50" data-state={state} role="listitem">
        <DialogTrigger asChild>
          <button type="button" className="absolute inset-0 rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${name} settings`} title={`Open ${name} settings`} />
        </DialogTrigger>
        <ItemContent className="pointer-events-none min-w-0">
          <ItemTitle>
            {name}
            {version ? <span className="text-xs font-normal text-muted-foreground">{version}</span> : null}
          </ItemTitle>
          <ItemDescription title={detailTitle ?? detail}>{detail}</ItemDescription>
        </ItemContent>
        <ItemActions className="relative">
          <Button type="button" variant="secondary" size="xs" disabled={primaryDisabled} onClick={onPrimary}>
            {primaryLabel}
          </Button>
        </ItemActions>
      </Item>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="shrink-0 px-5 py-4 pr-12">
          <DialogTitle>{name} settings</DialogTitle>
          <DialogDescription className="truncate" title={inputLabel}>{inputLabel}</DialogDescription>
        </DialogHeader>
        <Separator />
        <div className="min-h-0 overflow-y-auto p-5">{children}</div>
        <Separator />
        <DialogFooter className="m-0 shrink-0 flex-row flex-wrap items-center border-0 p-4">
          <Button variant="ghost" size="sm" className="mr-auto" onClick={() => { setOpen(false); onHistory(); }}><History data-icon="inline-start" />Run history</Button>
          <DialogClose asChild><Button variant="outline" size="sm">Done</Button></DialogClose>
          <Button size="sm" disabled={primaryDisabled} onClick={() => { onRun(); setOpen(false); }}><Play data-icon="inline-start" />{runLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
