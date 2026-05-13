type TauriInternals = {
  invoke?: unknown;
  transformCallback?: unknown;
};

export function isTauriRuntime() {
  if (typeof window === "undefined") return false;
  const internals = (window as Window & { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  return (
    typeof internals?.invoke === "function" &&
    typeof internals?.transformCallback === "function"
  );
}
