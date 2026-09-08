import { useEffect, useState } from "react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type AnalogueOption = { value: string; label: string; color: string };

// The original controller still chooses the peptide/RNA options and whether the
// monomer type requires an analogue. This replaces only its dropdown rendering.
export function KetcherNaturalAnaloguePicker({ value, onChange, options, disabled, className, error }: {
  value?: string | null; onChange: (value: string) => void; options: AnalogueOption[];
  disabled: boolean; className?: string; error?: boolean;
}) {
  const [container, setContainer] = useState(() => document.fullscreenElement as HTMLElement | null);
  useEffect(() => {
    const update = () => setContainer(document.fullscreenElement as HTMLElement | null);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  const selected = options.find((option) => option.value === value);
  return <Select value={selected?.value ?? ""} onValueChange={onChange} disabled={disabled}>
    <SelectTrigger className={cn("ketcher-ui-select", className)} size="sm" aria-label="Natural analogue"
      aria-invalid={error} data-testid="natural-analogue-picker">
      <SelectValue placeholder="Select an analogue">
        {selected && <AnalogueChip option={selected} testId={`natural-analogue-picker-selected-${selected.value}`} />}
      </SelectValue>
    </SelectTrigger>
    <SelectContent container={container ?? undefined} position="popper" className="ketcher-ui-options">
      {options.map((option) => <SelectItem key={option.value} value={option.value}
        data-testid={`natural-analogue-picker-option-${option.value}`}>
        <AnalogueChip option={option} />
      </SelectItem>)}
    </SelectContent>
  </Select>;
}

function AnalogueChip({ option, testId }: { option: AnalogueOption; testId?: string }) {
  return <span className="inline-flex items-center gap-2" data-testid={testId}>
    <span aria-hidden className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: option.color }} />
    {option.label}
  </span>;
}
