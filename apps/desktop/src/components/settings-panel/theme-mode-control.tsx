import { useId } from "react";
import type { ViewerPreferences } from "../../types";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";

type ThemeMode = ViewerPreferences["theme"];

const MODES: { value: ThemeMode; label: string }[] = [
  { value: "auto", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

// Atlas AppearanceSettings mode picker: three 4:3 window sketches, the system
// one split into its light and dark halves. Accent strokes use currentColor.
export function ThemeModeControl({ value, onChange }: { value: ThemeMode; onChange: (value: ThemeMode) => void }) {
  const name = useId();
  return (
    <TooltipProvider>
      <div role="radiogroup" aria-label="Mode" className="grid w-68 max-w-full grid-cols-3 gap-4">
        {MODES.map(mode => {
          const selected = mode.value === value;
          return (
            <Tooltip key={mode.value}>
              <TooltipTrigger asChild>
                <label className="group flex min-w-0 cursor-(--cursor-interaction) flex-col items-center gap-1.5 text-center">
                  <input type="radio" className="peer sr-only" name={name} aria-label={mode.label} checked={selected}
                    onChange={() => onChange(mode.value)} />
                  <span aria-hidden="true" className="relative isolate block aspect-4/3 w-full overflow-hidden rounded-lg text-(--color-text-info) peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-(--color-ring)">
                    {mode.value === "auto"
                      ? <span className="grid size-full grid-cols-2"><WindowSketch tone="light" half /><WindowSketch tone="dark" half /></span>
                      : <WindowSketch tone={mode.value} />}
                    <span className={selected
                      ? "absolute inset-0 rounded-lg border-2 border-(--color-ring)"
                      : "absolute inset-0 rounded-lg border-2 border-(--color-border) group-hover:border-(--color-border-strong)"} />
                  </span>
                </label>
              </TooltipTrigger>
              <TooltipContent>{mode.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

function WindowSketch({ tone, half = false }: { tone: "light" | "dark"; half?: boolean }) {
  const shadow = `mode-shadow${useId().replace(/[^\w-]/g, "")}`;
  const dark = tone === "dark";
  const ink = dark ? "white" : "black";
  const muted = dark ? 0.3 : 0.1;
  return (
    <svg viewBox={half ? "0 0 40 60" : "0 0 80 60"} fill="none" className="block size-full" preserveAspectRatio="xMinYMin slice">
      <defs>
        <filter id={shadow} x="-2.5" y="7.5" width="85" height="65" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feDropShadow dy="4" stdDeviation="2.5" floodOpacity="0.1" />
          <feDropShadow dy="10" stdDeviation="6.5" floodOpacity="0.1" />
        </filter>
      </defs>
      <rect width="80" height="60" fill={dark ? "#262626" : "#F4F4F4"} />
      <g filter={`url(#${shadow})`}>
        <rect x="8" y="8" width="64" height="44" rx="4" fill={dark ? "#0D0D0D" : "white"} />
        <rect x="7.75" y="7.75" width="64.5" height="44.5" rx="4.25" stroke={ink} strokeOpacity="0.1" strokeWidth="0.5" />
      </g>
      <rect x="38" y="12" width="30" height="2" rx="1" fill="currentColor" />
      <rect opacity={muted} x="24" y="18" width="30" height="2" rx="1" fill={ink} />
      <rect opacity={muted} x="24" y="22" width="18" height="2" rx="1" fill={ink} />
      <rect opacity={muted} x="24" y="26" width="36" height="2" rx="1" fill={ink} />
      <rect x="29" y="32" width="39" height="2" rx="1" fill="currentColor" />
      <rect x="23.75" y="41.75" width="44.5" height="6.5" rx="3.25" stroke={ink} strokeOpacity={muted} strokeWidth="0.5" />
      <path d="M8 12C8 9.79 9.79 8 12 8H20V52H12C9.79 52 8 50.21 8 48V12Z" fill={ink} fillOpacity={dark ? 0.2 : 0.03} />
    </svg>
  );
}
