import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
  if (item.kind === "label") {
    return <DropdownMenuLabel key={item.id} className="radix-menu-group-label">{item.text}</DropdownMenuLabel>;
  }
  if (item.kind === "checkbox") {
    return (
      <DropdownMenuCheckboxItem
        key={item.id}
        checked={item.checked}
        disabled={item.disabled}
        onCheckedChange={(checked) => item.action?.(checked === true)}
      >
        {renderItemBody(item)}
        {item.accelerator ? <DropdownMenuShortcut>{item.accelerator}</DropdownMenuShortcut> : null}
      </DropdownMenuCheckboxItem>
    );
  }
  if (item.kind === "swatches" || item.kind === "select" || item.kind === "number") {
    return renderControl(item);
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
  if (item.kind === "label") {
    return <ContextMenuLabel key={item.id} className="radix-menu-group-label">{item.text}</ContextMenuLabel>;
  }
  if (item.kind === "checkbox") {
    return (
      <ContextMenuCheckboxItem
        key={item.id}
        checked={item.checked}
        disabled={item.disabled}
        onCheckedChange={(checked) => item.action?.(checked === true)}
      >
        {renderItemBody(item)}
        {item.accelerator ? <ContextMenuShortcut>{item.accelerator}</ContextMenuShortcut> : null}
      </ContextMenuCheckboxItem>
    );
  }
  if (item.kind === "swatches" || item.kind === "select" || item.kind === "number") {
    return renderControl(item);
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

// Controls live outside the menu's roving focus: a select or a number field that
// closed the menu on every keystroke would make a parameter impossible to set.
// They stop selection and keypresses from reaching the menu instead.
function renderControl(item: Extract<MenuItemSpec, { kind: "swatches" | "select" | "number" }>) {
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  if (item.kind === "swatches") {
    return (
      <div key={item.id} className="radix-menu-swatches" onKeyDown={stop}>
        {item.colors.map((color) => (
          <button
            key={color}
            type="button"
            className="radix-menu-swatch"
            data-active={item.activeColor === color || undefined}
            style={{ background: color }}
            aria-label={item.label ? `${item.label}: ${color}` : color}
            onClick={(event) => { stop(event); item.action?.(color); }}
          />
        ))}
      </div>
    );
  }
  // The menu's items are a snapshot taken when it opened, so a controlled value
  // would spring back to that snapshot on every keystroke even though the write
  // succeeded. These seed from the current value and then keep what is typed.
  if (item.kind === "select") {
    return (
      <label key={item.id} className="radix-menu-field" onKeyDown={stop}>
        <span>{item.label}</span>
        <select
          defaultValue={item.value}
          disabled={item.disabled}
          onClick={stop}
          onChange={(event) => item.action?.(event.currentTarget.value)}
        >
          {item.options.map((option) => (
            <option key={option} value={option}>{item.optionLabels?.[option] ?? option}</option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label key={item.id} className="radix-menu-field" onKeyDown={stop}>
      <span>{item.label}</span>
      <span className="radix-menu-field-number">
        <input
          type="number"
          defaultValue={item.value}
          min={item.min}
          max={item.max}
          step={item.step}
          disabled={item.disabled}
          onClick={stop}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isFinite(next)) item.action?.(next);
          }}
        />
        {item.unit ? <em>{item.unit}</em> : null}
      </span>
    </label>
  );
}

// The item's own layout stays local: a menu entry here can carry an icon and a second
// line of detail, which the shadcn item does not model. It sits inside the shadcn
// item, so spacing, hover and disabled states still come from the component.
function renderItemBody(item: Extract<MenuItemSpec, { kind: "item" | "checkbox" }>) {
  const iconUrl = item.kind === "item" ? item.iconUrl : undefined;
  const iconText = item.kind === "item" ? item.iconText : undefined;
  const tooltip = item.kind === "item" ? item.tooltip : undefined;
  return (
    <span className="radix-menu-item-body" title={tooltip}>
      {iconUrl ? (
        <img className="radix-menu-item-icon" src={iconUrl} alt="" aria-hidden="true" />
      ) : iconText ? (
        <span className="radix-menu-item-icon" aria-hidden="true">{iconText}</span>
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
