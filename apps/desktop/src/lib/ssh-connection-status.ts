import { useSyncExternalStore } from "react";

type Status = { checkedAt: number; available: boolean };
const statuses = new Map<string, Status>();
const listeners = new Set<() => void>();
export function recordSshStatus(host: string, available: boolean) {
  statuses.set(host, { checkedAt: Date.now(), available });
  for (const notify of listeners) notify();
}
export function useSshStatus(host: string) {
  return useSyncExternalStore(notify => { listeners.add(notify); return () => { listeners.delete(notify); }; }, () => statuses.get(host));
}
