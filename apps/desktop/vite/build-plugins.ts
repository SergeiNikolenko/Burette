import type { Plugin } from "vite";

export function ketcherRaphaelImportShimPlugin(): Plugin {
  const target = "raphaelModule = require('raphael');";
  const replacement = "raphaelModule = __burreteRaphael;";

  return {
    name: "burrete-ketcher-raphael-import-shim",
    transform(code, id) {
      const normalized = id.replaceAll("\\", "/");
      if (!normalized.endsWith("/node_modules/ketcher-core/dist/index.modern.js")) return null;
      if (!code.includes(target)) return null;
      return {
        code: `import __burreteRaphael from "raphael";\n${code.replaceAll(target, replacement)}`,
        map: null,
      };
    },
  };
}

export function deferKetcherCssPlugin(): Plugin {
  return {
    name: "burrete-defer-ketcher-css",
    transformIndexHtml(html) {
      return html.replace(/\n\s*<link rel="stylesheet" crossorigin href="\.\/assets\/ketcher-[^"]+\.css">/gu, "");
    },
  };
}

export function desktopManualChunks(id: string) {
  const normalized = id.replaceAll("\\", "/");
  if (normalized.includes("/node_modules/molstar/")) return "molstar";
  if (
    normalized.includes("/node_modules/raphael/")
    || normalized.includes("/node_modules/eve-raphael/")
    || normalized.includes("/node_modules/ketcher-core/")
    || normalized.includes("/node_modules/ketcher-react/")
    || normalized.includes("/node_modules/ketcher-standalone/")
    || normalized.includes("/node_modules/indigo-ketcher/")
  ) {
    return "ketcher";
  }
  return undefined;
}

export function resolveModulePreloadDependencies(_url: string, deps: string[], context: { hostType: "html" | "js" }) {
  if (context.hostType !== "html") return deps;
  return deps.filter((dep) => !dep.includes("ketcher"));
}
