import { useEffect, useRef } from "react";
import "miew/dist/Miew.css";

type SettingsListener = [(event: unknown) => void, unknown?];
type ViewerSettings = {
  // Miew 0.11's dispatcher stores callback/context pairs. Its term() does not
  // unsubscribe them, although those callbacks retain the terminated viewer.
  _handlers: Record<string, SettingsListener[]>;
  removeEventListener: (event: string, callback: SettingsListener[0], context?: unknown) => void;
};
export type NativeViewer = {
  init: () => boolean;
  run: () => void;
  term: () => void;
};
type ViewerConstructor = { new (options: Record<string, unknown>): NativeViewer; settings: ViewerSettings };

export function createMiewInstance(Constructor: ViewerConstructor, options: Record<string, unknown>) {
  const settings = Constructor.settings;
  const before = new Set(Object.values(settings._handlers).flat());
  let viewer: NativeViewer;
  const removeOwnedListeners = () => {
    for (const [event, listeners] of Object.entries(settings._handlers)) {
      for (const pair of [...listeners]) if (!before.has(pair)) settings.removeEventListener(event, pair[0], pair[1]);
    }
  };
  try { viewer = new Constructor(options); }
  catch (reason) { removeOwnedListeners(); throw reason; }
  // Capture now, not during disposal: other viewers can register afterwards.
  const owned = Object.entries(settings._handlers).flatMap(([event, listeners]) =>
    listeners.filter(pair => !before.has(pair)).map(pair => ({ event, pair })));
  let disposed = false;
  return {
    viewer,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const { event, pair } of owned) settings.removeEventListener(event, pair[0], pair[1]);
      viewer.term();
    },
  };
}

// Same scientific engine and init/run/term contract as miew-react, with scoped
// settings-listener cleanup so reopening a preview cannot notify a dead viewer.
export function MiewViewer<T extends NativeViewer>({ onInit, onError }: { onInit: (viewer: T) => void; onError: (reason: unknown) => void }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    let instance: ReturnType<typeof createMiewInstance> | undefined;
    void import("miew").then(module => {
      if (cancelled || !container.current) return;
      instance = createMiewInstance(module.default as unknown as ViewerConstructor, {
        container: container.current, settings: { axes: false, fps: false },
      });
      if (!instance.viewer.init()) throw new Error("WebGL viewer initialization failed");
      instance.viewer.run();
      onInit(instance.viewer as T);
    }).catch(reason => {
      instance?.dispose();
      if (!cancelled) onError(reason);
    });
    return () => { cancelled = true; instance?.dispose(); };
  }, [onInit, onError]);
  return <div ref={container} className="h-full w-full" />;
}
