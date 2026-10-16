import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrubNumberField } from "@/components/ui/scrub-number-input";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { MenuItemSpec } from "./menu-types";
import { formatAccelerator } from "../lib/keyboard-shortcuts";
import { HugeiconsIcon } from "@hugeicons/react";
import * as appIconData from "./ui/app-icon-data";
import { AppImageIcon } from "./ui/app-image-icon";

type RadixDropdownProps = {
  items: MenuItemSpec[];
  trigger: ReactElement;
  contentClassName?: string;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
  alignOffset?: number;
  onOpenChange?: (open: boolean) => void;
};

export function RadixDropdownMenu({
  items,
  trigger,
  contentClassName,
  align = "end",
  side = "bottom",
  sideOffset = 1,
  alignOffset,
  onOpenChange,
}: RadixDropdownProps) {
  const container = useThemePortalContainer();

  return (
    <DropdownMenu modal={false} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        className={contentClassName}
        container={container}
        align={align}
        side={side}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionPadding={6}
      >
        {items.map((item, index) => renderDropdownItem(item, index))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

let closeActiveContextMenu: (() => void) | undefined;

// Resolve after tracking ends, like NSMenu: viewer edits and undo transactions
// remain alive while controls are being changed inside the popup.
export function showRadixContextMenu(spec: MenuItemSpec[], at?: { x: number; y: number }): Promise<void> {
  closeActiveContextMenu?.();
  const host = document.querySelector<HTMLElement>(".app-shell") ?? document.body;
  const mount = document.createElement("div");
  mount.className = "radix-context-menu-mount";
  host.append(mount);

  const root = createRoot(mount);
  return new Promise<void>((resolve) => {
    let closing = false;
    const cleanup = () => {
      if (closing) return;
      closing = true;
      if (closeActiveContextMenu === cleanup) closeActiveContextMenu = undefined;
      window.removeEventListener("blur", cleanup);
      window.removeEventListener("pagehide", cleanup);
      window.setTimeout(() => {
        root.unmount();
        mount.remove();
        resolve();
      }, 0);
    };
    closeActiveContextMenu = cleanup;
    // A click back into the molecular iframe does not bubble to this document.
    window.addEventListener("blur", cleanup);
    window.addEventListener("pagehide", cleanup);
    root.render(<RadixContextMenuLauncher items={spec} at={at} container={host} onClose={cleanup} />);
  });
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
      <ContextMenuContent container={container} collisionPadding={6}>
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
        // MenuItemSpec is a one-shot snapshot; reopen to read the updated scene.
        closeOnSelect
        checked={item.checked}
        disabled={item.disabled}
        onCheckedChange={(checked) => item.action?.(checked === true)}
      >
        {renderItemBody(item)}
        {item.accelerator ? <DropdownMenuShortcut>{formatAccelerator(item.accelerator)}</DropdownMenuShortcut> : null}
      </DropdownMenuCheckboxItem>
    );
  }
  if (item.kind === "swatches" || item.kind === "select" || item.kind === "number" || item.kind === "text") {
    return renderControl(item);
  }
  if (item.kind === "submenu") {
    return (
      <DropdownMenuSub key={item.id}>
        <DropdownMenuSubTrigger disabled={item.disabled}>{renderItemBody(item)}</DropdownMenuSubTrigger>
        <DropdownMenuPortal>
          <DropdownMenuSubContent>{item.items.map(renderDropdownItem)}</DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>
    );
  }

  return (
    <DropdownMenuItem
      key={item.id}
      variant={item.variant}
      disabled={item.disabled}
      onSelect={() => item.action?.()}
    >
      {renderItemBody(item)}
      {item.accelerator ? <DropdownMenuShortcut>{formatAccelerator(item.accelerator)}</DropdownMenuShortcut> : null}
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
        closeOnSelect
        checked={item.checked}
        disabled={item.disabled}
        onCheckedChange={(checked) => item.action?.(checked === true)}
      >
        {renderItemBody(item)}
        {item.accelerator ? <ContextMenuShortcut>{formatAccelerator(item.accelerator)}</ContextMenuShortcut> : null}
      </ContextMenuCheckboxItem>
    );
  }
  if (item.kind === "swatches" || item.kind === "select" || item.kind === "number" || item.kind === "text") {
    return renderControl(item);
  }
  if (item.kind === "submenu") {
    return (
      <ContextMenuSub key={item.id}>
        <ContextMenuSubTrigger disabled={item.disabled}>{renderItemBody(item)}</ContextMenuSubTrigger>
        <ContextMenuPortal>
          <ContextMenuSubContent>{item.items.map(renderContextItem)}</ContextMenuSubContent>
        </ContextMenuPortal>
      </ContextMenuSub>
    );
  }

  return (
    <ContextMenuItem
      key={item.id}
      variant={item.variant}
      disabled={item.disabled}
      onSelect={() => item.action?.()}
    >
      {renderItemBody(item)}
      {item.accelerator ? <ContextMenuShortcut>{formatAccelerator(item.accelerator)}</ContextMenuShortcut> : null}
    </ContextMenuItem>
  );
}

// Controls live outside the menu's roving focus: a select or a number field that
// closed the menu on every keystroke would make a parameter impossible to set.
// They stop selection and keypresses from reaching the menu instead.
function renderControl(item: Extract<MenuItemSpec, { kind: "swatches" | "select" | "number" | "text" }>) {
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  if (item.kind === "swatches") return <RadixMenuSwatches key={item.id} item={item} />;
  // The menu's items are a snapshot taken when it opened, so a controlled value
  // would spring back to that snapshot on every keystroke even though the write
  // succeeded. These seed from the current value and then keep what is typed.
  if (item.kind === "select") {
    return (
      <label key={item.id} className="radix-menu-field" onKeyDown={stop}>
        <span>{item.label}</span>
        <NativeSelect
          size="sm"
          aria-label={item.label}
          defaultValue={item.value}
          disabled={item.disabled}
          onClick={stop}
          onChange={(event) => item.action?.(event.currentTarget.value)}
        >
          {/* An action picker such as "Add" has no current value: name the choice
              instead of rendering an empty control. */}
          {!item.options.includes(item.value) && <option value={item.value} disabled>Choose…</option>}
          {item.options.map((option) => (
            <option key={option} value={option}>{item.optionLabels?.[option] ?? option}</option>
          ))}
        </NativeSelect>
      </label>
    );
  }
  if (item.kind === "text") {
    return (
      <label key={item.id} className="radix-menu-field" onKeyDown={stop}>
        <span>{item.label}</span>
        <Input
          variant="compact"
          aria-label={item.label}
          type="text"
          defaultValue={item.value}
          placeholder={item.placeholder}
          disabled={item.disabled}
          onClick={stop}
          onPointerDown={stop}
          onChange={(event) => item.action?.(event.currentTarget.value)}
        />
      </label>
    );
  }
  return <RadixMenuNumberControl key={item.id} item={item} />;
}

function hsbHex(hue: number, saturation: number, brightness: number) {
  const channel = (n: number) => {
    const k = (n + hue * 6) % 6;
    return Math.round(255 * brightness * (1 - saturation * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return `#${[5, 3, 1].map((n) => channel(n).toString(16).padStart(2, "0")).join("")}`;
}

// The native menu's row: the caller's palette first, then three tones of an
// 18-step hue wheel, so any colour is a scroll away rather than behind a dialog.
const HUE_WHEEL = [[0.32, 0.97], [0.62, 0.92], [0.85, 0.72]].flatMap(([saturation, brightness]) =>
  Array.from({ length: 18 }, (_, step) => hsbHex(step / 18, saturation, brightness)));

function RadixMenuSwatches({ item }: { item: Extract<MenuItemSpec, { kind: "swatches" }> }) {
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  const colors = [...new Set([...item.colors, ...HUE_WHEEL])];
  const [active, setActive] = useState(item.activeColor);
  const choose = (color: string) => { setActive(color); item.action?.(color); };
  const label = item.label || "Colour";
  return (
    <div className="radix-menu-swatches" role="group" aria-label={label} onKeyDown={stop}>
      <div
        className="radix-menu-swatch-strip"
        // Bring the chosen swatch into view when the menu opens.
        ref={(strip) => { strip?.querySelector<HTMLElement>("[data-active]")?.scrollIntoView({ block: "nearest", inline: "center" }); }}
        // A mouse wheel only scrolls vertically; let it browse the row too.
        onWheel={(event) => { if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY; }}
      >
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            className="radix-menu-swatch"
            data-active={active === color || undefined}
            aria-pressed={active === color}
            style={{ background: color }}
            aria-label={`${label}: ${color}`}
            onClick={(event) => { stop(event); choose(color); }}
          />
        ))}
      </div>
      <label className="radix-menu-swatch-custom" title="Custom colour" onClick={stop} onPointerDown={stop}>
        <input
          type="color"
          aria-label={`Custom ${label.toLowerCase()}`}
          defaultValue={active && /^#[0-9a-f]{6}$/i.test(active) ? active : "#3b82f6"}
          onChange={(event) => choose(event.currentTarget.value)}
        />
      </label>
    </div>
  );
}

function RadixMenuNumberControl({ item }: { item: Extract<MenuItemSpec, { kind: "number" }> }) {
  const [value, setValue] = useState(item.value);
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  return (
    <label className="radix-menu-field" onKeyDown={stop}>
      <span>{item.label}</span>
      <span className="radix-menu-field-number" onClick={stop} onPointerDown={stop}>
        <ScrubNumberField
          aria-label={item.label}
          className="radix-menu-number-scrub"
          value={value}
          min={item.min}
          max={item.max}
          step={item.step}
          disabled={item.disabled}
          onValueChange={(next) => {
            setValue(next);
            item.action?.(next);
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
function renderItemBody(item: Extract<MenuItemSpec, { kind: "item" | "checkbox" | "submenu" }>) {
  const iconUrl = item.kind === "item" || item.kind === "submenu" ? item.iconUrl : undefined;
  const iconText = item.kind === "item" || item.kind === "submenu" ? item.iconText : undefined;
  const tooltip = item.kind === "item" ? item.tooltip : undefined;
  return (
    <span className="radix-menu-item-body" title={tooltip}>
      {iconUrl ? (
        iconUrl.startsWith("data:image/svg+xml")
          ? <span className="radix-menu-item-icon" aria-hidden="true" style={{ backgroundColor: "currentColor", maskImage: `url("${iconUrl}")`, WebkitMaskImage: `url("${iconUrl}")`, maskSize: "contain", maskRepeat: "no-repeat" }} />
          : <AppImageIcon className="radix-menu-item-icon" src={iconUrl} fallback={iconText ?? item.text.slice(0, 2).toUpperCase()} />
      ) : item.icon ? (
        <HugeiconsIcon className="radix-menu-item-icon" icon={appIconData[item.icon]} size={16} aria-hidden="true" />
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
