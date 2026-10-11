import type { PointerEvent } from "react";

// A direct pointer move into a portalled flyout is already inside that submenu.
// Do not let the trigger's leave handler focus the parent and dismiss the flyout
// before an embedded input/select receives its first pointer down.
export function preserveSubmenuPointerEntry(event: PointerEvent<HTMLElement>) {
  const target = event.relatedTarget;
  const contentId = event.currentTarget.getAttribute("aria-controls");
  if (target instanceof Node && contentId && event.currentTarget.ownerDocument.getElementById(contentId)?.contains(target)) {
    event.preventDefault();
  }
}
