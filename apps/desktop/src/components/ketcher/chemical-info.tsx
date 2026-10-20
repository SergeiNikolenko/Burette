import { forwardRef, type ComponentProps } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import "./chemical-surfaces.css";

// Native chemistry computes the anchor and supplies the real StructRender or
// escaped chemical label. Shared tooltip positioning owns viewport collisions;
// the zero-size anchor remains in the original canvas coordinate space.
export const KetcherChemicalInfoSurface = forwardRef<HTMLDivElement, ComponentProps<"div">>(function KetcherChemicalInfoSurface({
  style, className: _nativeClassName, children, ...props
}, ref) {
  return <TooltipProvider><Tooltip open>
    <TooltipTrigger asChild><span aria-hidden="true" tabIndex={-1} style={{ position: "absolute", left: style?.left, top: style?.top, width: 1, height: 1, pointerEvents: "none" }} /></TooltipTrigger>
    <TooltipContent {...props} ref={ref} side="bottom" align="start" sideOffset={0}
      container={document.fullscreenElement as HTMLElement | null ?? undefined}
      className="ketcher-chemical-info pointer-events-none max-w-[300px] break-words">
      {children}
    </TooltipContent>
  </Tooltip></TooltipProvider>;
});
