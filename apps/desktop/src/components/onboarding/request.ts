import { isContextualGuideId, type ContextualGuideId } from "./contextual-guides";
import { claimContextualGuide } from "./progress";

export type GuideRect = { left: number; top: number; width: number; height: number };
export type GuideAnchor = Element | GuideRect;
export type ContextualGuideRequest = { id: ContextualGuideId; anchor: GuideAnchor | null };

export const contextualGuideRequestEvent = "burette-contextual-guide";
/** postMessage type used by viewer, grid and editor frames: `{ type, id, rect? }`. */
export const contextualGuideMessageType = "burette:contextual-guide";

let mountedHosts = 0;

export function registerContextualGuideHost() {
  mountedHosts += 1;
  return () => { mountedHosts -= 1; };
}

/**
 * Shows a guide beside `anchor` the first time the user reaches its feature.
 * Call it from the user action itself; ineligible requests are dropped, never queued.
 * Without an anchor the guide opens as a centered dialog.
 */
export function requestContextualGuide(id: ContextualGuideId, anchor?: GuideAnchor | null): boolean {
  if (typeof window === "undefined" || mountedHosts === 0 || !isContextualGuideId(id) || !claimContextualGuide(id)) return false;
  window.dispatchEvent(new CustomEvent<ContextualGuideRequest>(contextualGuideRequestEvent, { detail: { id, anchor: anchor ?? null } }));
  return true;
}
