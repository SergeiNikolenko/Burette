import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown } from "./app-icons";

// Atlas CollapsibleSection (Ci): native disclosure keeps its body mounted.
// Inspector data remains feature-owned; this component only owns disclosure.
export function CollapsibleSection({ title, detail, open, defaultOpen = true, onOpenChange, className, children }: {
  title: string;
  detail?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}) {
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const expanded = open ?? localOpen;
  return <details
    data-slot="collapsible-section"
    className={cn("group/section flex min-w-0 flex-col gap-4 [--sectioned-page-leading-inset:var(--detail-page-inline-inset,0px)]", className)}
    open={expanded}
    onToggle={event => {
      const next = event.currentTarget.open;
      if (next === expanded) return;
      if (open === undefined) setLocalOpen(next);
      onOpenChange?.(next);
    }}
  >
    <summary
      data-slot="section-header"
      className="flex cursor-(--cursor-interaction) list-none items-center justify-between gap-3 border-b border-(--color-border-subtle) pe-0.5 pb-2 text-(--color-text) [padding-inline-start:var(--sectioned-page-leading-inset,0.5rem)] marker:hidden [&::-webkit-details-marker]:hidden focus-visible:outline-2 focus-visible:outline-(--color-ring) focus-visible:outline-offset-2"
    >
      <span className="flex min-h-7 min-w-0 items-center gap-1.5 text-lg leading-6 font-medium">
        <span className="truncate">{title}</span>
        <ChevronDown aria-hidden className="size-3.5 shrink-0 -rotate-90 transition-transform group-open/section:rotate-0 motion-reduce:transition-none" />
        {detail ? <span className="truncate text-(--color-text-tertiary)">{detail}</span> : null}
      </span>
    </summary>
    <div className="flex min-w-0 flex-col gap-1 px-[var(--detail-page-inline-inset,0px)]">{children}</div>
  </details>;
}
