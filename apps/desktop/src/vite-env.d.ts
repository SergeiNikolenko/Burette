/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BURETTE_DEV_INSTANCE?: string;
  readonly VITE_BURRETE_BUILD_CHANNEL?: string;
  readonly VITE_BURRETE_BUILD_FLAVOR?: string;
  readonly VITE_BURRETE_BUILD_IDENTIFIER?: string;
  readonly VITE_BURRETE_AGENT_SHELL?: string;
  readonly BURRETE_REPO_ROOT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __BURRETE_BOOT_OVERLAY__?: {
    report: (message: string, details?: string) => void;
    markMounted: () => void;
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
