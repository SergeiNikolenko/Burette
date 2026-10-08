import * as React from "react"

import { cn } from "@/lib/utils"
import { HugeiconsIcon } from "@hugeicons/react"
import { ChevronUpDown as UnfoldMoreIcon } from "@/components/ui/app-icon-data";
import { isTauriRuntime } from "@/lib/tauri";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "./select";

type NativeSelectProps = Omit<React.ComponentProps<"select">, "size"> & {
  size?: "sm" | "default"
}

function NativeSelect({
  className,
  size = "default",
  ...props
}: NativeSelectProps) {
  if (!isTauriRuntime()) return <BrowserSelect className={className} size={size} {...props} />;
  return (
    <div
      className={cn(
        "group/native-select relative w-fit has-[select:disabled]:opacity-[var(--shadcn-disabled-opacity)]",
        className
      )}
      data-slot="native-select-wrapper"
      data-size={size}
    >
      <select
        data-slot="native-select"
        data-size={size}
        className="h-8 w-full min-w-0 appearance-none py-0 pr-7 pl-2 rounded-full border border-(--color-border) bg-(--color-surface) text-xs/4 text-(--color-text) transition-colors outline-none select-none hover:bg-(--color-background-primary-ghost-hover) focus-visible:ring-2 focus-visible:ring-(--color-ring) disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-(--color-text-danger) data-[size=sm]:h-7"
        {...props}
      />
      <HugeiconsIcon icon={UnfoldMoreIcon} strokeWidth={2} className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-(--color-text-tertiary) select-none" aria-hidden="true" data-slot="native-select-icon" />
    </div>
  )
}

type Choice = { value: string; label: React.ReactNode; disabled?: boolean; group?: string };

function selectChoices(children: React.ReactNode, group?: string, disabled = false): Choice[] {
  return React.Children.toArray(children).flatMap(child => {
    if (!React.isValidElement<{ children?: React.ReactNode; value?: string | number; label?: string; disabled?: boolean }>(child)) return [];
    if (child.type === React.Fragment) return selectChoices(child.props.children, group, disabled);
    if (child.type === "optgroup" || child.type === NativeSelectOptGroup) {
      return selectChoices(child.props.children, child.props.label, disabled || child.props.disabled);
    }
    return [{ value: String(child.props.value ?? child.props.children ?? ""), label: child.props.label ?? child.props.children,
      disabled: disabled || child.props.disabled, group }];
  });
}

// Browser menus use the same Radix primitive as the rest of the shell. The
// hidden select retains the existing form/change-event contract without ever
// opening an operating-system picker. Tauri keeps the native presentation.
function BrowserSelect({ className, size, children, value, defaultValue, onChange, ref, ...props }: NativeSelectProps) {
  const nativeRef = React.useRef<HTMLSelectElement>(null);
  const choices = selectChoices(children);
  const [uncontrolledValue, setUncontrolledValue] = React.useState(() => String(defaultValue ?? choices.find(choice => !choice.disabled)?.value ?? ""));
  const selectedValue = String(value ?? uncontrolledValue);
  const selectedIndex = choices.findIndex(choice => choice.value === selectedValue);
  const attributes = Object.fromEntries(Object.entries(props).filter(([key]) => key.startsWith("aria-") || key.startsWith("data-")));
  const items = choices.map((choice, index) => <SelectItem key={index} value={String(index)} disabled={choice.disabled}>{choice.label}</SelectItem>);
  const groups: React.ReactNode[] = [];
  for (let start = 0; start < choices.length;) {
    const group = choices[start].group;
    let end = start + 1;
    while (end < choices.length && choices[end].group === group) end++;
    groups.push(group === undefined ? items.slice(start, end) : <SelectGroup key={start}><SelectLabel>{group}</SelectLabel>{items.slice(start, end)}</SelectGroup>);
    start = end;
  }
  return <div data-slot="native-select-wrapper" data-size={size} className={cn("relative w-fit", className)}>
    <select {...props} id={undefined} ref={node => {
      nativeRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    }} hidden aria-hidden="true" tabIndex={-1} value={selectedValue}
      onChange={event => { setUncontrolledValue(event.currentTarget.value); onChange?.(event); }}>
      {children}
    </select>
    <Select value={selectedIndex < 0 ? "" : String(selectedIndex)} disabled={props.disabled}
      onValueChange={index => {
        const native = nativeRef.current;
        const choice = choices[Number(index)];
        if (!native || !choice) return;
        native.value = choice.value;
        native.dispatchEvent(new Event("change", { bubbles: true }));
      }}>
      <SelectTrigger {...attributes} id={props.id} size={size} className="w-full min-w-0" title={props.title} autoFocus={props.autoFocus} tabIndex={props.tabIndex}>
        <SelectValue>{choices[selectedIndex]?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" align="start">{groups}</SelectContent>
    </Select>
  </div>;
}

function NativeSelectOption({
  className,
  ...props
}: React.ComponentProps<"option">) {
  return (
    <option
      data-slot="native-select-option"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  )
}

function NativeSelectOptGroup({
  className,
  ...props
}: React.ComponentProps<"optgroup">) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  )
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
