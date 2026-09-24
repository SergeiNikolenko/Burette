import { useSyncExternalStore } from "react";

const noPlacement = () => null;
const noSubscription = () => () => {};

// The bridge exists before React mounts; ordinary desktop/browser shells have none.
export function useNativeWorkspacePlacement() {
  const placement = window.BuretteMcpWorkspace?.placement;
  return useSyncExternalStore(placement?.subscribe ?? noSubscription, placement?.getSnapshot ?? noPlacement);
}
