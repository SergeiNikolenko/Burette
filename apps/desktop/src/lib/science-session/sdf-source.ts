import { readGraphSource } from "./graph-source";

/** Compatibility entry point for the single-record SDF reader. */
export const readSdfSource = (text: string) => readGraphSource(text, "sdf");
