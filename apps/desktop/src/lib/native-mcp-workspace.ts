/** A PDB entry offered by the workspace's structure search. */
export type NativeWorkspaceStructureLink = { uri: string; name: string; title?: string; description?: string };
export type NativeWorkspaceRecentFile = { path: string; label: string; format: string; openedAt: string };

/** Start-page operations the native widget performs through its MCP host. */
export type NativeWorkspaceHome = {
  /** Adds the files of an app link such as `/pdb/4HHB` or `/example/caffeine`. */
  open: (link: string) => Promise<void>;
  search: (query: string) => Promise<NativeWorkspaceStructureLink[]>;
  /** Newest local files earlier Burette viewers opened, newest first. */
  recent: () => Promise<NativeWorkspaceRecentFile[]>;
  /** Posts a user message to the chat that owns the workspace. */
  ask: (text: string) => Promise<void>;
};

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
        getSnapshot: () => { mode: "inline" | "fullscreen"; target: "inline" | "fullscreen"; disabled: boolean; available?: boolean };
        subscribe: (listener: () => void) => () => void;
        set: (mode: "inline" | "fullscreen") => Promise<{ ok: boolean; mode: string }>;
      };
      preparePreview: (html: string) => string;
      home?: NativeWorkspaceHome;
      sendAnnotations?: (batch: {
        text: string;
        context: { content: { type: "text"; text: string }[]; structuredContent: unknown; presentation: unknown };
        image: { data: string; mimeType: string } | null;
      }) => Promise<void>;
      unmount?: () => void;
    };
  }
}

/** The native Codex widget or the browser agent shell: surfaces with an agent chat. */
export function isAgentPluginSurface(isAgentShell: boolean) {
  return isAgentShell || (typeof window !== "undefined" && Boolean(window.BuretteMcpWorkspace));
}

export function nativePreviewHtml(html: string) {
  return typeof window === "undefined" ? html : window.BuretteMcpWorkspace?.preparePreview(html) ?? html;
}
