import type { Plugin } from "vite";

export function ketcherRaphaelImportShimPlugin(): Plugin {
  const target = "raphaelModule = require('raphael');";
  const replacement = "raphaelModule = __buretteRaphael;";

  return {
    name: "burette-ketcher-raphael-import-shim",
    transform(code, id) {
      const normalized = id.replaceAll("\\", "/");
      if (!normalized.endsWith("/node_modules/ketcher-core/dist/index.modern.js")) return null;
      if (!code.includes(target)) return null;
      return {
        code: `import __buretteRaphael from "raphael";\n${code.replaceAll(target, replacement)}`,
        map: null,
      };
    },
  };
}

export function ketcherDisabledMacromoleculesPlugin(): Plugin {
  const target = "children: ketcherId && jsx(MacromoleculesEditorComponent, {";
  const replacement = "children: !props.disableMacromoleculesEditor && ketcherId && jsx(MacromoleculesEditorComponent, {";

  return {
    name: "burette-ketcher-disabled-macromolecules",
    transform(code, id) {
      const normalized = id.replaceAll("\\", "/");
      if (!normalized.endsWith("/node_modules/ketcher-react/dist/index.js")) return null;
      if (code.includes(replacement)) return null;
      const occurrences = code.split(target).length - 1;
      if (occurrences !== 1) {
        throw new Error(`Expected one Ketcher macromolecules mount, found ${occurrences}`);
      }
      return {
        code: code.replace(target, replacement),
        map: null,
      };
    },
  };
}

export function deferKetcherCssPlugin(): Plugin {
  return {
    name: "burette-defer-ketcher-css",
    transformIndexHtml(html) {
      return html.replace(/\n\s*<link rel="stylesheet" crossorigin href="\.\/assets\/ketcher-[^"]+\.css">/gu, "");
    },
  };
}

export function desktopManualChunks(id: string) {
  const normalized = id.replaceAll("\\", "/");
  const packagePath = normalized.split("/node_modules/").at(-1) ?? "";
  if (packagePath === "molstar" || packagePath.startsWith("molstar/")) return "molstar";
  return undefined;
}

export function resolveModulePreloadDependencies(_url: string, deps: string[], context: { hostType: "html" | "js" }) {
  if (context.hostType !== "html") return deps;
  return deps.filter((dep) => !dep.includes("ketcher"));
}
