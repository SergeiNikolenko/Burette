type ShortcutTooltipProps = {
  label: string;
  shortcut: string;
  side?: "top" | "bottom";
};

export function ShortcutTooltip({ label, shortcut, side = "bottom" }: ShortcutTooltipProps) {
  return (
    <span className="shortcut-tooltip" data-side={side} role="tooltip" aria-hidden="true">
      <span className="shortcut-tooltip-label">{label}</span>
      <kbd className="shortcut-tooltip-key">{shortcut}</kbd>
    </span>
  );
}
