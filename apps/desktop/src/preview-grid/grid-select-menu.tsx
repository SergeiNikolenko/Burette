import React from "react";
import { DropdownMenu } from "radix-ui";
import { Check } from "../components/ui/app-icons";
import { SelectOptionContent } from "../components/ui/select-option-content";

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
          className="atlas-select-menu buret-grid-select-menu"
          data-position="popper"
          data-buret-grid-select-menu=""
          align="start"
          sideOffset={5}
          collisionPadding={6}
          onEscapeKeyDown={(event) => event.stopPropagation()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            select()?.focus({ preventScroll: true });
          }}
        >
          <DropdownMenu.RadioGroup className="atlas-select-options" value={value} onValueChange={choose}>
            {choices.map((choice) => (
              <DropdownMenu.RadioItem className="atlas-select-option" key={choice.value} value={choice.value} disabled={choice.disabled}>
                <SelectOptionContent indicator={<DropdownMenu.ItemIndicator>
                  <Check className="atlas-select-check" aria-hidden="true" />
                </DropdownMenu.ItemIndicator>}>
                  {choice.label}
                </SelectOptionContent>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
