"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export function TextCodeViewerFrame({
  bare,
  bareClassName,
  children,
  className,
  dataSlot,
  framedClassName,
}: {
  bare?: boolean;
  bareClassName: string;
  children: React.ReactNode;
  className?: string;
  dataSlot: string;
  framedClassName: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden",
        bare ? bareClassName : framedClassName,
        className,
      )}
      data-slot={dataSlot}
    >
      {children}
    </div>
  );
}
