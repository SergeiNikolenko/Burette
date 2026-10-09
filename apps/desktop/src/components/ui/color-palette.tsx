import { Button } from "./button";
import "./color-palette.css";

// Atlas ColorPalette (color-palette-89a632e7e110): circular AppButton hit
// targets around 24px swatches. Scientific palettes supply their own colours.
export function ColorPalette({ colors, value, disabled, onValueChange, "aria-label": label }: {
  colors: { label: string; value: string }[];
  value?: string;
  disabled?: boolean;
  onValueChange: (value: string) => void;
  "aria-label": string;
}) {
  return <div className="atlas-color-palette" role="group" aria-label={label}>
    {colors.map(color => <Button key={color.value} size="icon" data-pill=""
      variant={value === color.value ? "secondary" : "ghost"} disabled={disabled}
      aria-label={`Use ${color.label}`} aria-pressed={value === color.value}
      onClick={() => onValueChange(color.value)}>
      <span className="atlas-color-palette-swatch" style={{ backgroundColor: color.value }} aria-hidden />
    </Button>)}
  </div>;
}
