"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";

export type ViewerHeaderOutletName = "titleGroup" | "controls";

type ViewerHeaderOutletContextValue = {
  outlets: Partial<Record<ViewerHeaderOutletName, HTMLElement | null>>;
  registerContent?: (name: ViewerHeaderOutletName) => () => void;
};

const ViewerHeaderOutletContext =
  createContext<ViewerHeaderOutletContextValue | null>(null);

export function useViewerHeaderOutletAvailable(name: ViewerHeaderOutletName) {
  const context = useContext(ViewerHeaderOutletContext);
  return Boolean(context?.outlets[name]);
}

export function useViewerHeaderOutletsAvailable(
  names: ViewerHeaderOutletName[] = ["titleGroup", "controls"],
) {
  const context = useContext(ViewerHeaderOutletContext);
  if (!context) return false;
  return names.every((name) => Boolean(context.outlets[name]));
}

export function useViewerHeaderOutlets() {
  return useViewerHeaderOutletsAvailable();
}

export function ViewerHeaderOutlet({
  children,
  name,
}: {
  children: ReactNode;
  name: ViewerHeaderOutletName;
}) {
  const context = useContext(ViewerHeaderOutletContext);
  const target = context?.outlets[name] ?? null;
  const outletMountKey = target ? `viewer-header-outlet:${name}` : null;

  useKeyedMountEffect(outletMountKey, () =>
    target ? context?.registerContent?.(name) : undefined,
  );

  if (!target) return null;

  return createPortal(children, target);
}

export function ViewerHeaderOutletStart({ children }: { children: ReactNode }) {
  const hasHeaderOutlets = useViewerHeaderOutlets();
  if (!hasHeaderOutlets) return <>{children}</>;
  return <ViewerHeaderOutlet name="titleGroup">{children}</ViewerHeaderOutlet>;
}

export function ViewerHeaderOutletEnd({ children }: { children: ReactNode }) {
  const hasHeaderOutlets = useViewerHeaderOutlets();
  if (!hasHeaderOutlets) return <>{children}</>;
  return <ViewerHeaderOutlet name="controls">{children}</ViewerHeaderOutlet>;
}

export function ViewerHeaderOutletProvider({
  children,
  outlets,
  registerContent,
}: {
  children: ReactNode;
  outlets: Partial<Record<ViewerHeaderOutletName, HTMLElement | null>>;
  registerContent?: (name: ViewerHeaderOutletName) => () => void;
}) {
  const value = useMemo(
    () => ({ outlets, registerContent }),
    [outlets, registerContent],
  );

  return (
    <ViewerHeaderOutletContext.Provider value={value}>
      {children}
    </ViewerHeaderOutletContext.Provider>
  );
}
