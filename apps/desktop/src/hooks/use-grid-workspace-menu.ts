import { useEffect } from "react";
import type { ShellActions, ShellViewState } from "../components/types";
import type { MenuItemSpec } from "../components/menu-types";
import { menuItem as item, submenu, menuSections, fileCapabilities } from "../components/workspace-menu-items";
import { showNativeContextMenu } from "../components/native-context-menu";
import { isKnownViewerMessageSource, isReadOnlyViewerMessageSource } from "../lib/viewer-bridge";
import type { StructureDragRecord } from "../lib/structure-drag";
import type { useWorkspaceFileActions } from "./use-workspace-file-actions";
import { toast } from "../components/ui/toast";

// A read-only host (the dock panel, FEP setup, pose review) still gets the full
// molecule menu; only the entries that write back into the collection are
// dropped. The grid already omits them for a read-only frame - this pins the
// contract on the host side as well.
const READ_ONLY_HIDDEN_ENTRIES = new Set(["ketcher", "duplicate", "remove"]);

export function useGridWorkspaceMenu(state: ShellViewState, actions: ShellActions, workflows: ReturnType<typeof useWorkspaceFileActions>) {
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const body = event.data?.body;
      if (body?.type !== "gridWorkspaceMenu" || !isKnownViewerMessageSource(event.source)) return;
      const readOnly = isReadOnlyViewerMessageSource(event.source);
      if (typeof body.requestId !== "string" || body.requestId.length > 128 || !Array.isArray(body.entries) || body.entries.length > 60) return;
      const frame = Array.from(document.querySelectorAll<HTMLIFrameElement>('.viewer-iframe[data-renderer="grid2d"]')).find(frame => frame.contentWindow === event.source);
      if (!frame) return;
      const source = frame.contentWindow!;
      const reply = (command: string) => source.postMessage({ source: "burette-grid-host", body: { type: "gridWorkspaceMenuResult", requestId: body.requestId, command } }, '*');
      const entries = new Map<string, { id: string; label: string; disabled?: boolean }>();
      for (const entry of body.entries) if (entry && typeof entry.id === "string" && entry.id.length < 80 && typeof entry.label === "string") entries.set(entry.id, entry);
      const take = (id: string, text: string): MenuItemSpec[] => {
        const entry = entries.get(id);
        if (readOnly && READ_ONLY_HIDDEN_ENTRIES.has(id)) return [];
        return entry && !entry.disabled ? [item(id, text, () => reply(id))] : [];
      };
      const records: StructureDragRecord[] = Array.isArray(body.records) && body.records.length <= 200 ? body.records : [];
      let bytes = 0;
      const valid = records.length > 0 && records.every(record => {
        if (typeof record?.text !== "string" || typeof record.path !== "string" || record.path.length > 4096 || typeof record.inputExtension !== "string") return false;
        bytes += new TextEncoder().encode(record.text).byteLength;
        return bytes <= 24 * 1024 * 1024;
      });
      const run = (action: () => unknown) => () => { void Promise.resolve().then(action).catch(error => toast.add({ title: String(error), type: "error" })); };
      const opening = [...take("open", "Preview")];
      if (valid) opening.push(item("row-new-tab", records.length === 1 ? "New Tab" : "In Tabs", run(() => actions.openStructureRecords(records))));
      if (valid) {
        opening.push(item("row-right-panel", "Right Panel", run(() => actions.openDockPayload({ area: "right", tabKind: "files", payload: { paths: [], records } }))));
        if (records.every(record => fileCapabilities('row.' + record.inputExtension).scene)) opening.push(...submenu("row-add-scene", "Add to Scene",
          workflows.sceneTargets(records.map(record => record.path)).map((target, index) => item(`row-scene-${index}`, target.title, run(() => workflows.addRecordsToScene(records, target))))));
      }
      const multiple = records.length > 1;
      if (valid && multiple && records.every(record => ['sdf', 'mol'].includes(record.inputExtension))) opening.push(
        item("row-together", "Together", run(() => workflows.openRecordScene(records, "all"))),
        item("row-poses", "As Poses", run(() => workflows.openRecordScene(records, "single"))),
      );
      const spec = menuSections(
        submenu("row-open", "Open", opening, "arrow.up.forward"),
        submenu("row-edit", "Edit", [...take("ketcher", "Ketcher"), ...take("duplicate", "Duplicate")]),
        submenu("row-copy", "Copy", [...take("copy-name", "Name"), ...take("copy-cell", "Cell"), ...take("copy", "Structure"), ...take("copy-smiles", "SMILES"), ...take("copy-selected", "Selected SMILES")]),
        submenu("row-export", "Export", [...take("export", "Molecule…"), ...take("export-selected", "Selected CSV…"), ...take("export-selected-smiles", "Selected SMILES…")]),
        submenu("row-select", "Select", [...take("select-row", "Molecule"), ...take("select-all", "All"), ...take("clear-selection", "None")]),
        submenu("row-search", "Search", [...take("pubchem-identity", "PubChem Identical"), ...take("pubchem-similarity", "PubChem Similar")]),
        [...take("filter-cell", "Filter by Value"), ...take("remove", "Delete from Collection")],
      );
      const rect = frame.getBoundingClientRect();
      void showNativeContextMenu(spec, { x: rect.left + Math.max(0, Math.min(frame.clientWidth, Number(body.x) || 0)), y: rect.top + Math.max(0, Math.min(frame.clientHeight, Number(body.y) || 0)) })
        .catch(error => toast.add({ title: String(error), type: "error" }));
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [state, actions, workflows]);
}
