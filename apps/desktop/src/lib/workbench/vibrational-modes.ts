import type { VibrationalMode } from "../molecular-workbench/scientific-types";
// Translations and rotations are reported as zero-frequency modes.
const RIGID_BODY_CM1 = 1;
export function vibrationalModes(modes: VibrationalMode[] | undefined) {
  return modes?.filter((mode) => Math.abs(mode.frequencyCm1) >= RIGID_BODY_CM1) ?? [];
}
export function formatFrequency(mode: VibrationalMode) {
  return mode.frequencyCm1 < 0 ? `${Math.abs(mode.frequencyCm1).toFixed(1)}i` : mode.frequencyCm1.toFixed(1);
}
