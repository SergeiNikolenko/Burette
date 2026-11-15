export type AtomAnnotation = { charge: number; isotope: number };

/**
 * Formal charge and mass number of each atom of a V3000 molfile whose atom block
 * is in displayed order (graph edits write it that way). Isotope 0 is natural abundance.
 */
export function atomAnnotations(molfile: string): AtomAnnotation[] {
  const rows = molfile.replace(/\r\n?/gu, "\n").split("\n");
  const begin = rows.indexOf("M  V30 BEGIN ATOM"), end = rows.indexOf("M  V30 END ATOM");
  if (begin < 0 || end < begin) throw new Error("The structure has no V3000 atom block.");
  return rows.slice(begin + 1, end).map((row) => ({
    charge: Number(/\bCHG=(-?\d+)/u.exec(row)?.[1] ?? 0),
    isotope: Number(/\bMASS=(\d+)/u.exec(row)?.[1] ?? 0),
  }));
}
