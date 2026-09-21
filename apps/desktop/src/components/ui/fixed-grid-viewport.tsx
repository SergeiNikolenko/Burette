"use client";

import * as React from "react";

export interface FixedGridViewportRefs {
  scrollElement: HTMLDivElement | null;
}

export interface FixedGridViewportProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  scrollRef: React.Ref<HTMLDivElement>;
  dataSlot: string;
  children: React.ReactNode;
}

export function FixedGridViewport({
  scrollRef,
  dataSlot,
  className = "absolute inset-0 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
  children,
  ...props
}: FixedGridViewportProps) {
  return (
    <div ref={scrollRef} data-slot={dataSlot} className={className} {...props}>
      {children}
    </div>
  );
}
