export const MERMAID_CANVAS_HEIGHT = 480;

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const BUTTON_ZOOM_FACTOR = 1.2;
const KEY_ZOOM_FACTOR = 1.15;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const KEY_PAN_STEP = 24;
const FIT_MARGIN_PX = 16;

export type MermaidCanvasOptions = {
  svgHtml: string;
  ariaLabel: string;
  editMode: boolean;
  onToggleEdit: () => void;
};

type CanvasState = {
  zoom: number;
  panX: number;
  panY: number;
};

export function mountMermaidCanvas(host: HTMLElement, opts: MermaidCanvasOptions): void {
  host.replaceChildren();
  host.classList.add("cm-mermaid-canvas");
  host.tabIndex = 0;

  const viewport = document.createElement("div");
  viewport.className = "cm-mermaid-canvas-viewport";

  const stage = document.createElement("div");
  stage.className = "cm-mermaid-canvas-stage";
  stage.innerHTML = opts.svgHtml;
  stage.style.opacity = "0";

  const svg = stage.querySelector("svg") as SVGSVGElement | null;
  if (svg) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", opts.ariaLabel);
  }

  viewport.append(stage);
  host.append(viewport);

  const editButton = makeButton(
    opts.editMode ? "Preview" : "Edit code",
    opts.editMode ? "Return to preview" : "Edit code",
  );
  editButton.classList.add("cm-mermaid-canvas-edit");

  const zoomCluster = document.createElement("div");
  zoomCluster.className = "cm-mermaid-canvas-zoom";
  const zoomInButton = makeButton("+", "Zoom in");
  const zoomOutButton = makeButton("-", "Zoom out");
  zoomInButton.classList.add("cm-mermaid-canvas-zoom-btn");
  zoomOutButton.classList.add("cm-mermaid-canvas-zoom-btn");
  zoomCluster.append(zoomInButton, zoomOutButton);
  host.append(editButton, zoomCluster);

  const state: CanvasState = { zoom: 1, panX: 0, panY: 0 };
  let naturalW = 0;
  let naturalH = 0;

  function measureNatural(): void {
    if (!svg || naturalW > 0) return;
    const viewBox = svg.viewBox.baseVal;
    if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
      naturalW = viewBox.width;
      naturalH = viewBox.height;
      return;
    }
    const rect = svg.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      naturalW = rect.width;
      naturalH = rect.height;
    }
  }

  function applyTransform(): void {
    if (svg && naturalW > 0) {
      svg.style.width = `${naturalW * state.zoom}px`;
      svg.style.height = `${naturalH * state.zoom}px`;
    }
    stage.style.transform = `translate(${state.panX}px, ${state.panY}px)`;
  }

  function clampZoom(zoom: number): number {
    return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
  }

  function fitToViewport(): void {
    measureNatural();
    const viewportWidth = viewport.clientWidth;
    const viewportHeight = viewport.clientHeight;
    if (naturalW <= 0 || naturalH <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
      applyTransform();
      return;
    }
    const fit = Math.min(
      (viewportWidth - FIT_MARGIN_PX * 2) / naturalW,
      (viewportHeight - FIT_MARGIN_PX * 2) / naturalH,
    );
    state.zoom = clampZoom(fit);
    state.panX = (viewportWidth - naturalW * state.zoom) / 2;
    state.panY = (viewportHeight - naturalH * state.zoom) / 2;
    applyTransform();
  }

  function zoomAt(clientX: number, clientY: number, factor: number): void {
    measureNatural();
    const rect = viewport.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const stageX = (localX - state.panX) / state.zoom;
    const stageY = (localY - state.panY) / state.zoom;
    const next = clampZoom(state.zoom * factor);
    if (next === state.zoom) return;
    state.zoom = next;
    state.panX = localX - stageX * next;
    state.panY = localY - stageY * next;
    applyTransform();
  }

  function zoomAtCenter(factor: number): void {
    const rect = viewport.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }

  zoomInButton.addEventListener("click", () => zoomAtCenter(BUTTON_ZOOM_FACTOR));
  zoomOutButton.addEventListener("click", () => zoomAtCenter(1 / BUTTON_ZOOM_FACTOR));
  editButton.addEventListener("click", () => opts.onToggleEdit());

  let dragPointerId: number | null = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartPanX = 0;
  let dragStartPanY = 0;

  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    dragPointerId = event.pointerId;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragStartPanX = state.panX;
    dragStartPanY = state.panY;
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("is-dragging");
    host.focus();
    event.preventDefault();
  });

  viewport.addEventListener("pointermove", (event) => {
    if (dragPointerId !== event.pointerId) return;
    state.panX = dragStartPanX + (event.clientX - dragStartX);
    state.panY = dragStartPanY + (event.clientY - dragStartY);
    applyTransform();
  });

  const endDrag = (event: PointerEvent) => {
    if (dragPointerId !== event.pointerId) return;
    dragPointerId = null;
    viewport.classList.remove("is-dragging");
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  };
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);

  viewport.addEventListener(
    "wheel",
    (event) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY));
    },
    { passive: false },
  );

  host.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLButtonElement) return;
    let handled = true;
    switch (event.key) {
      case "ArrowUp":
        state.panY += KEY_PAN_STEP;
        applyTransform();
        break;
      case "ArrowDown":
        state.panY -= KEY_PAN_STEP;
        applyTransform();
        break;
      case "ArrowLeft":
        state.panX += KEY_PAN_STEP;
        applyTransform();
        break;
      case "ArrowRight":
        state.panX -= KEY_PAN_STEP;
        applyTransform();
        break;
      case "+":
      case "=":
        zoomAtCenter(KEY_ZOOM_FACTOR);
        break;
      case "-":
      case "_":
        zoomAtCenter(1 / KEY_ZOOM_FACTOR);
        break;
      case "0":
        fitToViewport();
        break;
      case "Enter":
        opts.onToggleEdit();
        break;
      default:
        handled = false;
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  });

  requestAnimationFrame(() => {
    fitToViewport();
    stage.style.opacity = "1";
  });
}

function makeButton(label: string, title: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  return button;
}
