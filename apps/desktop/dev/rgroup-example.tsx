import { useState } from "react";
import { RGroupDecompositionDialog } from "@/components/rgroup-decomposition-dialog";
import { RGroupPreviewResults } from "@/components/rgroup-preview";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import result from "./rgroup-example-data.json";

// Recorded output of the shipped R-group runner for eight monosubstituted benzenes.
// The preview uses real molecular drawing; these examples never write collection columns.
const request = { documentId: "rgroup-example", documentTitle: "Series" };
export function RGroupExample() {
  const [open, setOpen] = useState<"form" | "preview" | null>(null);
  return <section aria-label="R-group examples" className="flex gap-2">
    <Button variant="secondary" onClick={() => setOpen("form")}>Decompose R-groups</Button>
    <Button variant="secondary" onClick={() => setOpen("preview")}>R-group preview</Button>
    <RGroupDecompositionDialog request={open === "form" ? request : null} onDismiss={() => setOpen(null)} onRun={async () => {}} />
    <Dialog open={open === "preview"} onOpenChange={value => { if (!value) setOpen(null); }}>
      <DialogContent variant="form" size="xwide" className="min-w-0 overscroll-contain">
        <DialogHeader>
          <DialogTitle>Decompose R-groups</DialogTitle>
          <DialogDescription className="sr-only">Eight molecules with a benzene core.</DialogDescription>
        </DialogHeader>
        <RGroupPreviewResults result={result} total={8} />
      </DialogContent>
    </Dialog>
  </section>;
}
