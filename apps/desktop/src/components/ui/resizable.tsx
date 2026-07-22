import { Group, Panel, Separator, type SeparatorProps } from "react-resizable-panels";

// Thin wrapper over react-resizable-panels v4, styled through the app's own CSS
// (.resizable-handle / .resizable-handle-grip) to match the existing shell look
// instead of the default shadcn Tailwind classes.
export const ResizablePanelGroup = Group;
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
