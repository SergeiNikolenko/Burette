import { useRef, createContext, useContext, type ReactNode, type ReactElement, type RefObject, type Ref, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "@/components/ui/app-icons";
import { controlIcons } from "./control-icons";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuShortcut, DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";

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
    <DropdownMenuTrigger asChild><Button ref={buttonRef} variant="ghost" size="sm" disabled={disabled}
      data-testid="polymer-toggler" aria-label={isPolymerEditor ? "Macromolecules" : "Molecules"} title={isPolymerEditor ? "Macromolecules" : "Molecules"}>
      {icon}
    </Button></DropdownMenuTrigger>
    <DropdownMenuContent className="ketcher-ui-menu" container={document.fullscreenElement ?? buttonRef.current?.closest<HTMLElement>(".app-shell") ?? undefined}>
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
  return inMenu
    ? <DropdownMenuItem data-testid={testId} disabled={disabled} onSelect={onClick}>{icon}{title}</DropdownMenuItem>
    : <Button variant="ghost" size={text ? "sm" : "icon"} className={className} title={title} aria-label={title} data-testid={testId} disabled={disabled}
        aria-pressed={active} onClick={onClick}>{controlIcons(icon)}</Button>;
}

function KetcherToolMenu({ primary, children, open, onOpenChange, disabled, testId, triggerTestId = "dropdown-expand", hidden = false, rootRef, rootTestId }: {
  primary: ReactNode; children: ReactNode; open: boolean; onOpenChange: (open: boolean) => void;
  disabled?: boolean; testId?: string; triggerTestId?: string; hidden?: boolean; rootRef?: Ref<HTMLDivElement>; rootTestId?: string;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  return <div ref={rootRef} data-testid={rootTestId} className="relative flex items-center">
    {primary}
    {!hidden && <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild><Button ref={anchor} variant="ghost" size="icon" disabled={disabled}
        className="ketcher-tool-expand h-8 w-5 p-0" data-testid={triggerTestId} aria-label="More tools"><ChevronDown size={14} /></Button></DropdownMenuTrigger>
      <DropdownMenuContent className="ketcher-ui-menu" container={document.fullscreenElement ?? anchor.current?.closest<HTMLElement>(".app-shell") ?? undefined} data-testid={testId}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>}
  </div>;
}
