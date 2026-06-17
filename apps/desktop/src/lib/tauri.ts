export function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

type TauriUnlisten = () => void | Promise<void>;

export function trackTauriListener(registration: Promise<TauriUnlisten>, label: string) {
  let disposed = false;
  let unlisten: TauriUnlisten | undefined;

  void registration
    .then((next) => {
      if (disposed) {
        disposeTauriListener(next, label);
        return;
      }
      unlisten = next;
    })
    .catch((error) => {
      console.warn(`[Burrete] ${label} listener setup failed`, error);
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
        console.warn(`[Burrete] ${label} listener cleanup failed`, error);
      });
    }
  } catch (error) {
    console.warn(`[Burrete] ${label} listener cleanup failed`, error);
  }
}
