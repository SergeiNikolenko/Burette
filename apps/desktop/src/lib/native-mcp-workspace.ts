/** Optional transport supplied by the native MCP resource before this shell loads. */
declare global {
  interface Window {
    BuretteMcpWorkspace?: {
      sessionId: string;
      initialPaths: string[];
      initialRenderer?: "xyzrender-external";
      restore?: boolean;
      authorizedPaths?: string[];
      storage?: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void; removeItem: (key: string) => void };
      closed: boolean;
      theme: "light" | "dark";
      placement?: {
        getSnapshot: () => { mode: "inline" | "fullscreen"; target: "inline" | "fullscreen"; disabled: boolean };
        subscribe: (listener: () => void) => () => void;
        set: (mode: "inline" | "fullscreen") => Promise<{ ok: boolean; mode: string }>;
      };
      preparePreview: (html: string) => string;
      stageAnnotations?: (context: { content: { type: "text"; text: string }[]; structuredContent: unknown; presentation: unknown } | null) => Promise<void>;
      unmount?: () => void;
    };
  }
}

export function nativePreviewHtml(html: string) {
  return typeof window === "undefined" ? html : window.BuretteMcpWorkspace?.preparePreview(html) ?? html;
}
