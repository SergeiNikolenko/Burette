export function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

type TauriUnlisten = () => void | PromiseLike<void>;

export function trackTauriListener(
  registration: Promise<TauriUnlisten>,
  label: string,
  onRegistered?: () => void,
) {
  let disposed = false;
  let unlisten: TauriUnlisten | undefined;

  void registration
    .then((next) => {
      if (disposed) {
        disposeTauriListener(next, label);
        return;
      }
      unlisten = next;
      onRegistered?.();
    })
    .catch((error) => {
      console.warn(`[Burette] ${label} listener setup failed`, error);
    });

  return () => {
    disposed = true;
    disposeTauriListener(unlisten, label);
    unlisten = undefined;
  };
}

function disposeTauriListener(unlisten: TauriUnlisten | undefined, label: string) {
  if (!unlisten) return;
  try {
    const result = unlisten();
    if (result && typeof result.then === "function") {
      void Promise.resolve(result).catch((error) => {
        console.warn(`[Burette] ${label} listener cleanup failed`, error);
      });
    }
  } catch (error) {
    console.warn(`[Burette] ${label} listener cleanup failed`, error);
  }
}
