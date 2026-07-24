import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MenuItemSpec } from "./menu-types";

type RadixDropdownProps = {
  items: MenuItemSpec[];
  trigger: ReactElement;
  contentClassName?: string;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
  alignOffset?: number;
};

export function RadixDropdownMenu({
  items,
  trigger,
  contentClassName,
  align = "end",
  side = "bottom",
  sideOffset = 6,
  alignOffset,
}: RadixDropdownProps) {
  const container = useThemePortalContainer();

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        className={contentClassName}
        container={container}
        align={align}
        side={side}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionPadding={8}
      >
        {items.map((item, index) => renderDropdownItem(item, index))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function showRadixContextMenu(spec: MenuItemSpec[], at?: { x: number; y: number }) {
  const host = document.querySelector<HTMLElement>(".app-shell") ?? document.body;
  const mount = document.createElement("div");
  mount.className = "radix-context-menu-mount";
  host.append(mount);

  let root: ReactRoot | null = createRoot(mount);
  const cleanup = () => {
    window.setTimeout(() => {
      root?.unmount();
      root = null;
      mount.remove();
    }, 0);
  };

  root.render(<RadixContextMenuLauncher items={spec} at={at} container={host} onClose={cleanup} />);
}

function RadixContextMenuLauncher({
  items,
  at,
  container,
  onClose,
}: {
  items: MenuItemSpec[];
  at?: { x: number; y: number };
  container: HTMLElement;
  onClose: () => void;
}) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const point = useMemo(() => ({
    x: Math.max(8, Math.min(at?.x ?? 8, window.innerWidth - 8)),
    y: Math.max(8, Math.min(at?.y ?? 8, window.innerHeight - 8)),
  }), [at?.x, at?.y]);

  useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    trigger.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
    }));
  }, [point.x, point.y]);

  return (
    <ContextMenu modal={false} onOpenChange={(open) => { if (!open) onClose(); }}>
      <ContextMenuTrigger asChild>
        <span
          ref={triggerRef}
          className="radix-context-menu-trigger"
          style={{ left: point.x, top: point.y }}
          aria-hidden="true"
        />
      </ContextMenuTrigger>
      <ContextMenuContent container={container} collisionPadding={8}>
        {items.map((item, index) => renderContextItem(item, index))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function renderDropdownItem(item: MenuItemSpec, index: number) {
  if (item.kind === "separator") {
    return <DropdownMenuSeparator key={`separator-${index}`} />;
  }

  return (
    <DropdownMenuItem
      key={item.id}
      disabled={item.disabled}
      onSelect={() => item.action?.()}
    >
      {renderItemBody(item)}
      {item.accelerator ? <DropdownMenuShortcut>{item.accelerator}</DropdownMenuShortcut> : null}
    </DropdownMenuItem>
  );
}

function renderContextItem(item: MenuItemSpec, index: number) {
  if (item.kind === "separator") {
    return <ContextMenuSeparator key={`separator-${index}`} />;
  }

  return (
    <ContextMenuItem
      key={item.id}
      disabled={item.disabled}
      onSelect={() => item.action?.()}
    >
      {renderItemBody(item)}
      {item.accelerator ? <ContextMenuShortcut>{item.accelerator}</ContextMenuShortcut> : null}
    </ContextMenuItem>
  );
}

// The item's own layout stays local: a menu entry here can carry an icon and a second
// line of detail, which the shadcn item does not model. It sits inside the shadcn
// item, so spacing, hover and disabled states still come from the component.
function renderItemBody(item: Extract<MenuItemSpec, { kind: "item" }>) {
  return (
    <span className="radix-menu-item-body">
      {item.iconUrl ? (
        <img className="radix-menu-item-icon" src={item.iconUrl} alt="" aria-hidden="true" />
      ) : item.iconText ? (
        <span className="radix-menu-item-icon" aria-hidden="true">{item.iconText}</span>
      ) : null}
      <span className="radix-menu-item-copy">
        <span className="radix-menu-item-label">{item.text}</span>
        {item.detail ? <span className="radix-menu-item-detail">{item.detail}</span> : null}
      </span>
    </span>
  );
}

export function useThemePortalContainer() {
  const [container, setContainer] = useState<HTMLElement>();

  useLayoutEffect(() => {
    setContainer(document.querySelector<HTMLElement>(".app-shell") ?? document.body);
  }, []);

  return container;
}
