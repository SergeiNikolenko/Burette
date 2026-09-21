import type { ButtonHTMLAttributes } from "react";
import { CloseIcon } from "../close-icon";
import { Badge } from "../ui/badge";

/** Shared document-tab chrome; each host retains its own document lifecycle. */
export function DocumentTab({ label, active, dirty = false, onClose, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active: boolean;
  dirty?: boolean;
  onClose?: () => void;
}) {
  return <>
    <button
      type="button"
      role="tab"
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      aria-label={dirty ? `${label}, Unsaved changes` : label}
      className={active ? "tab active" : "tab"}
      {...props}
    >
      <span>{label}</span>
      {dirty ? <Badge className="ml-1.5 size-2 p-0" aria-hidden="true" /> : null}
    </button>
    {onClose ? <button type="button" className="tab-close" aria-label={`Close ${label}`} onClick={event => {
      event.stopPropagation();
      onClose();
    }}><CloseIcon size={13} /></button> : null}
  </>;
}
