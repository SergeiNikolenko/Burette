import { type ComponentProps } from "react";
import { Group, Panel, Separator, type SeparatorProps } from "react-resizable-panels";

// Thin wrapper over react-resizable-panels v4, styled through the app's own CSS
// (.resizable-handle / .resizable-handle-grip) to match the existing shell look
// instead of the default shadcn Tailwind classes.
//
// Default to a generous hit target so the divider is easy to grab (avoids the
// "doesn't drag on the first try" feel of the thin 1px line). Callers may still
// override resizeTargetMinimumSize.
export function ResizablePanelGroup({
  resizeTargetMinimumSize = { coarse: 30, fine: 14 },
  ...props
}: ComponentProps<typeof Group>) {
  return <Group resizeTargetMinimumSize={resizeTargetMinimumSize} {...props} />;
}
export const ResizablePanel = Panel;
export type { PanelImperativeHandle, GroupImperativeHandle, Layout } from "react-resizable-panels";

export function ResizableHandle({
  withHandle,
  className,
  children,
  ...props
}: SeparatorProps & { withHandle?: boolean }) {
  return (
    <Separator className={["resizable-handle", className].filter(Boolean).join(" ")} {...props}>
      {withHandle ? <span className="resizable-handle-grip" aria-hidden="true" /> : null}
      {children}
    </Separator>
  );
}
