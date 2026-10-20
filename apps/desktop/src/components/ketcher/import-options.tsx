import type { ComponentProps, ReactNode, Ref } from "react";
import { Button } from "@/components/ui/button";
import { Clipboard, FileImage, FolderOpen } from "@/components/ui/app-icons";
import "./chemical-surfaces.css";

export function KetcherImportOptions({ onPaste, file, image }: { onPaste: () => void; file: ReactNode; image: ReactNode }) {
  return <div className="ketcher-import-options flex flex-col gap-1">
    <Button type="button" variant="ghost" className="justify-start" onClick={onPaste} data-testid="paste-from-clipboard-button">
      <Clipboard className="size-4" aria-hidden="true" />Paste
    </Button>
    {file}{image}
  </div>;
}

// The unchanged native useDropzone controller supplies every event/ref and
// accepted/rejected-file callback. Button clicks bubble to that same root;
// native input clicks stop propagation, so the picker opens exactly once.
export function KetcherImportDropzone({ rootProps, inputProps, buttonLabel, disabled, active, testId, image }: {
  rootProps: ComponentProps<"div"> & { ref?: Ref<HTMLDivElement> };
  inputProps: ComponentProps<"input">; buttonLabel: string; disabled?: boolean; active: boolean; testId: string; image: boolean;
}) {
  const label = buttonLabel.replace("Open from", "Open");
  const Icon = image ? FileImage : FolderOpen;
  return <div {...rootProps} data-testid={testId} aria-disabled={disabled || undefined}
    className={`rounded-lg ${active ? "outline outline-2 outline-ring bg-muted" : ""}`}>
    <input {...inputProps} name={testId} aria-label={label} />
    <Button type="button" variant="ghost" className="w-full justify-start" disabled={disabled}>
      <Icon className="size-4" aria-hidden="true" />{active ? (image ? "Drop image" : "Drop file") : label}
    </Button>
  </div>;
}
