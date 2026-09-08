import { useEffect } from "react";

// Local drop zones may stop propagation. End their highlight in capture phase,
// including cancellation outside the zone where dragleave is not guaranteed.
export function useDropHighlightReset(setActive: (active: boolean) => void) {
  useEffect(() => {
    const clear = () => setActive(false);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") clear(); };
    window.addEventListener("drop", clear, true);
    window.addEventListener("dragend", clear);
    window.addEventListener("blur", clear);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("drop", clear, true);
      window.removeEventListener("dragend", clear);
      window.removeEventListener("blur", clear);
      window.removeEventListener("keydown", escape, true);
    };
  }, [setActive]);
}
