import { lazy, Suspense } from "react";
import { sourceExtension, useScientificDocument } from "../../lib/workbench/source";
import { vibrationalModes } from "../../lib/workbench/vibrational-modes";
import type { ScientificDocument } from "../../lib/molecular-workbench/scientific-types";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../types";

const VibrationsPanel = lazy(() => import("./vibrations-panel").then(module => ({ default: module.VibrationsPanel })));
const scienceIds = new WeakMap<ScientificDocument, number>();
let nextScienceId = 0;
function scienceId(science: ScientificDocument) {
  let id = scienceIds.get(science);
  if (id === undefined) { id = ++nextScienceId; scienceIds.set(science, id); }
  return id;
}

/** Original Vibrations render branch; no Orbitals/indexed-trajectory discovery or worker imports. */
export function VibrationsDockContent({ document, actions }: { document: ViewerDocument | null; actions: ShellActions }) {
  const { document: science, text } = useScientificDocument(document);
  if (!document || !science || !(vibrationalModes(science.modes).length || science.frames.some(frame => vibrationalModes(frame.modes).length))) return null;
  const lines = text?.replace(/\r\n?/gu, "\n").trimEnd().split("\n") ?? [];
  // Private Geometry leases belong to MolStar; the external renderer keeps its own vibration controls.
  const liveAnimation = document.renderer === "molstar" && sourceExtension(document) === "xyz" && lines.length === Number(lines[0]) + 2;
  return <Suspense fallback={null}><VibrationsPanel key={`${document.id}:${scienceId(science)}`} document={document} actions={actions} science={science} liveAnimation={liveAnimation} /></Suspense>;
}
