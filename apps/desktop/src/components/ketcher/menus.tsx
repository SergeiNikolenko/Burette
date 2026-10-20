import { Children, cloneElement, isValidElement, useRef, createContext, useContext, type ReactNode, type ReactElement, type RefObject, type Ref, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, Folder } from "@/components/ui/app-icons";
import { controlIcons } from "./control-icons";
import { KetcherToolTooltip, splitShortcut } from "./tool-tooltip";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuShortcut, DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuGroup, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import "./menu-layout.css";

type MicroToolOption = {
  id: string; label: string; shortcut?: string; icon: ReactNode;
  hidden?: boolean; disabled?: boolean; active: boolean; onSelect: () => void;
};

export function KetcherMicroToolMenu({ primary, options, groups, label, ...props }: {
  primary: ReactNode; options: MicroToolOption[]; groups?: Array<{ start: number; end: number }>;
  label: string; open: boolean; onOpenChange: (open: boolean) => void;
  disabled?: boolean; rootRef?: Ref<HTMLDivElement>; rootClassName?: string; rootTestId: string;
}) {
  const sections = (groups?.length ? groups : [{ start: 0, end: options.length }])
    .map(({ start, end }) => options.slice(start, end).filter(option => !option.hidden))
    .filter(section => section.length > 0);
  const visibleLabel = (value: string) => value.replace(/ Tool$/u, "").replace(/^Arrow /u, "").replace(/^Shape /u, "");
  return <KetcherToolMenu {...props} primary={primary} testId="multi-tool-dropdown" label={label}
    menuClassName="ketcher-tool-options" side="right">
    <DropdownMenuRadioGroup value={options.find(option => option.active)?.id ?? ""}>
    {sections.map((section, index) => <DropdownMenuGroup key={section[0].id}>
      {index > 0 && <DropdownMenuSeparator />}
      {section.map(option =>
        <DropdownMenuRadioItem key={option.id} value={option.id}
          data-testid={option.id} disabled={option.disabled} onSelect={option.onSelect}
          textValue={visibleLabel(option.label)} className="ketcher-tool-option">
          <span className="ketcher-tool-option-icon" aria-hidden="true">{controlIcons(option.icon)}</span><span>{visibleLabel(option.label)}</span>
          {option.shortcut && <DropdownMenuShortcut>{option.shortcut}</DropdownMenuShortcut>}
        </DropdownMenuRadioItem>)}
    </DropdownMenuGroup>)}
    </DropdownMenuRadioGroup>
  </KetcherToolMenu>;
}

type ZoomProps = {
  currentZoom: number; open: boolean; onOpen: () => void;
  onClose: (event?: unknown, reason?: string) => void;
  onZoomIn: () => void; onZoomOut: () => void; onZoomReset: () => void;
  input: ReactNode; disabledButtons?: string[]; hiddenButtons?: string[];
  shortcuts: Record<string, string>; align?: "start" | "end";
};

// Burette owns the single zoom control in its header. The upstream controller
// still runs so its keyboard shortcuts and zoom subscriptions stay installed.
export function KetcherZoomMenu(_props: ZoomProps) { return null; }

export function KetcherModeMenu({ open, onOpen, onClose, onSwitch, disabled, isPolymerEditor, icon, buttonRef }: {
  open: boolean; onOpen: () => void; onClose: () => void; onSwitch: (macro: boolean) => void;
  disabled: boolean; isPolymerEditor: boolean; icon: ReactNode; buttonRef: RefObject<HTMLButtonElement | null>;
}) {
  return <DropdownMenu open={open} onOpenChange={(next) => next ? onOpen() : onClose()} modal={false}>
    <KetcherToolTooltip label={isPolymerEditor ? "Macromolecules" : "Molecules"} disabled={disabled}>
    <DropdownMenuTrigger asChild><Button ref={buttonRef} variant="ghost" size="icon-toolbar" disabled={disabled}
      data-testid="polymer-toggler" aria-label={isPolymerEditor ? "Macromolecules" : "Molecules"}>
      {controlIcons(icon)}
    </Button></DropdownMenuTrigger>
    </KetcherToolTooltip>
    <DropdownMenuContent className="ketcher-ui-menu" collisionPadding={8} container={document.fullscreenElement ?? buttonRef.current?.closest<HTMLElement>(".app-shell") ?? undefined}>
      {[false, true].map((macro) => <DropdownMenuCheckboxItem key={String(macro)} checked={macro === isPolymerEditor}
        data-testid={macro ? "macromolecules_mode" : "molecules_mode"} onSelect={() => onSwitch(macro)}>
        {macro ? "Macromolecules" : "Molecules"}
      </DropdownMenuCheckboxItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}

type CopyOption = { title: string; testId: string; disabled?: boolean; isHidden?: boolean; onClick: () => void; shortcut?: string };
export function KetcherCopyMenu({ topElement, dropDownElements, open, onOpen, onClose }: {
  topElement: ReactElement<CopyOption>; dropDownElements: ReactElement<CopyOption>[];
  open: boolean; onOpen: () => void; onClose: () => void;
}) {
  return <KetcherToolMenu primary={topElement} open={open} onOpenChange={(next) => next ? onOpen() : onClose()}
    disabled={topElement.props.disabled} testId="selection-toolbar" triggerTestId="copy-button-dropdown-triangle"
    hidden={!dropDownElements.some((element) => !element.props.isHidden)}>
    {dropDownElements.filter((element) => !element.props.isHidden).map(({ props }) =>
      <DropdownMenuItem key={props.testId} data-testid={props.testId} disabled={props.disabled} onSelect={props.onClick}>
        {props.title}<DropdownMenuShortcut>{props.shortcut}</DropdownMenuShortcut>
      </DropdownMenuItem>)}
  </KetcherToolMenu>;
}

const MacroMenuContext = createContext(false);
export function KetcherMacroToolMenu({ children, ...props }: ComponentProps<typeof KetcherToolMenu>) {
  return <KetcherToolMenu {...props}><MacroMenuContext.Provider value>{children}</MacroMenuContext.Provider></KetcherToolMenu>;
}

export function KetcherMacroMenuItem({ title, disabled, testId, onClick, icon, active, className, text }: {
  title: string; disabled?: boolean; testId?: string; onClick: () => void; icon: ReactNode; active: boolean; className?: string; text?: boolean;
}) {
  const inMenu = useContext(MacroMenuContext);
  const [label, shortcut] = splitShortcut(title);
  return inMenu
    ? <DropdownMenuCheckboxItem data-testid={testId} disabled={disabled} checked={active} onSelect={onClick}>
        {text ? null : controlIcons(icon)}{label}
        {shortcut && <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>}
      </DropdownMenuCheckboxItem>
    : <KetcherToolTooltip label={label} shortcut={shortcut} disabled={disabled}>
        <Button variant="ghost" size={text ? "toolbar" : "icon-toolbar"} className={className} aria-label={title} data-testid={testId} disabled={disabled}
          aria-pressed={active} onClick={onClick}>{controlIcons(icon)}</Button>
      </KetcherToolTooltip>;
}

// MUI's library and monomer controllers keep their state and chemistry. These
// narrow adapters replace only their tab and expandable-section presentation.
type MaterialTabProps = Omit<ComponentProps<typeof TabsTrigger>, "value"> & {
  value?: number; label: ReactNode; icon?: ReactNode;
};
export function KetcherMaterialTabs({ value, onChange, children, label = "Structure categories" }: {
  value: number; onChange: (event: Event | undefined, value: number) => void; children: ReactNode; className?: string; label?: string;
}) {
  return <Tabs value={String(value)} onValueChange={next => onChange(undefined, Number(next))}>
    <TabsList variant="line" className="ketcher-library-tablist" aria-label={label}>
      {Children.map(children, (child, index) => isValidElement<MaterialTabProps>(child)
        ? cloneElement(child, { value: child.props.value ?? index }) : child)}
    </TabsList>
  </Tabs>;
}
export function KetcherMaterialTab({ value = 0, label, icon, className, ...props }: MaterialTabProps) {
  return <TabsTrigger {...props} value={String(value)} aria-invalid={typeof className === "string" && className.includes("_errorTab") || undefined}>
    {controlIcons(icon)}{label}
  </TabsTrigger>;
}
export function KetcherMaterialAccordion({ expanded, defaultExpanded = false, onChange, disabled, children }: {
  expanded?: boolean; defaultExpanded?: boolean; disabled?: boolean; children: ReactNode; className?: string; square?: boolean;
  onChange?: (event: Event | undefined, expanded: boolean) => void;
}) {
  return <Accordion type="multiple" value={expanded === undefined ? undefined : expanded ? ["group"] : []}
    defaultValue={defaultExpanded ? ["group"] : []}
    onValueChange={value => onChange?.(undefined, value.includes("group"))}>
    <AccordionItem value="group" disabled={disabled}>{children}</AccordionItem>
  </Accordion>;
}
export function KetcherMaterialAccordionSummary({ children, className: _className, expandIcon: _expandIcon, ...props }:
  ComponentProps<typeof AccordionTrigger> & { expandIcon?: ReactNode }) {
  const content = Children.map(children, child => isValidElement<{ name?: string }>(child) && child.props.name === "elements-group"
    ? <Folder size={16} aria-hidden="true" /> : controlIcons(child));
  return <AccordionTrigger {...props}><span className="flex min-w-0 items-center gap-2">{content}</span></AccordionTrigger>;
}
export function KetcherMaterialAccordionDetails({ children }: { children: ReactNode; className?: string }) {
  return <AccordionContent>{children}</AccordionContent>;
}

function KetcherToolMenu({ primary, children, open, onOpenChange, disabled, testId, triggerTestId = "dropdown-expand", hidden = false, rootRef, rootTestId,
  label = "Tools", menuClassName = "", side = "bottom", rootClassName = "" }: {
  primary: ReactNode; children: ReactNode; open: boolean; onOpenChange: (open: boolean) => void;
  disabled?: boolean; testId?: string; triggerTestId?: string; hidden?: boolean; rootRef?: Ref<HTMLDivElement>; rootTestId?: string; rootClassName?: string;
  label?: string; menuClassName?: string; side?: "bottom" | "right";
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  // Ketcher's molecule toolbar toggles on every request, so only real changes go through.
  const openRef = useRef(open);
  openRef.current = open;
  const setOpen = (next: boolean) => { if (openRef.current !== next) onOpenChange(next); };
  return <div ref={rootRef} data-testid={rootTestId} className={`relative flex items-center ${rootClassName}`}>
    {primary}
    {!hidden && <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <KetcherToolTooltip label={`More ${label.toLowerCase()}`} disabled={disabled || open}>
      <DropdownMenuTrigger asChild><Button ref={anchor} variant="ghost" size="icon-toolbar" disabled={disabled}
        className="ketcher-tool-expand h-8 w-5 p-0" data-testid={triggerTestId} aria-label={`More ${label.toLowerCase()}`}><ChevronDown size={14} aria-hidden="true" /></Button></DropdownMenuTrigger>
      </KetcherToolTooltip>
      <DropdownMenuContent ref={content} className={`ketcher-ui-menu ${menuClassName}`} side={side} align="start" collisionPadding={8}
        onFocusOutside={event => {
          const target = event.target;
          if (!(target instanceof HTMLElement) || !target.matches("[data-cliparea]") || !target.closest(".ketcher-editor-shell")) return;
          event.preventDefault();
          requestAnimationFrame(() => {
            if (document.activeElement === target && content.current?.isConnected) content.current.focus();
          });
        }}
        container={document.fullscreenElement ?? anchor.current?.closest<HTMLElement>(".app-shell") ?? undefined} data-testid={testId} aria-label={label}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>}
  </div>;
}
