import type { ViewerActionTarget } from "./viewer-bridge";

type Receipt = { source: Window; isCurrent?: () => boolean; retired: boolean; timer: number };
const receipts = new Map<string, Receipt>();
const MAX_RECEIPTS = 256;

function release(id: string, receipt: Receipt) {
  if (receipts.get(id) !== receipt) return;
  window.clearTimeout(receipt.timer);
  receipts.delete(id);
}

/** A cancelled read loses its ACK listener before its runtime can send the final reply. */
export function retainGeometryActionStatus(id: string, target: ViewerActionTarget, timeoutMs: number) {
  const receipt: Receipt = { source: target.source, isCurrent: target.isCurrent, retired: false, timer: 0 };
  receipt.timer = window.setTimeout(() => release(id, receipt), Math.min(60_000, Math.max(1, timeoutMs)));
  receipts.set(id, receipt);
  if (receipts.size > MAX_RECEIPTS) {
    const oldest = receipts.entries().next().value!;
    release(oldest[0], oldest[1]);
  }
  return {
    retire() { receipt.retired = true; receipt.isCurrent = undefined; },
    settle() {
      receipt.retired ||= receipt.isCurrent?.() === false;
      receipt.isCurrent = undefined;
      // Keep classification through this event task, including microtasks between listeners.
      window.setTimeout(() => release(id, receipt), 0);
    },
  };
}

export function isRetiredGeometryActionResult(id: string, source: MessageEventSource | null) {
  const receipt = receipts.get(id);
  if (!receipt || receipt.source !== source) return false;
  return receipt.retired || receipt.isCurrent?.() === false;
}
