import { cloneElement, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function KetcherToolTooltip({ children, label, shortcut, disabled }: {
  children: ReactElement; label: ReactNode; shortcut?: string; disabled?: boolean;
}) {
  const [container, setContainer] = useState(() => document.fullscreenElement as HTMLElement | null);
  useEffect(() => {
    const update = () => setContainer(document.fullscreenElement as HTMLElement | null);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  if (disabled) return children;
  return <TooltipProvider><Tooltip>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent container={container ?? undefined}>
      <span>{label}</span>{shortcut && <kbd className="ml-2">{shortcut}</kbd>}
    </TooltipContent>
  </Tooltip></TooltipProvider>;
}

// Ketcher writes shortcuts into its titles ("Undo (Mod+Z)"); show them as the
// tooltip's shortcut key instead.
export function splitShortcut(title: string): [string, string | undefined] {
  const match = /^(.+) \(([^()\s]*\+[^()\s]*)\)$/u.exec(title);
  return match ? [match[1], match[2]] : [title, undefined];
}

// Stands in for MUI's Tooltip in the macromolecules bundle, which also receives
// the native titles the build rewrites (vite/ketcher-ui.ts). Like MUI, it passes
// other props to its child: MUI Tabs clones tab props through it.
export function KetcherMacroTooltip({ title, children, classes: _classes, placement: _placement, arrow: _arrow, ...props }: {
  title?: ReactNode; children: ReactElement; classes?: unknown; placement?: string; arrow?: boolean; [prop: string]: unknown;
}) {
  const child = Object.keys(props).length ? cloneElement(children, props) : children;
  if (title == null || title === "" || title === false) return child;
  const [label, shortcut] = typeof title === "string" ? splitShortcut(title) : [title, undefined];
  return <KetcherToolTooltip label={label} shortcut={shortcut}>{child}</KetcherToolTooltip>;
}
