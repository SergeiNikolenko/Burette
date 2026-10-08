import { Children, cloneElement, isValidElement, useId, type AriaAttributes, type ComponentProps } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

// A whole labelled field is the hint target, including keyboard focus entering
// its control. The portal keeps scientific guidance out of clipped accordions.
export function TrajectorySetting({ hint, children, ...props }: ComponentProps<"label"> & { hint: string }) {
  const descriptionId = useId();
  return <Tooltip>
    <TooltipTrigger asChild><label {...props}>{Children.map(children, child => (
      isValidElement<AriaAttributes>(child) && child.type !== "span"
        ? cloneElement(child, { "aria-describedby": [child.props["aria-describedby"], descriptionId].filter(Boolean).join(" ") })
        : child
    ))}</label></TooltipTrigger>
    <span id={descriptionId} hidden>{hint}</span>
    <TooltipContent>{hint}</TooltipContent>
  </Tooltip>;
}
