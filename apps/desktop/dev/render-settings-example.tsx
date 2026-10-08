import { useState } from "react";
import { XyzrenderProperties } from "@/components/xyzrender-properties";
import type { XyzrenderControls } from "@/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function RenderSettingsExample() {
  const [controls, setControls] = useState<XyzrenderControls>({ atomScale: 0.4, bondWidth: 0.08 });
  return <Dialog>
    <DialogTrigger asChild><Button variant="secondary">Rendering settings</Button></DialogTrigger>
    <DialogContent variant="form" size="wide" className="flex flex-col overflow-hidden" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>Rendering settings</DialogTitle></DialogHeader>
      <div className="min-h-0 overflow-y-auto overscroll-contain"><XyzrenderProperties controls={controls} onChange={setControls} /></div>
      <DialogFooter><DialogClose asChild><Button variant="secondary">Done</Button></DialogClose></DialogFooter>
    </DialogContent>
  </Dialog>;
}
