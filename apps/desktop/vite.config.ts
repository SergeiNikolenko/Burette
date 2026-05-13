import { delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const desktopRoot = fileURLToPath(new URL(".", import.meta.url));
const desktopDist = fileURLToPath(new URL("dist", import.meta.url));
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const extraFsAllow = (process.env.BURRETE_DEV_FS_ALLOW ?? "").split(delimiter).filter(Boolean);

export default defineConfig({
  root: desktopRoot,
  plugins: [react()],
  define: {
    "import.meta.env.BURRETE_REPO_ROOT": JSON.stringify(repoRoot),
  },
  server: {
    port: 1420,
    strictPort: true,
    fs: { allow: [repoRoot, ...extraFsAllow] },
    watch: { ignored: ["src-tauri/target/**"] },
  },
  build: {
    outDir: desktopDist,
    emptyOutDir: true,
  },
  clearScreen: false,
});
