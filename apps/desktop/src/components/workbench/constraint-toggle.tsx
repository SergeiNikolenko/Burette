import { Pin, PinFilled } from "../ui/app-icons";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";

/**
 * A Geometry row's freeze or fixed-coordinate pin. `unavailable` says why this one cannot be
 * held; the pin is then disabled and its tooltip gives that reason.
 */
export function ConstraintToggle({ label, active, disabled, unavailable, onToggle }: {
  label: string; active: boolean; disabled: boolean; unavailable?: string | null; onToggle: () => void;
}) {
  const button = (
    <Button type="button" variant="ghost" size="icon-2xs" className="geometry-constraint" data-active={active || undefined}
      aria-label={label} aria-pressed={active} disabled={disabled || Boolean(unavailable)} onClick={(event) => { event.stopPropagation(); onToggle(); }}>
      {active ? <PinFilled aria-hidden /> : <Pin aria-hidden />}
    </Button>
  );
  return (
    <TooltipProvider><Tooltip><TooltipTrigger asChild>
      {/* A disabled button receives no pointer events; its wrapper shows the reason. */}
      {unavailable ? <span className="geometry-constraint-reason">{button}</span> : button}
    </TooltipTrigger><TooltipContent>{unavailable ?? (active ? `${label}: on` : label)}</TooltipContent></Tooltip></TooltipProvider>
  );
}
