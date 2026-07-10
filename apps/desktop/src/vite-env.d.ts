/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BURETTE_DEV_INSTANCE?: string;
  readonly VITE_BURRETE_BUILD_CHANNEL?: string;
  readonly VITE_BURRETE_BUILD_FLAVOR?: string;
  readonly VITE_BURRETE_BUILD_IDENTIFIER?: string;
  readonly VITE_BURRETE_AGENT_SHELL?: string;
  readonly VITE_BURRETE_WEB_ASSETS_BASE?: string;
  readonly BURRETE_BROWSER_DEV_GENERATED_FILES_ROOT?: string;
  readonly BURRETE_GRID_PERF_REPORT_PATH?: string;
  readonly BURRETE_REPO_ROOT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __BURRETE_HOSTED_MCP_BRIDGE_READY__?: boolean;
  __BURRETE_HOSTED_MCP_RESULTS__?: unknown[];
  __BURRETE_HOSTED_MCP_WIDGET__?: boolean;
  __BURRETE_WEB_ASSETS_BASE__?: string;
  __BURRETE_BOOT_OVERLAY__?: {
    report: (message: string, details?: string) => void;
    markMounted: () => void;
  };
  openai?: {
    toolOutput?: unknown;
    toolResponseMetadata?: unknown;
  };
}

declare module "raphael" {
  const raphael: unknown;
  export default raphael;
}

declare module "eve-raphael" {
  const eve: unknown;
  export default eve;
}

declare module "ketcher-standalone/dist/binaryWasm" {
  export * from "ketcher-standalone";
}
