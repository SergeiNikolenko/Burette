import type { ChemicalEditorTarget } from "../components/types";

/** Shared menu policy for native desktop and the MCP workspace. Discovery keeps
 * all registrations; hiding development copies here never unregisters apps. */
export function visibleEditorTargets(targets: ChemicalEditorTarget[]): ChemicalEditorTarget[] {
  const names = new Set<string>();
  const bundles = new Set<string>();
  return [...targets].sort((a, b) => a.rank - b.rank).filter(target => {
    const bundle = target.bundleId?.toLowerCase() ?? "";
    const name = target.name.trim().replace(/\.app$/i, "").toLowerCase();
    if (bundle.startsWith("com.local.burettev10.dev.")) return false;
    if (names.has(name) || (bundle && bundles.has(bundle))) return false;
    names.add(name);
    if (bundle) bundles.add(bundle);
    return true;
  });
}
