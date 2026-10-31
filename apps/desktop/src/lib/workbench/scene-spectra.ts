import { sourceExtension, useScientificDocument, useTrajectoryFrame } from "./source";
import type { ViewerDocument } from "../../types";

/** Match the scene's trajectory index; file-wide data and an explicit companion remain distinct. */
export function useSceneSpectra(document: ViewerDocument | null) {
  const { document: science, text } = useScientificDocument(document), trajectory = useTrajectoryFrame(document?.id ?? null);
  if (!document || !science) return null;
  const lines = text?.replace(/\r\n?/gu, "\n").trimEnd().split("\n") ?? [];
  // Scientific final imports materialize exactly one XYZ frame; steps retain all source frames.
  const final = sourceExtension(document) === "xyz" && lines.length === Number(lines[0]) + 2;
  const index = final ? science.frames.length - 1 : !trajectory ? 0 : trajectory.frameCount === science.frames.length ? trajectory.frameIndex : -1;
  const frame = science.frames[index];
  const sources = [
    ...(science.spectra?.spectra.length ? [{ key: "file", label: "File", data: science.spectra }] : []),
    ...(frame?.spectra?.spectra.length ? [{ key: `frame-${index}`, label: `Frame ${index + 1}`, data: frame.spectra }] : []),
    ...(frame?.mcdCompanion?.spectra.spectra.length ? [{ key: `companion-${index}`, label: frame.mcdCompanion.spectra.source.name, data: frame.mcdCompanion.spectra }] : []),
  ];
  return { science, index, sources };
}
