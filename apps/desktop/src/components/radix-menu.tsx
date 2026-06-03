import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { MenuItemSpec } from "./menu-types";

type RadixDropdownProps = {
  items: MenuItemSpec[];
  trigger: ReactElement;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
  alignOffset?: number;
};

export function RadixDropdownMenu({
  items,
  trigger,
  align = "end",
  side = "bottom",
  sideOffset = 6,
  alignOffset,
}: RadixDropdownProps) {
  const container = useThemePortalContainer();

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal container={container}>
        <DropdownMenu.Content
          className="radix-menu"
          align={align}
          side={side}
          sideOffset={sideOffset}
          alignOffset={alignOffset}
          collisionPadding={8}
        >
          {items.map((item, index) => renderDropdownItem(item, index))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
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
    <ContextMenu.Root modal={false} onOpenChange={(open) => { if (!open) onClose(); }}>
      <ContextMenu.Trigger asChild>
        <span
          ref={triggerRef}
          className="radix-context-menu-trigger"
          style={{ left: point.x, top: point.y }}
          aria-hidden="true"
        />
      </ContextMenu.Trigger>
      <ContextMenu.Portal container={container}>
        <ContextMenu.Content className="radix-menu" collisionPadding={8}>
          {items.map((item, index) => renderContextItem(item, index))}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function renderDropdownItem(item: MenuItemSpec, index: number) {
  if (item.kind === "separator") {
    return <DropdownMenu.Separator key={`separator-${index}`} className="radix-menu-separator" />;
  }

  return (
    <DropdownMenu.Item
      key={item.id}
      className="radix-menu-item"
      disabled={item.disabled}
      onSelect={() => item.action?.()}
    >
      <span>{item.text}</span>
      {item.accelerator ? <kbd>{item.accelerator}</kbd> : null}
    </DropdownMenu.Item>
  );
}

function renderContextItem(item: MenuItemSpec, index: number) {
  if (item.kind === "separator") {
    return <ContextMenu.Separator key={`separator-${index}`} className="radix-menu-separator" />;
  }

  return (
    <ContextMenu.Item
      key={item.id}
      className="radix-menu-item"
      disabled={item.disabled}
      onSelect={() => item.action?.()}
    >
      <span>{item.text}</span>
      {item.accelerator ? <kbd>{item.accelerator}</kbd> : null}
    </ContextMenu.Item>
  );
}

export function useThemePortalContainer() {
  const [container, setContainer] = useState<HTMLElement>();

  useLayoutEffect(() => {
    setContainer(document.querySelector<HTMLElement>(".app-shell") ?? document.body);
  }, []);

  return container;
}
