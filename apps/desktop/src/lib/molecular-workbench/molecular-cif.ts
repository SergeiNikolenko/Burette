import { parseCifText } from "@molstar/io/reader/cif/text/parser";
import { cifField } from "./cif-crystal";
import { ELEMENT_SYMBOLS } from "./elements";
import type { MolecularAtom } from "./types";

/** Cartesian molecular coordinates only: no periodic expansion or inferred science. */
export async function readMolecularCif(text: string): Promise<MolecularAtom[]> {
  if (text.length > 20_000_000 || new TextEncoder().encode(text).length > 20_000_000) throw new Error("Molecular CIF input exceeds 20 MB.");
  const parsed = await parseCifText(text).run();
  if (parsed.isError) throw new Error(`Invalid CIF: ${parsed.message}`);
  const blocks = parsed.result.blocks.filter(block => cifField(block, "atom_site.Cartn_x", "atom_site_Cartn_x"));
  if (blocks.length !== 1) throw new Error("Choose a CIF with one Cartesian coordinate block.");
  const block = blocks[0];
  const site = (name: string) => cifField(block, `atom_site.${name}`, `atom_site_${name}`);
  if (["x", "y", "z"].some(axis => site(`fract_${axis}`))) throw new Error("Fractional CIF coordinates require the crystal reader.");
  const coordinates = ["x", "y", "z"].map(axis => site(`Cartn_${axis}`));
  const elements = site("type_symbol"), count = coordinates[0]!.rowCount;
  if (!count || count > 100_000) throw new Error("Molecular CIF requires 1–100000 atom sites.");
  const models = site("pdbx_PDB_model_num"), alternatives = site("label_alt_id"), occupancy = site("occupancy"), charges = site("pdbx_formal_charge");
  for (const value of [...coordinates, elements]) {
    if (!value || value.rowCount !== count) throw new Error("Molecular CIF atom-site columns are incomplete.");
  }
  for (const value of [models, alternatives, occupancy, charges]) {
    if (value && value.rowCount !== count) throw new Error("Molecular CIF atom-site columns have inconsistent lengths.");
  }
  const number = (value: string) => {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:\(\d+\))?$/.test(value)) throw new Error("Molecular CIF requires finite Cartesian coordinates and occupancies.");
    const result = Number(value.replace(/\(\d+\)$/, ""));
    if (!Number.isFinite(result) || Math.abs(result) > 1e6) throw new Error("Molecular CIF numeric values exceed supported bounds.");
    return result;
  };
  let model: string | undefined;
  const atoms: MolecularAtom[] = [];
  for (let row = 0; row < count; row++) {
    if (models) {
      const current = models.str(row);
      if (models.valueKind(row) !== 0 || !current) throw new Error("Molecular CIF has an unspecified model identifier.");
      model ??= current;
      if (model !== current) throw new Error("Choose one CIF model before molecular computation.");
    }
    if (alternatives && alternatives.valueKind(row) === 0 && alternatives.str(row)) throw new Error("Choose one CIF alternate conformation before molecular computation.");
    if (occupancy && number(occupancy.str(row)) !== 1) throw new Error("Molecular computation requires fully occupied CIF atom sites.");
    if (charges && charges.valueKind(row) === 0 && number(charges.str(row)) !== 0) throw new Error("Charged CIF sites require a charge-preserving molecular graph before computation.");
    const raw = elements!.str(row), element = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    if (!ELEMENT_SYMBOLS.includes(element)) throw new Error("Unsupported CIF element symbol.");
    const [x, y, z] = coordinates.map(value => number(value!.str(row)));
    atoms.push({ element, x, y, z });
  }
  return atoms;
}
