import { Children, cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactElement, type ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuPortal, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type TriggerEvent = MouseEvent | TouchEvent | KeyboardEvent;
type MenuRequest = {
  id: string | number;
  event: TriggerEvent | { nativeEvent: TriggerEvent; preventDefault: () => void };
  props?: Record<string, unknown>;
  position?: { x: number; y: number };
};
type MenuPayload = { triggerEvent: TriggerEvent; propsFromTrigger?: Record<string, unknown> };
type HandlerParams = { id?: string; triggerEvent?: TriggerEvent; props?: Record<string, unknown>; data?: unknown };
type Predicate = boolean | ((params: HandlerParams) => boolean);
const listeners = new Set<(request: MenuRequest | null) => void>();
const PayloadContext = createContext<Partial<MenuPayload>>({});
const PortalContainerContext = createContext<Element | null | undefined>(undefined);

function show(request: MenuRequest) {
  request.event.preventDefault();
  const event = "nativeEvent" in request.event ? request.event.nativeEvent : request.event;
  event.stopPropagation();
  for (const listener of listeners) listener(request);
}
function hideAll() {
  for (const listener of listeners) listener(null);
}
// This is the only imperative API used by Ketcher's molecule canvas. Its original
// hit testing, menu family selection and chemistry handlers stay in Ketcher.
export function useContextMenu(defaults?: { id: string | number }) {
  const defaultId = defaults?.id;
  const showMenu = useCallback((request: Omit<MenuRequest, "id"> & { id?: string | number }) => {
    const id = request.id ?? defaultId;
    if (id !== undefined) show({ ...request, id });
  }, [defaultId]);
  return { show: showMenu, hideAll };
}

function passPayload(children: ReactNode, payload: MenuPayload) {
  return Children.map(children, (child) => isValidElement(child)
    ? cloneElement(child as ReactElement<Partial<MenuPayload>>, payload) : child);
}

export function Menu({ id, children, onVisibilityChange }: {
  id: string | number; children: ReactNode; onVisibilityChange?: (visible: boolean) => void;
}) {
  const [request, setRequest] = useState<MenuRequest | null>(null);
  const visible = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const visibilityCallback = useRef(onVisibilityChange);
  visibilityCallback.current = onVisibilityChange;
  useEffect(() => {
    const receive = (next: MenuRequest | null) => {
      const active = next?.id === id ? next : null;
      setRequest(active);
      if (visible.current !== Boolean(active)) {
        visible.current = Boolean(active);
        visibilityCallback.current?.(visible.current);
      }
    };
    listeners.add(receive);
    return () => {
      listeners.delete(receive);
      if (visible.current) visibilityCallback.current?.(false);
    };
  }, [id]);
  // The original menus dismiss when the window changes. Radix handles outside
  // pointer dismissal and Escape without stealing input from open dialogs.
  useEffect(() => {
    if (!request) return;
    const dismiss = () => hideAll();
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    window.addEventListener("scroll", dismiss);
    document.addEventListener("fullscreenchange", dismiss);
    return () => {
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("scroll", dismiss);
      document.removeEventListener("fullscreenchange", dismiss);
    };
  }, [request]);
  if (!request) return null;
  const event = "nativeEvent" in request.event ? request.event.nativeEvent : request.event;
  const point = request.position ?? ("changedTouches" in event
    ? { x: event.changedTouches[0]?.clientX ?? 0, y: event.changedTouches[0]?.clientY ?? 0 }
    : { x: "clientX" in event ? event.clientX : 0, y: "clientY" in event ? event.clientY : 0 });
  const container = document.fullscreenElement ?? (event.target instanceof Element ? event.target.closest<HTMLElement>(".app-shell") : undefined);
  const payload = { triggerEvent: event, propsFromTrigger: request.props };
  return <PortalContainerContext.Provider value={container}><PayloadContext.Provider value={payload}>
    <DropdownMenu open onOpenChange={(open) => { if (!open) hideAll(); }} modal={false}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden style={{ position: "fixed", left: point.x, top: point.y, width: 1, height: 1, pointerEvents: "none" }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent ref={contentRef} container={container} align="start" sideOffset={0} collisionPadding={8}
        data-ketcher-context-menu={id}
        // Ketcher restores its clipboard textarea focus after a right click.
        // Return focus to the menu so arrow keys work, but allow other controls
        // (including dialogs opened by menu items) to take focus normally.
        onFocusOutside={(focusEvent) => {
          const target = focusEvent.target;
          if (!(target instanceof HTMLElement) || !target.matches("[data-cliparea]") || !target.closest(".ketcher-editor-shell")) return;
          focusEvent.preventDefault();
          requestAnimationFrame(() => {
            if (document.activeElement === target && contentRef.current?.isConnected) contentRef.current.focus();
          });
        }}
        onCloseAutoFocus={(closeEvent) => closeEvent.preventDefault()}>
        {passPayload(children, payload)}
      </DropdownMenuContent>
    </DropdownMenu>
  </PayloadContext.Provider></PortalContainerContext.Provider>;
}

type ItemProps = Omit<HTMLAttributes<HTMLDivElement>, "onClick" | "hidden"> & Partial<MenuPayload> & {
  data?: unknown; disabled?: Predicate; hidden?: Predicate; closeOnClick?: boolean;
  onClick?: (params: HandlerParams & { event: Event }) => void;
};
const evaluate = (value: Predicate | undefined, params: HandlerParams) => typeof value === "function" ? value(params) : Boolean(value);
function useParams({ id, data, triggerEvent, propsFromTrigger }: Partial<ItemProps>): HandlerParams {
  const inherited = useContext(PayloadContext);
  return { id, data, triggerEvent: triggerEvent ?? inherited.triggerEvent, props: propsFromTrigger ?? inherited.propsFromTrigger };
}

export function Item({ children, disabled, hidden, closeOnClick = true, onClick, triggerEvent, propsFromTrigger, data, id, ...attributes }: ItemProps) {
  const params = useParams({ id, data, triggerEvent, propsFromTrigger });
  if (evaluate(hidden, params)) return null;
  return <DropdownMenuItem {...attributes} id={id} disabled={evaluate(disabled, params)} onSelect={(event) => {
    if (!closeOnClick) event.preventDefault();
    onClick?.({ ...params, event });
  }}>{children}</DropdownMenuItem>;
}

export function Submenu({ children, label, disabled, hidden, triggerEvent, propsFromTrigger, data, id, ...attributes }: Omit<ItemProps, "onClick"> & { label: ReactNode; arrow?: ReactNode }) {
  const params = useParams({ id, data, triggerEvent, propsFromTrigger });
  const container = useContext(PortalContainerContext);
  if (evaluate(hidden, params)) return null;
  return <DropdownMenuSub>
    <DropdownMenuSubTrigger {...attributes} id={id} disabled={evaluate(disabled, params)}>{label}</DropdownMenuSubTrigger>
    <DropdownMenuPortal container={container}>
      <DropdownMenuSubContent collisionPadding={8} className="max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto">{children}</DropdownMenuSubContent>
    </DropdownMenuPortal>
  </DropdownMenuSub>;
}

export function Separator({ hidden, triggerEvent, propsFromTrigger, data }: {
  hidden?: Predicate; data?: unknown; triggerEvent?: TriggerEvent; propsFromTrigger?: Record<string, unknown>; style?: CSSProperties;
}) {
  const params = useParams({ data, triggerEvent, propsFromTrigger });
  return evaluate(hidden, params) ? null : <DropdownMenuSeparator />;
}
