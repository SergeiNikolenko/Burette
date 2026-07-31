export type MesoscalePanelResizeAxis = "left" | "right" | "bottom";
export type MesoscalePanelPoint = { x: number; y: number };
export type MesoscalePanelRect = { left: number; top: number; right: number; bottom: number; width: number; height: number };

const SIDE_MIN = 220;
const CANVAS_MIN_WIDTH = 240;
const BOTTOM_MIN = 200;
const CANVAS_MIN_HEIGHT = 180;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function nextMesoscalePanelSize(axis: MesoscalePanelResizeAxis, point: MesoscalePanelPoint, rect: MesoscalePanelRect, oppositePanelSize = 0) {
  if (axis === "left") return clamp(point.x - rect.left, SIDE_MIN, rect.width - CANVAS_MIN_WIDTH - oppositePanelSize);
  if (axis === "right") return clamp(rect.right - point.x, SIDE_MIN, rect.width - CANVAS_MIN_WIDTH - oppositePanelSize);
  return clamp(rect.bottom - point.y, BOTTOM_MIN, rect.height - CANVAS_MIN_HEIGHT);
}

type InstallOptions = {
  root: HTMLElement;
  onResize: () => void;
  onReservations: (reservation: { left: number; right: number }) => void;
};

export function installMesoscalePanelResizeHandles({ root, onResize, onReservations }: InstallOptions) {
  const sizes: Record<MesoscalePanelResizeAxis, number> = { left: 330, right: 300, bottom: 361 };
  const handles = new Map<MesoscalePanelResizeAxis, HTMLDivElement>();
  let resizeFrame = 0;
  let mouseAxis: MesoscalePanelResizeAxis | null = null;

  const portrait = () => window.matchMedia("(orientation: portrait) and (max-width: 1000px)").matches;
  const layout = () => root.querySelector<HTMLElement>(".msp-layout-region.msp-layout-main")?.parentElement ?? null;
  const scheduleResize = () => {
    if (resizeFrame) return;
    resizeFrame = window.requestAnimationFrame(() => {
      resizeFrame = 0;
      onResize();
    });
  };
  const setSize = (axis: MesoscalePanelResizeAxis, size: number) => {
    sizes[axis] = Math.round(size);
    root.style.setProperty(`--buret-meso-${axis}-${axis === "bottom" ? "height" : "width"}`, `${sizes[axis]}px`);
    const handle = handles.get(axis);
    if (handle) handle.setAttribute("aria-valuenow", String(sizes[axis]));
  };
  const resizeAt = (axis: MesoscalePanelResizeAxis, point: MesoscalePanelPoint) => {
    const classes = layout()?.classList;
    const oppositePanelSize = axis === "left" && classes && !classes.contains("msp-layout-hide-right")
      ? sizes.right
      : axis === "right" && classes && !classes.contains("msp-layout-hide-left") ? sizes.left : 0;
    setSize(axis, nextMesoscalePanelSize(axis, point, root.getBoundingClientRect(), oppositePanelSize));
    syncVisibility();
  };
  const syncVisibility = () => {
    const classes = layout()?.classList;
    const leftVisible = Boolean(classes && !classes.contains("msp-layout-hide-left"));
    const rightVisible = Boolean(classes && !classes.contains("msp-layout-hide-right"));
    const isPortrait = portrait();
    const leftReservation = !isPortrait && leftVisible ? sizes.left : 0;
    const rightReservation = !isPortrait && rightVisible ? sizes.right : 0;
    const bottomReservation = isPortrait && (leftVisible || rightVisible) ? sizes.bottom : 0;
    root.style.setProperty("--buret-meso-left-reservation", `${leftReservation}px`);
    root.style.setProperty("--buret-meso-right-reservation", `${rightReservation}px`);
    root.style.setProperty("--buret-meso-bottom-reservation", `${bottomReservation}px`);
    const leftHandle = handles.get("left");
    const rightHandle = handles.get("right");
    const bottomHandle = handles.get("bottom");
    const rect = root.getBoundingClientRect();
    leftHandle?.setAttribute("aria-valuemax", String(Math.max(SIDE_MIN, Math.round(rect.width - CANVAS_MIN_WIDTH))));
    rightHandle?.setAttribute("aria-valuemax", String(Math.max(SIDE_MIN, Math.round(rect.width - CANVAS_MIN_WIDTH))));
    bottomHandle?.setAttribute("aria-valuemax", String(Math.max(BOTTOM_MIN, Math.round(rect.height - CANVAS_MIN_HEIGHT))));
    if (leftHandle) leftHandle.hidden = isPortrait || !leftVisible;
    if (rightHandle) rightHandle.hidden = isPortrait || !rightVisible;
    if (bottomHandle) bottomHandle.hidden = !isPortrait || (!leftVisible && !rightVisible);
    onReservations({ left: leftReservation, right: rightReservation });
    scheduleResize();
  };

  for (const axis of ["left", "right", "bottom"] as const) {
    const handle = document.createElement("div");
    handle.className = "buret-meso-panel-resizer";
    handle.dataset.axis = axis;
    handle.tabIndex = 0;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-label", axis === "bottom" ? "Resize Mol* panels" : `Resize Mol* ${axis} panel`);
    handle.setAttribute("aria-orientation", axis === "bottom" ? "horizontal" : "vertical");
    handle.setAttribute("aria-valuemin", String(axis === "bottom" ? BOTTOM_MIN : SIDE_MIN));
    handle.setAttribute("aria-valuenow", String(sizes[axis]));
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      handle.setPointerCapture(event.pointerId);
      handle.classList.add("dragging");
    });
    handle.addEventListener("pointermove", (event) => {
      if (!handle.hasPointerCapture(event.pointerId)) return;
      event.preventDefault();
      event.stopPropagation();
      resizeAt(axis, event);
    });
    const finish = (event: PointerEvent) => {
      if (!handle.hasPointerCapture(event.pointerId)) return;
      handle.releasePointerCapture(event.pointerId);
      handle.classList.remove("dragging");
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      mouseAxis = axis;
      handle.classList.add("dragging");
    });
    handle.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const rect = root.getBoundingClientRect();
      const minimum = axis === "bottom" ? BOTTOM_MIN : SIDE_MIN;
      const maximum = axis === "bottom" ? Math.max(minimum, rect.height - CANVAS_MIN_HEIGHT) : Math.max(minimum, rect.width - CANVAS_MIN_WIDTH);
      const direction = axis === "right" || axis === "bottom" ? -1 : 1;
      const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -12 : 12;
      setSize(axis, event.key === "Home" ? minimum : event.key === "End" ? maximum : clamp(sizes[axis] + delta * direction, minimum, maximum));
      syncVisibility();
    });
    handles.set(axis, handle);
    root.append(handle);
  }

  const onMouseMove = (event: MouseEvent) => {
    if (!mouseAxis || (event.buttons & 1) === 0) return;
    event.preventDefault();
    event.stopPropagation();
    resizeAt(mouseAxis, event);
  };
  const onMouseUp = (event: MouseEvent) => {
    if (event.button !== 0 || !mouseAxis) return;
    handles.get(mouseAxis)?.classList.remove("dragging");
    mouseAxis = null;
  };

  setSize("left", sizes.left);
  setSize("right", sizes.right);
  setSize("bottom", sizes.bottom);
  const observer = new MutationObserver(syncVisibility);
  observer.observe(root, { subtree: true, attributes: true, attributeFilter: ["class"] });
  window.addEventListener("resize", syncVisibility);
  window.addEventListener("mousemove", onMouseMove, true);
  window.addEventListener("mouseup", onMouseUp, true);
  syncVisibility();

  return () => {
    observer.disconnect();
    window.removeEventListener("resize", syncVisibility);
    window.removeEventListener("mousemove", onMouseMove, true);
    window.removeEventListener("mouseup", onMouseUp, true);
    if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
    handles.forEach((handle) => handle.remove());
  };
}
