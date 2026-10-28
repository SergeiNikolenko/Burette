import { normalizeElement, ScienceSessionError } from "./contracts";
import { readSceneSourceFrames } from "./source-frames";
import { positionsMatch } from "../source-editing/source-identity";

/** Mol* state refs of the one structure the source describes, and the frame it shows. */
export type ScienceSceneBinding = {
  structureRef: string;
  modelRef: string;
  trajectoryRef: string;
  frameIndex: number;
  frameCount: number;
  atomCount: number;
};

/** What the viewer reports about the structure a scene's source describes. */
export type SceneScienceBindingReport = ScienceSceneBinding & { elements: string[]; positions: ArrayLike<number>; sourceSha256?: string };

const BINDING_KEYS = ["structureRef", "modelRef", "trajectoryRef"] as const;

export function checkBindingReport(value: Record<string, unknown>): SceneScienceBindingReport {
  const positions = value.positions;
  if (!BINDING_KEYS.every((key) => typeof value[key] === "string") || !Number.isInteger(value.frameIndex) || !Number.isInteger(value.frameCount)
    || !Number.isInteger(value.atomCount) || !Array.isArray(value.elements) || value.elements.length !== value.atomCount
    || !(positions instanceof Float64Array || Array.isArray(positions)) || positions.length !== (value.atomCount as number) * 3) {
    throw new ScienceSessionError("binding", "The scene did not report its structure.");
  }
  if (value.sourceSha256 !== undefined && (typeof value.sourceSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(value.sourceSha256))) throw new ScienceSessionError("binding", "The scene reported an invalid graph source identity.");
  const report = value as unknown as SceneScienceBindingReport;
  const elements = report.elements.map((element) => typeof element === "string" ? normalizeElement(element) : null);
  if (elements.some((element) => element === null) || report.frameIndex < 0 || report.frameCount < 1
    || report.frameIndex >= report.frameCount || report.atomCount < 1 || !Array.from(positions).every(Number.isFinite)) {
    throw new ScienceSessionError("binding", "The scene reported invalid atoms or coordinates.");
  }
  return { ...value, elements } as unknown as SceneScienceBindingReport;
}

/** The scene shows `text` at the reported frame: same atoms, same order, same positions. */
export function checkSceneShowsSource(report: SceneScienceBindingReport, text: string, extension: "xyz" | "sdf" = "xyz") {
  const frames = readSceneSourceFrames(text, extension);
  const frame = frames[report.frameIndex];
  if (report.frameCount !== frames.length || !frame || frame.elements.length !== report.atomCount
    || frame.elements.some((element, index) => element !== normalizeElement(report.elements[index])) || !positionsMatch(frame.positions, report.positions)) {
    throw new ScienceSessionError("binding", "The scene does not show the current source yet. Wait for it to update, then save again.");
  }
  return frames;
}
