import React from "react";
import { DropdownMenu } from "radix-ui";
import { Check } from "../components/ui/app-icons";

type Choice = { value: string; label: string; disabled: boolean };

function nativeMenus() {
  const config = (window as Window & { BuretteConfig?: { tauriViewer?: boolean; quickLookViewer?: boolean; host?: string } }).BuretteConfig;
  return config?.tauriViewer === true || config?.quickLookViewer === true || config?.host === "app";
}

// Browser surfaces have no operating-system menus, so the select's popup is
// replaced by a Radix menu built from its current options when it opens. The
// select itself stays the source of truth: grid-viewer edits its value,
// options and disabled state by id. macOS app and Quick Look keep the native
// popup.
export function GridSelectMenu({ children }: { children: React.ReactElement }) {
  const anchorRef = React.useRef<HTMLSpanElement>(null);
  const [open, setOpen] = React.useState(false);
  const [choices, setChoices] = React.useState<Choice[]>([]);
  const [value, setValue] = React.useState("");
  if (nativeMenus()) return children;

  const select = () => anchorRef.current?.querySelector("select") ?? null;
  const onOpenChange = (next: boolean) => {
    const element = select();
    if (!next || !element || element.disabled) {
      setOpen(false);
      return;
    }
    element.focus({ preventScroll: true });
    setChoices(Array.from(element.options, (option) => ({ value: option.value, label: option.text, disabled: option.disabled })));
    setValue(element.value);
    setOpen(true);
  };
  const choose = (next: string) => {
    const element = select();
    if (!element || element.value === next) return;
    element.value = next;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };

  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenu.Trigger asChild>
        <span
          className="buret-grid-select-anchor"
          ref={anchorRef}
          onMouseDown={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (event.key !== "ArrowUp") return;
            event.preventDefault();
            onOpenChange(true);
          }}
        >
          {children}
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="buret-grid-select-menu"
          data-buret-grid-select-menu=""
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onEscapeKeyDown={(event) => event.stopPropagation()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            select()?.focus({ preventScroll: true });
          }}
        >
          <DropdownMenu.RadioGroup value={value} onValueChange={choose}>
            {choices.map((choice) => (
              <DropdownMenu.RadioItem key={choice.value} value={choice.value} disabled={choice.disabled}>
                {choice.label}
                <DropdownMenu.ItemIndicator className="buret-grid-select-check">
                  <Check aria-hidden="true" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
