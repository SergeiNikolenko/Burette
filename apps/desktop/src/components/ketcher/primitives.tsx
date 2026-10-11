import { useEffect, useState, useRef, useId, isValidElement, type ComponentProps, type ComponentType, type ReactNode, type Ref } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectSeparator } from "@/components/ui/select";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import "./workspace.css";
import "./workspace-menus.css";
import "./workspace-tables.css";
import "./workspace-forms.css";
import { controlIcons } from "./control-icons";
import { KetcherToolTooltip } from "./tool-tooltip";
import { ChevronDown } from "@/components/ui/app-icons";
import { ScrubNumberField } from "@/components/ui/scrub-number-input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export function KetcherTabs({ tabs, tabIndex, changeTab, className, contentClassName }: {
  tabs: Array<{ caption: string; component?: ComponentType<Record<string, unknown>>; props?: Record<string, unknown> }>;
  tabIndex?: number; changeTab: (index: number) => void; className?: string; contentClassName?: string;
}) {
  const [active, setActive] = useState(tabIndex ?? 0);
  const initialChange = useRef(changeTab);
  useEffect(() => { initialChange.current(tabIndex ?? 0); }, []);
  useEffect(() => { setActive(tabIndex ?? 0); }, [tabIndex]);
  return <Tabs value={String(active)} onValueChange={value => { const index = Number(value); setActive(index); changeTab(index); }}
    className="ketcher-dialog-tabs">
    <TabsList variant="line" className={cn("ketcher-dialog-tablist", className)} aria-label="Structure format">
      {tabs.map(({ caption }, index) => <TabsTrigger key={caption} value={String(index)} data-testid={`${caption}-tab`}>{caption}</TabsTrigger>)}
    </TabsList>
    {tabs.map(({ caption, component: Content, props }, index) => <TabsContent key={caption} value={String(index)} className={contentClassName}>
      {Content && <Content {...props} />}
    </TabsContent>)}
  </Tabs>;
}

export function KetcherToolExpand({ onClick, disabled, expanded }: {
  onClick: () => void; disabled?: boolean; expanded: boolean;
}) {
  return <KetcherToolTooltip label="More tools" disabled={disabled || expanded}>
    <Button variant="ghost" size="icon" className="ketcher-tool-expand" onClick={onClick}
    disabled={disabled} aria-label="More tools" aria-expanded={expanded} aria-haspopup="true"
    data-testid="dropdown-expand"><ChevronDown size={14} aria-hidden="true" /></Button>
  </KetcherToolTooltip>;
}

// A split tool's tooltip opens past its chevron, so the chevron stays clickable.
function toolTooltipOffset(trigger: Element | null | undefined) {
  const button = trigger?.closest(".ketcher-tool-button");
  const expand = button?.nextElementSibling;
  if (!button || !expand?.classList.contains("ketcher-tool-expand")) return 2;
  return Math.max(2, expand.getBoundingClientRect().right - button.getBoundingClientRect().right + 2);
}

export function KetcherToolButton({ title, label, shortcut, className: _className, children, ...props }:
  ComponentProps<typeof Button> & { label?: string; shortcut?: string }) {
  const container = useFullscreenContainer();
  const [offset, setOffset] = useState(2);
  const button = <Button variant="ghost" size="icon" {...props} className="ketcher-tool-button"
    aria-label={props["aria-label"] ?? label ?? title}>{controlIcons(children)}</Button>;
  const trigger = useRef<HTMLButtonElement>(null);
  if (!label && !title) return button;
  return <TooltipProvider><Tooltip onOpenChange={open => {
    if (open) setOffset(toolTooltipOffset(trigger.current));
  }}><TooltipTrigger asChild><Button ref={trigger} variant="ghost" size="icon" {...props}
    className="ketcher-tool-button" aria-label={props["aria-label"] ?? label ?? title}>{controlIcons(children)}</Button></TooltipTrigger>
    <TooltipContent container={container} side="right" sideOffset={offset}><span>{label ?? title}</span>
      {shortcut && <kbd className="ml-2">{shortcut}</kbd>}
    </TooltipContent></Tooltip></TooltipProvider>;
}

export function KetcherAtomButton({ el, shortcut, selected, className: _className, ...props }: ComponentProps<typeof Button> & {
  el: { label: string; title: string; number: number }; shortcut?: string; selected?: boolean;
}) {
  return <KetcherToolButton {...props} label={el.title} shortcut={shortcut} value={el.number}
    aria-pressed={selected} data-testid={`${el.label}-button`}>
    <span className="ketcher-atom-label" data-element={el.label}>{el.label}</span>
  </KetcherToolButton>;
}
export function KetcherChemicalButton({ className: _className, ...props }: ComponentProps<typeof Button>) {
  const { title, ...rest } = props;
  const container = useFullscreenContainer();
  const button = <Button variant="ghost" size="sm" {...rest} />;
  return title ? <TooltipProvider><Tooltip><TooltipTrigger asChild>{button}</TooltipTrigger>
    <TooltipContent container={container}>{title}</TooltipContent></Tooltip></TooltipProvider> : button;
}

export function KetcherButton({ primary, isActive, children, "aria-label": label, ...props }: ComponentProps<typeof Button> & {
  primary?: boolean; isActive?: boolean;
}) {
  return <Button variant={primary ? "default" : "outline"} size="sm" aria-pressed={isActive}
    aria-label={label ?? (typeof children === "string" ? children : undefined)} {...props}>{children}</Button>;
}
export function KetcherInput(props: ComponentProps<typeof Input>) {
  return <Input autoComplete="off" {...props} />;
}

export function KetcherIconButton({ onClick, shortcut, title, className: _className, isActive, isHidden, disabled, testId, children }: {
  onClick?: ComponentProps<typeof Button>["onClick"]; shortcut?: string; title?: string;
  className?: string; isActive?: boolean; isHidden?: boolean; disabled?: boolean;
  testId?: string; children?: ReactNode;
}) {
  const container = useFullscreenContainer();
  if (isHidden || testId === "help-button" || testId === "about-button") return null;
  return <TooltipProvider><Tooltip>
    <TooltipTrigger asChild><Button variant="ghost" size="icon" className="ketcher-tool-button" onClick={onClick}
      aria-label={title} aria-pressed={isActive} disabled={disabled} data-testid={testId}>
      {controlIcons(children)}
    </Button></TooltipTrigger>
    <TooltipContent container={container} side="bottom"><span>{title}</span>{shortcut && <kbd className="ml-2">{shortcut}</kbd>}
    </TooltipContent>
  </Tooltip></TooltipProvider>;
}

function useFullscreenContainer() {
  const [container, setContainer] = useState(() => document.fullscreenElement as HTMLElement | null);
  useEffect(() => {
    const update = () => setContainer(document.fullscreenElement as HTMLElement | null);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  return container ?? undefined;
}

// Enter confirms a dialog only from plain text fields; controls that act on
// Enter themselves (buttons, links, toggles, pickers) keep it.
const enterOwnedBy = [
  "textarea", "button", "summary", "a", "select", "[contenteditable]:not([contenteditable=\"false\"])",
  "input:is([type=checkbox],[type=radio],[type=range],[type=button],[type=submit],[type=reset],[type=file],[type=color])",
  ...["button", "switch", "checkbox", "radio", "slider", "combobox", "listbox", "option", "tab", "menu", "menuitem"].map(role => `[role="${role}"]`),
].join(", ");

type DialogProps = Omit<ComponentProps<typeof DialogContent>, "title" | "children" | "className"> & {
  children?: ReactNode; title?: string; headerContent?: ReactNode; footerContent?: ReactNode;
  className?: string; buttons?: Array<string | ReactNode>; buttonsNameMap?: Record<string, string>;
  focusable?: boolean; needMargin?: boolean; withDivider?: boolean; testId?: string;
  primaryButtons?: string[]; result?: () => unknown; valid?: () => boolean;
  params?: { onOk: (value: unknown) => void; onCancel: (value: unknown) => void; className?: string; isNestedModal?: boolean };
};
export function KetcherDialog({ children, title, headerContent, footerContent, className, params,
  buttons = ["OK"], buttonsNameMap, primaryButtons, result = () => null, valid = () => Boolean(result()),
  focusable = true, needMargin: _needMargin, withDivider: _withDivider, testId: _testId, ...rest
}: DialogProps) {
  const origin = useRef(document.activeElement);
  const container = useFullscreenContainer();
  const cancel = () => params?.onCancel?.(result());
  const confirm = () => { if (valid()) params?.onOk?.(result()); };
  return <Dialog open onOpenChange={(open) => { if (!open) cancel(); }}>
    <DialogContent {...rest} container={container} onOpenAutoFocus={(event) => {
      event.preventDefault();
      if (focusable) (event.currentTarget as HTMLElement).focus();
    }} data-testid="info-modal-window" className="ketcher-ui-dialog" aria-describedby={undefined}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        const target = origin.current;
        if (target instanceof HTMLElement && target.isConnected) target.focus();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing && event.target instanceof HTMLInputElement && !event.defaultPrevented && !event.target.closest(enterOwnedBy)) {
          event.preventDefault(); event.stopPropagation(); confirm();
        }
      }}
      // Ketcher's forms have no action: a native submission (Enter on a form
      // control, a default-type button) would reload the editor page.
      onSubmit={(event) => { event.preventDefault(); rest.onSubmit?.(event); }}>
      <DialogHeader><DialogTitle asChild><div>{headerContent || title || (className?.includes("About-module") ? "About Ketcher" : "Structure properties")}</div></DialogTitle></DialogHeader>
      <div className={cn("ketcher-ui-dialog-body", className, params?.className)} data-testid="info-modal-body">{children}</div>
      {(footerContent || buttons.length > 0) && <DialogFooter>
        {footerContent}
        {buttons.map((button, index) => {
          if (typeof button !== "string") {
            if (isValidElement<ComponentProps<typeof Button>>(button) && button.type === "button") {
              return <Button key={index} {...button.props} variant="outline" size="sm" className="" />;
            }
            return <span key={index}>{button}</span>;
          }
          const isConfirm = button === "OK" || button === "Save";
          return <Button key={button} size="sm" data-testid={button}
            variant={(primaryButtons?.length ? primaryButtons.includes(button) : isConfirm) ? "default" : "outline"}
            disabled={isConfirm && !valid()} onClick={isConfirm ? confirm : cancel}>
            {buttonsNameMap?.[button] ?? button}
          </Button>;
        })}
      </DialogFooter>}
    </DialogContent>
  </Dialog>;
}

type Option = { value: string | number | boolean; label: string; children?: ReactNode; disabled?: boolean; markedAsUsed?: boolean };
export function KetcherSelect({ options, value, onChange, disabled, placeholder, className, name, error, title, "data-testid": testId }: {
  options: Option[]; value?: string | number | boolean; onChange: (value: string | number | boolean) => void; disabled?: boolean;
  placeholder?: string; className?: string; name?: string; error?: boolean; title?: string; "data-testid"?: string;
}) {
  // Radix reserves the empty string for an unset selection. Ketcher uses it as
  // a real enum value (e.g. unspecified stereochemistry), so encode by index.
  const container = useFullscreenContainer();
  const index = options.findIndex((option) => String(option.value) === String(value));
  return <Select value={index < 0 ? "" : String(index)} onValueChange={(key) => { if (key !== "") onChange(options[Number(key)].value); }} disabled={disabled} name={name}>
    <SelectTrigger size="sm" className={cn("ketcher-ui-select", className)} data-testid={testId} title={title} aria-label={name || testId || placeholder} aria-invalid={error}>
      <SelectValue placeholder={placeholder} />
    </SelectTrigger>
    <SelectContent container={container} className="ketcher-ui-options" position="popper">
      {options.map((option, i) => String(option.value).includes("Divider")
        ? <SelectSeparator key={i} />
        : <SelectItem key={i} value={String(i)} disabled={option.disabled} title={option.markedAsUsed ? "Already in use" : undefined} data-testid={`${option.label}-option`}>{option.children ?? option.label}</SelectItem>)}
    </SelectContent>
  </Select>;
}

export function KetcherSettingsAccordion({ tabs, changedGroups, className }: {
  tabs: Array<{ key: string; label: string; content: ReactNode }>; changedGroups: Set<string>; className?: string;
}) {
  const [active, setActive] = useState(tabs[0]?.key);
  const id = useId();
  return <div className={cn("ketcher-settings-groups ketcher-settings-layout", className)}>
    <div className="ketcher-settings-nav" role="tablist" aria-label="Editor settings" aria-orientation="vertical">
      {tabs.map(({ key, label }) => <Button variant="ghost" size="sm" type="button" key={key} id={`${id}-${key}-tab`} role="tab"
        aria-controls={`${id}-${key}-panel`} aria-selected={active === key} tabIndex={active === key ? 0 : -1}
        data-testid={`${label}-accordion`} onClick={() => setActive(key)} onKeyDown={event => {
          if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const index = tabs.findIndex(tab => tab.key === key);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
            : (index + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
          setActive(tabs[next].key);
          document.getElementById(`${id}-${tabs[next].key}-tab`)?.focus();
        }}>{label}{changedGroups.has(label) && <span aria-label="Modified">*</span>}</Button>)}
    </div>
    <div className="ketcher-settings-panels">{tabs.map(({ key, content }) => <section key={key} id={`${id}-${key}-panel`}
      role="tabpanel" aria-labelledby={`${id}-${key}-tab`} hidden={active !== key}>{content}</section>)}</div>
  </div>;
}

export function KetcherAccordion({ summary, details, expanded, className, onSummaryClick, dataTestIdDetails }: {
  summary: ReactNode; details: ReactNode; expanded: boolean; className?: string;
  onSummaryClick: () => void; dataTestIdDetails?: string;
}) {
  return <Collapsible open={expanded} onOpenChange={onSummaryClick} className={className}>
    <CollapsibleTrigger asChild><Button variant="ghost" className="w-full justify-start">{summary}</Button></CollapsibleTrigger>
    <CollapsibleContent data-testid={dataTestIdDetails}>{details}</CollapsibleContent>
  </Collapsible>;
}

// The retained GenericInput.val codec reads only target.type and target.value.
// It converts integer schemas to numbers and leaves decimal schemas as strings.
type KetcherInputEvent = { target: { type: string; value: string } };
type NumericSchema = { type: "number" | "integer"; title?: string; minimum?: number; maximum?: number; multipleOf?: number };
function isNumericSchema(schema: unknown): schema is NumericSchema {
  return typeof schema === "object" && schema !== null && "type" in schema
    && (schema.type === "number" || schema.type === "integer");
}
type FieldProps = Omit<ComponentProps<typeof Input>, "ref" | "onChange"> & {
  onChange?: (event: KetcherInputEvent) => void;
  schema?: unknown; innerRef?: Ref<HTMLInputElement>; isFocused?: boolean;
  extraValue?: unknown; extraSchema?: unknown; onExtraChange?: (value: unknown) => void;
};
export function KetcherGenericInput({ schema, extraValue: _extraValue, extraSchema: _extraSchema, onExtraChange: _onExtraChange, innerRef, isFocused, value, ...props }: FieldProps) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (isFocused) ref.current?.focus(); }, [isFocused]);
  const filled = typeof value === "number" || (typeof value === "string" && value.trim() !== "");
  // Nullable/query fields and imperative focus/ref contracts retain the native
  // input until ScrubNumberField provides equivalent empty-value/ref support.
  if (isNumericSchema(schema) && filled && Number.isFinite(Number(value)) && !innerRef && !isFocused) {
    const { onChange, type: _type, defaultValue: _defaultValue, size: _size, min, max, step, className, ...inputProps } = props;
    const increment = typeof step === "number" && step > 0 ? step
      : typeof schema.multipleOf === "number" && schema.multipleOf > 0 ? schema.multipleOf
        : schema.type === "integer" ? 1 : 0.1;
    return <div className="ketcher-numeric-slot"><ScrubNumberField {...inputProps} value={Number(value)}
      min={typeof min === "number" ? min : schema.minimum} max={typeof max === "number" ? max : schema.maximum}
      step={increment} smallStep={schema.type === "integer" ? increment : increment / 10} largeStep={increment * 10}
      className={cn("ketcher-numeric-field", className)} inputClassName="ketcher-numeric-control"
      aria-label={inputProps["aria-label"] ?? schema.title ?? inputProps.name}
      onValueChange={next => onChange?.({ target: { type: "text", value: String(schema.type === "integer" ? Math.round(next) : next) } })} /></div>;
  }
  return <Input {...props} value={value ?? ""} ref={(node) => {
    ref.current = node;
    if (typeof innerRef === "function") innerRef(node);
    else if (innerRef) innerRef.current = node;
  }} />;
}
export function KetcherTextarea({ schema: _schema, extraValue: _extraValue, extraSchema: _extraSchema, onExtraChange: _onExtraChange, innerRef, onChange, value, ...props }: Omit<ComponentProps<typeof Textarea>, "ref" | "onChange"> & { schema?: unknown; extraValue?: unknown; extraSchema?: unknown; onExtraChange?: (value: unknown) => void; innerRef?: Ref<HTMLTextAreaElement>; onChange?: ComponentProps<typeof Textarea>["onInput"] }) {
  return <Textarea {...props} value={value ?? ""} ref={innerRef} onInput={onChange} />;
}

type CheckedEvent = { target: { checked: boolean }; stopPropagation: () => void };
type CheckedProps = {
  value?: unknown; onChange: (event: CheckedEvent) => void; name?: string; disabled?: boolean;
  id?: string; "data-testid"?: string; "aria-label"?: string;
};
// The retained upstream .val codec reads only target.checked and stops the
// event. Emit it once; Ketcher's old native control called both click/change.
function checkedEvent(checked: boolean): CheckedEvent { return { target: { checked }, stopPropagation() {} }; }
export function KetcherCheckbox({ value, onChange, ...props }: CheckedProps) {
  const { name, disabled, id, "data-testid": testId, "aria-label": label } = props;
  return <Checkbox name={name} disabled={disabled} id={id} data-testid={testId} aria-label={label || name || testId}
    onClick={(event) => event.stopPropagation()} checked={Boolean(value)} onCheckedChange={(checked) => onChange(checkedEvent(checked === true))} />;
}
export function KetcherSwitch({ value, onChange, ...props }: CheckedProps) {
  const { name, disabled, id, "data-testid": testId, "aria-label": label } = props;
  return <Switch name={name} disabled={disabled} id={id} data-testid={testId} aria-label={label || name || testId}
    onClick={(event) => event.stopPropagation()} checked={Boolean(value)} onCheckedChange={(checked) => onChange(checkedEvent(checked))} />;
}
