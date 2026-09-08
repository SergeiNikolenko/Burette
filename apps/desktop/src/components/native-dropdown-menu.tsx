import { cloneElement, useState, type ComponentProps, type HTMLAttributes, type ReactElement } from "react";
import { isTauriRuntime } from "../lib/tauri";
import { showNativeContextMenu } from "./native-context-menu";
import { RadixDropdownMenu } from "./radix-menu";

// Sidebar buttons and secondary clicks share the same AppKit menu on macOS.
export function NativeDropdownMenu(props: ComponentProps<typeof RadixDropdownMenu>) {
  const [open, setOpen] = useState(false);
  if (!isTauriRuntime()) return <RadixDropdownMenu {...props} />;
  const trigger = props.trigger as ReactElement<HTMLAttributes<HTMLElement>>;
  const show = async (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setOpen(true);
    try {
      await showNativeContextMenu(props.items, { x: rect.left, y: props.side === "top" ? rect.top : rect.bottom });
    } finally {
      setOpen(false);
    }
  };
  return cloneElement(trigger, {
    "aria-haspopup": "menu",
    "aria-expanded": open,
    onClick: event => {
      trigger.props.onClick?.(event);
      event.stopPropagation();
      if (!event.defaultPrevented) void show(event.currentTarget);
    },
    onKeyDown: event => {
      trigger.props.onKeyDown?.(event);
      if (event.defaultPrevented || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
      event.preventDefault();
      void show(event.currentTarget);
    },
  });
}
