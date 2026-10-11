import { useId, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { KetcherToolTooltip } from "./tool-tooltip";
import "./periodic-table.css";

const choices = [
  { value: "atom", label: "Single", testId: "single-radio-button" },
  { value: "list", label: "List", testId: "list-radio-button" },
  { value: "not-list", label: "Not List", testId: "not-list-radio-button" },
];

export function KetcherElementChoice({ value, onChange, disabled }: {
  value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const id = useId();
  return <RadioGroup value={value} onValueChange={next => { if (typeof next === "string") onChange(next); }}
    disabled={disabled} aria-label="Element selection" className="ketcher-element-choice">
    {choices.map(choice => <label key={choice.value} htmlFor={`${id}-${choice.value}`}>
      <RadioGroupItem id={`${id}-${choice.value}`} value={choice.value} data-testid={choice.testId} />
      {choice.label}
    </label>)}
  </RadioGroup>;
}

export function KetcherPeriodicElementButton({ el, shortcut, selected, className, title: _title, ...props }:
  Omit<ComponentProps<typeof Button>, "children"> & {
    el: { number: number; label: string; title: string }; shortcut?: string; selected?: boolean;
  }) {
  // ElementsTable owns selection in its class list; toolbar callers use selected.
  const active = selected ?? Boolean(className?.includes("ElementsTable-module_selected"));
  return <KetcherToolTooltip label={el.title} shortcut={shortcut} disabled={props.disabled}>
    <Button {...props} type="button" value={el.number} variant={active ? "secondary" : "outline"}
    aria-pressed={active} aria-label={`${el.title}, ${el.label}, atomic number ${el.number}`}
    data-testid={`${el.label}-button`}
    className="ketcher-periodic-element">
    <span>{el.label}</span><span className="ketcher-periodic-number" aria-hidden="true">{el.number}</span>
    </Button>
  </KetcherToolTooltip>;
}
