import { useRef, type ComponentProps } from "react";
import { Input } from "./input";
import { Button } from "./button";
import { X } from "./app-icons";
import { AnimatedSearchIcon } from "./animated-icons";
import { cn } from "@/lib/utils";

// Atlas page search: a native text field with an explicit, keyboard-accessible clear action.
export function SearchInput({ value, onValueChange, className, disabled, clearLabel = "Clear search", ...props }: Omit<ComponentProps<typeof Input>, "ref" | "value" | "onChange" | "variant" | "type"> & {
  clearLabel?: string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return <div data-disabled={disabled || undefined} className={cn("flex h-8 min-w-0 items-center gap-2 rounded-full border border-(--color-border-primary-outline) bg-(--color-background-page-search) px-2.5 focus-within:ring-2 focus-within:ring-(--color-ring) data-disabled:opacity-50", className)}>
    <AnimatedSearchIcon className="size-4 shrink-0 text-(--color-text-secondary)" />
    <Input {...props} disabled={disabled} ref={input} type="text" variant="transparent" autoComplete="off" spellCheck={false}
      value={value} onChange={event => onValueChange(event.target.value)}
      className="h-full flex-1 rounded-none border-0 bg-transparent p-0 text-base leading-[18px] focus:border-transparent focus:ring-0" />
    {value && <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label={clearLabel} onClick={() => { onValueChange(""); input.current?.focus(); }}><X size={16} aria-hidden /></Button>}
  </div>;
}
