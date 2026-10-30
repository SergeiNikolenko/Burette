import { useSyncExternalStore } from "react";
import type { InputConstraint, MolecularAtom } from "../molecular-workbench/types";
import type { ViewerDocument } from "../../types";
import type { MeasurementDialogRequest } from "./measurement-request";

export type WorkbenchDialogKind = "builder" | "supercell" | "assembly" | "input" | "properties" | "smiles" | "symmetry" | "measurement";
export type BuilderKind = "polymer" | "peptide" | "nucleic" | "metal";
export type CrystalView = "supercell" | "symmetry" | "niggli";

export type WorkbenchDialogRequest = {
  kind: WorkbenchDialogKind;
  document: ViewerDocument | null;
  /** Geometry tab state handed to input export: the edited atoms and their constraints. */
  atoms?: MolecularAtom[];
  constraints?: InputConstraint[];
  smiles?: string;
  /** Builder tab the builder dialog opens on. */
  builder?: BuilderKind;
  /** Crystal tool the supercell dialog opens on. */
  crystalView?: CrystalView;
  measurement?: MeasurementDialogRequest;
};

let request: WorkbenchDialogRequest | null = null;
const listeners = new Set<() => void>();

export function openWorkbenchDialog(next: WorkbenchDialogRequest) {
  request = next;
  listeners.forEach((listener) => listener());
}

export function closeWorkbenchDialog() {
  request = null;
  listeners.forEach((listener) => listener());
}

export function useWorkbenchDialogRequest() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => request);
}
