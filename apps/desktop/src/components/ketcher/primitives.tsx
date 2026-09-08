import { useEffect, useState, useRef, isValidElement, type ComponentProps, type ReactNode, type Ref } from "react";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
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
import { controlIcons } from "./control-icons";
import { ChevronDown } from "@/components/ui/app-icons";

export function KetcherToolExpand({ onClick, disabled, expanded }: {
  onClick: () => void; disabled?: boolean; expanded: boolean;
}) {
  return <Button variant="ghost" size="icon" className="ketcher-tool-expand" onClick={onClick}
    disabled={disabled} aria-label="More tools" aria-expanded={expanded} aria-haspopup="true"
    data-testid="dropdown-expand"><ChevronDown size={14} aria-hidden="true" /></Button>;
}

export function KetcherToolButton(props: ComponentProps<typeof Button>) {
  return <Button variant="ghost" size="icon" {...props}>{controlIcons(props.children)}</Button>;
}

export function KetcherButton({ primary, isActive, children, "aria-label": label, ...props }: ComponentProps<typeof Button> & {
  primary?: boolean; isActive?: boolean;
}) {
  return <Button variant={primary ? "default" : "outline"} size="sm" aria-pressed={isActive}
    aria-label={label ?? (typeof children === "string" ? children : undefined)} {...props}>{children}</Button>;
}
export function KetcherInput(props: ComponentProps<typeof Input>) {
  return <Input {...props} />;
}

export function KetcherIconButton({ onClick, shortcut, title, className, isActive, isHidden, disabled, testId, children }: {
  onClick?: ComponentProps<typeof Button>["onClick"]; shortcut?: string; title?: string;
  className?: string; isActive?: boolean; isHidden?: boolean; disabled?: boolean;
  testId?: string; children?: ReactNode;
}) {
  const container = useFullscreenContainer();
  if (isHidden || testId === "help-button" || testId === "about-button") return null;
  const label = shortcut ? `${title} (${shortcut})` : title;
  return <TooltipProvider delayDuration={350}><Tooltip>
    <TooltipTrigger asChild>
      <Button variant="ghost" size="icon" className={cn("ketcher-tool-button", className)} onClick={onClick}
        aria-label={title} aria-pressed={isActive} disabled={disabled} data-testid={testId}>
        {controlIcons(children)}
      </Button>
    </TooltipTrigger>
    <TooltipContent container={container} className="ketcher-ui-tooltip" side="bottom" sideOffset={4} showArrow={false}>{label}</TooltipContent>
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
        if (event.key === "Enter" && !event.nativeEvent.isComposing && event.target instanceof HTMLElement && event.target.tagName !== "TEXTAREA" && !event.defaultPrevented && !event.target.closest('[role="combobox"], [role="listbox"]')) {
          event.preventDefault(); event.stopPropagation(); confirm();
        }
      }}>
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

type Option = { value: string | number | boolean; label: string; children?: ReactNode };
export function KetcherSelect({ options, value, onChange, disabled, placeholder, className, name, error, "data-testid": testId }: {
  options: Option[]; value?: string | number | boolean; onChange: (value: string | number | boolean) => void; disabled?: boolean;
  placeholder?: string; className?: string; name?: string; error?: boolean; "data-testid"?: string;
}) {
  // Radix reserves the empty string for an unset selection. Ketcher uses it as
  // a real enum value (e.g. unspecified stereochemistry), so encode by index.
  const container = useFullscreenContainer();
  const index = options.findIndex((option) => String(option.value) === String(value));
  return <Select value={index < 0 ? "" : String(index)} onValueChange={(key) => { if (key !== "") onChange(options[Number(key)].value); }} disabled={disabled} name={name}>
    <SelectTrigger size="sm" className={cn("ketcher-ui-select", className)} data-testid={testId} aria-label={name || testId || placeholder} aria-invalid={error}>
      <SelectValue placeholder={placeholder} />
    </SelectTrigger>
    <SelectContent container={container} className="ketcher-ui-options" position="popper">
      {options.map((option, i) => String(option.value).includes("Divider")
        ? <SelectSeparator key={i} />
        : <SelectItem key={i} value={String(i)} data-testid={`${option.label}-option`}>{option.children ?? option.label}</SelectItem>)}
    </SelectContent>
  </Select>;
}

export function KetcherSettingsAccordion({ tabs, changedGroups, className }: {
  tabs: Array<{ key: string; label: string; content: ReactNode }>; changedGroups: Set<string>; className?: string;
}) {
  const [expanded, setExpanded] = useState(["General"]);
  return <Accordion type="multiple" value={expanded} onValueChange={setExpanded} className={cn("ketcher-settings-groups", className)}>
    {tabs.map(({ key, label, content }) => <AccordionItem key={key} value={label}>
      <AccordionTrigger data-testid={`${label}-accordion`}>{label}{changedGroups.has(label) && <span className="text-xs text-muted-foreground">Modified</span>}</AccordionTrigger>
      <AccordionContent forceMount style={{ display: expanded.includes(label) ? undefined : "none" }}>{content}</AccordionContent>
    </AccordionItem>)}
  </Accordion>;
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

type FieldProps = Omit<ComponentProps<typeof Input>, "ref"> & {
  schema?: unknown; innerRef?: Ref<HTMLInputElement>; isFocused?: boolean;
  extraValue?: unknown; extraSchema?: unknown; onExtraChange?: (value: unknown) => void;
};
export function KetcherGenericInput({ schema: _schema, extraValue: _extraValue, extraSchema: _extraSchema, onExtraChange: _onExtraChange, innerRef, isFocused, value, ...props }: FieldProps) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (isFocused) ref.current?.focus(); }, [isFocused]);
  return <Input {...props} value={value ?? ""} ref={(node) => {
    ref.current = node;
    if (typeof innerRef === "function") innerRef(node);
    else if (innerRef) innerRef.current = node;
  }} />;
}
export function KetcherTextarea({ schema: _schema, innerRef, onChange, value, ...props }: Omit<ComponentProps<typeof Textarea>, "ref" | "onChange"> & { schema?: unknown; innerRef?: Ref<HTMLTextAreaElement>; onChange?: ComponentProps<typeof Textarea>["onInput"] }) {
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
