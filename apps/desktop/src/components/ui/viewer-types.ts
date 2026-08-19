import type * as React from "react";

export type ViewerSidebarMode = "inline" | "overlay";
export type ViewerSidebarRequestedMode = "auto" | ViewerSidebarMode;
export type ViewerSidebarGapTransition = "width" | "none";
export type ViewerSidebarState = "expanded" | "collapsed";
export type ViewerSidebarSide = "left" | "right";
export type ViewerSidebarCollapsible = "offcanvas" | "none";
export type ViewerDocumentFrameAlign = "start" | "center" | "end";
export type ViewerGeometryTransitionPhase = "idle" | "sliding";

export type ViewerDocumentReadingAnchorInput = {
  scrollTop: number;
  viewportBlockSize: number;
};

export type ViewerDocumentReadingAnchorTarget<Anchor> = {
  anchor: Anchor;
  viewportBlockSize: number;
};

export type ViewerDocumentTransitionSource =
  | "none"
  | "viewer-shell"
  | "document-layout";

// Commit-then-relax: layout commits its target inside the motion's first
// frame and scroll rebases in the same commit, so there is no frozen layout
// and no deferred scroll left in the vocabulary.
export type ViewerDocumentLayoutPolicy = "live" | "target";
export type ViewerDocumentScrollPolicy = "preserve" | "rebase";
export type ViewerDocumentVisualPolicy =
  | "none"
  | "document-flip"
  | "shell-transform";

export type ViewerDocumentTransition = {
  layoutPolicy: ViewerDocumentLayoutPolicy;
  scrollPolicy: ViewerDocumentScrollPolicy;
  source: ViewerDocumentTransitionSource;
  transitionId: number | string | null;
  visualPolicy: ViewerDocumentVisualPolicy;
};

export type ViewerDocumentLayoutModel<Anchor> = {
  blockSize: number;
  captureReadingAnchor: (
    input: ViewerDocumentReadingAnchorInput,
  ) => Anchor | null;
  getReadingAnchorScrollTop: (
    target: ViewerDocumentReadingAnchorTarget<Anchor>,
  ) => number | null;
  inlineSize: number;
  isTransitioning?: boolean;
  transition?: ViewerDocumentTransition;
};

export type ViewerDocumentPhysicalScrollPosition = {
  physicalScrollTop: number;
  scrollPageOffset: number;
};

export type ViewerDocumentResolvedScrollTarget = {
  left?: number;
  top: number;
};

export type ViewerDocumentScrollMapper = {
  getLogicalScrollTop: (input: {
    blockSize: number;
    physicalScrollTop: number;
    scrollPageOffset: number;
    viewportBlockSize: number;
  }) => number;
  getPhysicalScrollSize: (input: {
    blockSize: number;
    viewportBlockSize: number;
  }) => number;
  resolvePhysicalScrollPosition: (input: {
    blockSize: number;
    logicalScrollTop: number;
    scrollPageOffset: number;
    viewportBlockSize: number;
  }) => ViewerDocumentPhysicalScrollPosition;
};

export type ViewerDocumentScrollMetrics = {
  physicalScrollSize: number;
  physicalScrollTop: number;
  scrollPageOffset: number;
  scrollTop: number;
  viewportBlockSize: number;
};

export type ViewerDocumentScrollTargetResolver<Anchor, Target> = (input: {
  layout: ViewerDocumentLayoutModel<Anchor>;
  scrollTop: number;
  target: Target;
  viewportElement: HTMLDivElement;
}) => ViewerDocumentResolvedScrollTarget | null;

// A zoom step is the one geometry change whose intent is "zoom the camera",
// not "keep my reading position": it re-anchors the viewport CENTER on both
// axes and relaxes a FLIP about that fixed point. `capture` runs in the zoom
// gesture's own task against the pre-zoom layout and painted DOM;
// `resolveScrollTarget` and `play` run inside the geometry commit against the
// post-zoom layout (commit-then-relax).
export type ViewerDocumentZoomMotionBypassReason =
  | "resolve-failed"
  | "shell-transition"
  | "stale-intent";

export type ViewerDocumentZoomMotionController<Transaction = unknown> = {
  capture: (input: {
    scrollTop: number;
    viewportElement: HTMLDivElement;
  }) => Transaction | null;
  /**
   * Telemetry tap: a captured zoom intent reached a geometry commit but the
   * zoom lane declined it. Without this the bypass is invisible — the commit
   * falls back to the reading-anchor restore and no flight is recorded.
   */
  noteBypass?: (reason: ViewerDocumentZoomMotionBypassReason) => void;
  resolveScrollTarget: (input: {
    transaction: Transaction;
    viewportElement: HTMLDivElement;
  }) => ViewerDocumentResolvedScrollTarget | null;
  play: (input: {
    transaction: Transaction;
    viewportElement: HTMLDivElement;
  }) => (() => void) | null;
};

export type ViewerGeometrySnapshot = {
  bodyInlineSize: number;
  documentInlineSize: number;
  hasMeasuredBody: boolean;
  isTransitioning: boolean;
  mode: ViewerSidebarMode;
  open: boolean;
  progress: number;
  sidebarGapTransition: ViewerSidebarGapTransition;
  sidebarInlineSize: number;
  sidebarWidth: number;
  side: ViewerSidebarSide;
  state: ViewerSidebarState;
  transitionPhase: ViewerGeometryTransitionPhase;
};

export type ViewerGeometryStore = {
  getSnapshot: () => ViewerGeometrySnapshot;
  setTarget: (target: ViewerGeometryTarget) => void;
  subscribe: (listener: () => void) => () => void;
};

export type ViewerGeometryTarget = {
  bodyElement: HTMLElement | null;
  mode: ViewerSidebarMode;
  open: boolean;
  rootElement: HTMLElement | null;
  sidebarElement: HTMLElement | null;
  sidebarGapTransition: ViewerSidebarGapTransition;
  sidebarWidth: number;
  side: ViewerSidebarSide;
  state: ViewerSidebarState;
};

export type ViewerSidebarStateValue = {
  state: ViewerSidebarState;
  open: boolean;
  setOpen: (value: boolean | ((open: boolean) => boolean)) => void;
  toggleSidebar: () => void;
  canToggleSidebar: boolean;
  mode: ViewerSidebarMode;
  side: ViewerSidebarSide;
};

export type ViewerRootProps = React.ComponentProps<"div"> & {
  defaultOpen?: boolean;
  inlineBreakpoint?: number;
  mode?: ViewerSidebarRequestedMode;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  sidebarCollapsible?: ViewerSidebarCollapsible;
  sidebarGapTransition?: ViewerSidebarGapTransition;
  sidebarSide?: ViewerSidebarSide;
  stateNamespace?: ViewerStateAttributeNamespace;
};

export type ViewerFrameProps = React.ComponentProps<"div">;
export type ViewerHeaderProps = React.ComponentProps<"div">;
export type ViewerBodyProps = React.ComponentProps<"div">;
export type ViewerSurfaceProps = React.ComponentProps<"div">;
export type ViewerViewportProps = React.ComponentProps<"div">;
export type ViewerDocumentFrameProps = React.ComponentProps<"div"> & {
  align?: ViewerDocumentFrameAlign;
  maxInlineSize?: React.CSSProperties["maxInlineSize"];
};

export type ViewerStateAttributeNamespace = {
  prefix: string;
  slots?: {
    body?: boolean;
    root?: boolean;
    sidebar?: boolean;
  };
};

export type ViewerSidebarRegistration = {
  collapsible: ViewerSidebarCollapsible;
  element: HTMLElement;
  id: string;
  instanceId: string;
  side: ViewerSidebarSide;
  width: string;
  widthPixels: number;
};

export type ViewerPortalContainmentAttributes = {
  "data-viewer-portal-root-id": string;
};

export type ViewerSidebarRegistrationState = {
  defaultSidebarCollapsible: ViewerSidebarCollapsible;
  defaultSidebarSide: ViewerSidebarSide;
  geometryStore: ViewerGeometryStore;
  getRootElement: () => HTMLElement | null;
  hasSidebar: boolean;
  registerBody: (element: HTMLElement) => () => void;
  registerSidebar: (registration: ViewerSidebarRegistration) => () => void;
  rootId: string;
  sidebarId: string;
  sidebarGapTransition: ViewerSidebarGapTransition;
  sidebarSide: ViewerSidebarSide;
  setLastTriggerElement: (element: HTMLElement | null) => void;
  stateNamespace?: ViewerStateAttributeNamespace;
};

export type ViewerRootDiagnostics = {
  getRootElement: () => HTMLElement | null;
  layoutSignature: string;
  rootId: string;
};

export type ViewerSurfaceMeasurement = {
  hasMeasured: boolean;
  setViewportElement: React.RefCallback<HTMLDivElement>;
  viewportElement: HTMLDivElement | null;
  viewportHeight: number | null;
  viewportWidth: number | null;
};

export type ViewerSidebarSlotNames = {
  container?: string;
  gap?: string;
  inner?: string;
};

export type ViewerStateAttributeSlot = "body" | "root" | "sidebar";
export type ViewerStateAttributeValues = {
  hasSidebar?: boolean;
  sidebarCollapsible?: ViewerSidebarCollapsible;
  sidebarMode?: ViewerSidebarMode;
  sidebarOpen?: boolean;
  sidebarSide?: ViewerSidebarSide;
  sidebarState?: ViewerSidebarState;
};
export type ViewerDataAttributes = Record<`data-${string}`, string | undefined>;

export type ViewerSidebarProps = React.ComponentProps<"aside"> &
  ViewerDataAttributes & {
    side?: ViewerSidebarSide;
    collapsible?: ViewerSidebarCollapsible;
    innerClassName?: string;
    namespacedSlot?: string;
    namespacedSlotNames?: ViewerSidebarSlotNames;
    slotNames?: ViewerSidebarSlotNames;
    width?: string;
  };
