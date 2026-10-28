import type { ShellActions } from "../../components/types";
import { isTauriRuntime } from "../tauri";
import { CRYSTALS_RESOURCE } from "./resource-bundle";
import { createResourceStore } from "./resource-store";

export type CrystalOpenRequest = { path: string; version: string };
type Actions = Pick<ShellActions, "openPaths" | "openStructureRecords">;
type Options = { store?: Pick<ReturnType<typeof createResourceStore>, "getInstalled">; platform?: "browser" | "native" };
const unavailable = () => new Error("This crystal could not be opened. Refresh the library and try again.");

/** Copies a freshly verified selection into the normal document flow, independently of the library. */
export async function openInstalledCrystal(request: CrystalOpenRequest, actions: Actions,
  { store = createResourceStore(), platform = isTauriRuntime() ? "native" : "browser" }: Options = {}): Promise<string> {
  try {
    if (!request || typeof request.path !== "string" || !request.path.length || request.path.length > 256 || typeof request.version !== "string" || request.version.length > 64
      || Object.keys(request).some(key => key !== "path" && key !== "version")) throw unavailable();
    const resource = await store.getInstalled(CRYSTALS_RESOURCE.id);
    if (!resource || resource.catalog.id !== CRYSTALS_RESOURCE.id || resource.catalog.version !== CRYSTALS_RESOURCE.version
      || resource.catalog.version !== request.version || resource.catalog.compressed.sha256 !== CRYSTALS_RESOURCE.compressed.sha256
      || resource.catalog.compressed.bytes !== CRYSTALS_RESOURCE.compressed.bytes) throw unavailable();
    const selected = resource.files.find(file => file.path === request.path && file.path.endsWith(".cif"));
    if (!selected || !selected.data.length || selected.data.length > 32768) throw unavailable();
    const bytes = selected.data.slice(), name = selected.path.split("/").at(-1)!;
    if (platform === "native") {
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      const opened = await actions.openStructureRecords([{ path: name, inputExtension: "cif", text }]);
      if (opened.length !== 1 || !opened[0]?.path) throw unavailable();
      return opened[0].path;
    }
    const { registerDroppedBrowserFiles } = await import("../web-demo-workspace");
    const saved = await registerDroppedBrowserFiles([new File([bytes], name, { type: "chemical/x-cif" })], 32768);
    if (saved.errors.length || saved.paths.length !== 1) throw unavailable();
    await actions.openPaths(saved.paths, { requireSuccess: true });
    return saved.paths[0];
  } catch { throw unavailable(); }
}
