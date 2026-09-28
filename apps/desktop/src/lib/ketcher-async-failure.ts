const KETCHER_FAILURE_EVENT = "FAILURE";

type FailureEventBus = {
  once(event: string, listener: () => void): unknown;
  removeListener(event: string, listener: () => void): unknown;
};

/** Ketcher 3.15 runAsyncAction emits FAILURE and resolves undefined on parse errors. */
export async function rejectOnKetcherAsyncFailure<T>(
  operation: () => Promise<T>,
  eventBus: FailureEventBus,
) {
  let failed = false;
  const markFailed = () => { failed = true; };
  eventBus.once(KETCHER_FAILURE_EVENT, markFailed);
  try {
    const result = await operation();
    if (failed) throw new Error("Ketcher could not parse or import the supplied structure.");
    return result;
  } finally {
    eventBus.removeListener(KETCHER_FAILURE_EVENT, markFailed);
  }
}
