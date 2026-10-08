import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";

export function OverlayExamples() {
  const [name, setName] = useState("Series");
  const [prefix, setPrefix] = useState("Ligand");
  return <>
    <Dialog>
      <DialogTrigger asChild><Button variant="secondary">Rename series</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Rename series</DialogTitle><DialogDescription className="sr-only">Name the current collection.</DialogDescription></DialogHeader>
        <Input aria-label="Series name" value={name} onChange={e => setName(e.target.value)} />
        <Popover>
          <PopoverTrigger asChild><Button variant="secondary">Display options</Button></PopoverTrigger>
          <PopoverContent size="large" aria-label="Display options">
            <div className="flex flex-col gap-3 p-2">
              <PopoverTitle>Labels</PopoverTitle>
              <label className="text-sm">Prefix<Input value={prefix} onChange={e => setPrefix(e.target.value)} /></label>
            </div>
          </PopoverContent>
        </Popover>
        <DialogFooter><DialogClose asChild><Button variant="secondary">Cancel</Button></DialogClose><DialogClose asChild><Button>Save</Button></DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog>
      <DialogTrigger asChild><Button variant="secondary">New collection</Button></DialogTrigger>
      <DialogContent variant="form" size="compact">
        <DialogHeader><DialogTitle>New collection</DialogTitle><DialogDescription className="sr-only">Choose a name for the collection.</DialogDescription></DialogHeader>
        <Input aria-label="Collection name" placeholder="Collection name" />
        <DialogFooter><DialogClose asChild><Button variant="secondary">Cancel</Button></DialogClose><DialogClose asChild><Button>Create</Button></DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>
    <Popover>
      <PopoverTrigger asChild><Button variant="secondary">Column options</Button></PopoverTrigger>
      <PopoverContent side="right" align="start" animation="slide-from-left" aria-label="Column options">
        <div className="flex flex-col gap-3 p-2"><PopoverTitle>Column label</PopoverTitle><Input aria-label="Column label" defaultValue="Mass" /></div>
      </PopoverContent>
    </Popover>
  </>;
}
