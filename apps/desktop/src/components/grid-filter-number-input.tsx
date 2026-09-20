import { useRef, useState } from "react";
import { Input } from "./ui/input";

// Filters may be empty (unbounded), unlike a mandatory numeric setting.
export function GridFilterNumberInput({ value, fallback, step, label, placeholder, onCommit }: {
  value: string;
  fallback: number;
  step: number;
  label: string;
  placeholder: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const drag = useRef<{ id: number; x: number; value: number; next: string; moved: boolean } | null>(null);
  const finish = () => {
    if (draft === null) return;
    const text = draft.trim();
    if (text === "" || Number.isFinite(Number(text))) onCommit(text);
    setDraft(null);
  };
  return (
    <div className="relative min-w-0">
      <Input
        type="text"
        inputMode="decimal"
        className="pr-7"
        aria-label={label}
        placeholder={placeholder}
        value={draft ?? value}
        onFocus={() => setDraft(value)}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={finish}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft(null);
          }
        }}
      />
      <button
        type="button"
        className="absolute inset-y-0 right-0 w-6 cursor-ew-resize touch-none select-none rounded-r-md text-muted-foreground hover:bg-muted"
        aria-label={`Adjust ${label.toLowerCase()}`}
        title="Drag to adjust · Shift: faster · Option: finer"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          const text = draft ?? value;
          const parsed = text.trim() === "" ? fallback : Number(text);
          drag.current = { id: event.pointerId, x: event.clientX, value: Number.isFinite(parsed) ? parsed : fallback, next: text, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const state = drag.current;
          if (!state || state.id !== event.pointerId) return;
          const delta = event.clientX - state.x;
          if (!state.moved && Math.abs(delta) < 3) return;
          state.moved = true;
          const increment = step * (event.shiftKey ? 10 : event.altKey ? 0.1 : 1);
          state.next = String(Number((state.value + Math.round(delta / 4) * increment).toPrecision(12)));
          setDraft(state.next);
        }}
        onPointerUp={(event) => {
          const state = drag.current;
          if (!state || state.id !== event.pointerId) return;
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          if (state.moved) { onCommit(state.next); setDraft(null); }
        }}
        onPointerCancel={() => { drag.current = null; setDraft(null); }}
        onLostPointerCapture={() => {
          if (drag.current) { drag.current = null; setDraft(null); }
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          const base = value.trim() === "" ? fallback : Number(value);
          onCommit(String(Number((base + (event.key === "ArrowUp" ? step : -step)).toPrecision(12))));
        }}
      >
        <span aria-hidden="true">↔</span>
      </button>
    </div>
  );
}
