import type { ReactNode } from "react";

// Original Atlas Select option anatomy, shared by shell Select and grid menus.
export function SelectOptionContent({ indicator, children }: { indicator: ReactNode; children: ReactNode }) {
  return <div className="atlas-select-pressable">
    <div className="atlas-select-option-inner">
      <span className="atlas-select-check-slot" data-option-indicator-position="start">{indicator}</span>
      {children}
    </div>
  </div>;
}
