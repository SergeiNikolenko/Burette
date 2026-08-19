"use client";

import * as React from "react";
import { Maximize, Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

function IconButton({
  label,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="size-7"
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </Button>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function useZoom() {
  const [scale, setScale] = React.useState(1);
  const zoom = React.useCallback(
    (factor: number) => setScale((s) => clamp(s * factor, 0.1, 5)),
    [],
  );
  const reset = React.useCallback(() => setScale(1), []);
  return { scale, zoom, reset };
}

export function ZoomActions({
  scale,
  zoom,
  reset,
}: {
  scale: number;
  zoom: (factor: number) => void;
  reset: () => void;
}) {
  return (
    <>
      <IconButton label="Zoom out" onClick={() => zoom(1 / 1.2)}>
        <Minus />
      </IconButton>
      <span className="text-muted-foreground w-12 text-center text-xs tabular-nums">
        {Math.round(scale * 100)}%
      </span>
      <IconButton label="Zoom in" onClick={() => zoom(1.2)}>
        <Plus />
      </IconButton>
      <IconButton label="Actual size" onClick={reset}>
        <Maximize />
      </IconButton>
    </>
  );
}
