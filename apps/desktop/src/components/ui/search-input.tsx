import { useRef, type ComponentProps } from "react";
import { Button } from "./button";
import { X } from "./app-icons";
import { AnimatedSearchIcon } from "./animated-icons";
import { cn } from "@/lib/utils";
import "./search-input.css";

// Atlas page search: a native text field with an explicit, keyboard-accessible clear action.
export function SearchInput({ value, onValueChange, className, disabled, clearLabel = "Clear search", ...props }: Omit<ComponentProps<"input">, "ref" | "value" | "onChange" | "type"> & {
  clearLabel?: string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return <div data-disabled={disabled || undefined} className={cn("atlas-search-input", className)}>
    <AnimatedSearchIcon />
    <input {...props} disabled={disabled} ref={input} type="text" autoComplete="off" spellCheck={false}
      value={value} onChange={event => onValueChange(event.target.value)}
    />
    {value && <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label={clearLabel} onClick={() => { onValueChange(""); input.current?.focus(); }}><X size={16} aria-hidden /></Button>}
  </div>;
}
