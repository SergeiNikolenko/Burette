import { parseCifText } from "molstar/lib/mol-io/reader/cif/text/parser.js";
import type { CifBlock, CifField } from "molstar/lib/mol-io/reader/cif/data-model.js";

export type CifStructureClassification = {
  kind: "Crystal structure" | "Macromolecule" | null;
  /** Declared source sites of one model, without symmetry expansion or occupancy filtering. */
  asymmetricSiteCount?: number;
};

function field(block: CifBlock, name: string): CifField | undefined {
  const dottedTag = name.toLowerCase(), tag = dottedTag.replace(".", "_");
  const numericTag = /^(?:cell_(?:length_[abc]|angle_(?:alpha|beta|gamma))|atom_site_(?:fract|cartn)_[xyz])$/u.test(tag);
  let resolved: CifField | undefined;
  // Mol* retains category/field spelling. Resolve every case variant and both
  // dictionary aliases together, so precedence cannot hide contradictory data.
  for (const [categoryName, category] of Object.entries(block.categories)) for (const key of category.fieldNames) {
    const actualTag = (key ? `${categoryName}.${key}` : categoryName).toLowerCase();
    if (actualTag !== dottedTag && actualTag !== tag) continue;
    const candidate = category.getField(key)!;
    if (resolved) {
      if (candidate.rowCount !== resolved.rowCount) throw new Error("Conflicting CIF field row counts.");
      for (let row = 0; row < resolved.rowCount; row++) {
        const left = resolved.str(row), right = candidate.str(row);
        if (left !== right && !(numericTag && numeric(left) !== null && numeric(left) === numeric(right))) throw new Error("Conflicting CIF field values.");
      }
    } else resolved = candidate;
  }
  return resolved;
}

function siteField(block: CifBlock, name: string) {
  return field(block, `atom_site.${name}`);
}

function numeric(value: string): number | null {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:\(\d+\))?$/u.test(value)) return null;
  const number = Number(value.replace(/\(\d+\)$/u, ""));
  return Number.isFinite(number) ? number : null;
}

function hasValidCell(block: CifBlock) {
  const values = ["length_a", "length_b", "length_c", "angle_alpha", "angle_beta", "angle_gamma"].map(name => {
    const value = field(block, `cell.${name}`);
    return value?.rowCount === 1 ? numeric(value.str(0)) : null;
  });
  if (values.some(value => value === null)) return false;
  const [a, b, c, alpha, beta, gamma] = values as number[];
  if (![a, b, c].every(value => value > 0) || ![alpha, beta, gamma].every(value => value > 0 && value < 180)) return false;
  const [ca, cb, cg] = [alpha, beta, gamma].map(value => Math.cos(value * Math.PI / 180));
  const gram = 1 + 2 * ca * cb * cg - ca * ca - cb * cb - cg * cg;
  const volume = a * b * c * Math.sqrt(gram);
  return gram > 1e-12 && Number.isFinite(volume) && volume > 0;
}

const identifier = (value: string | undefined) => value && value !== "." && value !== "?" ? value : null;

/** A declaration must be linked to an actual site; unrelated entity tables prove nothing. */
function polymerEvidence(block: CifBlock, count: number): boolean | null {
  const ids = field(block, "entity.id"), types = field(block, "entity.type");
  const polymerIds = new Set<string>(), entityTypes = new Map<string, string>();
  if (Boolean(ids) !== Boolean(types) || (ids && types && ids.rowCount !== types.rowCount)) return null;
  for (let row = 0; row < (ids?.rowCount ?? 0); row++) {
    const id = identifier(ids!.str(row)), type = types!.str(row).toLowerCase();
    if (!id || (entityTypes.has(id) && entityTypes.get(id) !== type)) return null;
    entityTypes.set(id, type);
    if (type === "polymer") polymerIds.add(id);
  }
  const declaredPolymers = field(block, "entity_poly.entity_id");
  for (let row = 0; row < (declaredPolymers?.rowCount ?? 0); row++) {
    const id = identifier(declaredPolymers!.str(row));
    if (!id || (entityTypes.has(id) && entityTypes.get(id) !== "polymer")) return null;
    polymerIds.add(id);
  }
  const chains = field(block, "struct_asym.id"), owners = field(block, "struct_asym.entity_id");
  const chainOwners = new Map<string, string>();
  if (Boolean(chains) !== Boolean(owners) || (chains && owners && chains.rowCount !== owners.rowCount)) return null;
  for (let row = 0; row < (chains?.rowCount ?? 0); row++) {
    const chain = identifier(chains!.str(row)), owner = identifier(owners!.str(row));
    if (!chain || !owner || (chainOwners.has(chain) && chainOwners.get(chain) !== owner)) return null;
    chainOwners.set(chain, owner);
  }
  const direct = siteField(block, "label_entity_id"), asym = siteField(block, "label_asym_id"), groups = siteField(block, "group_PDB");
  if ([direct, asym, groups].some(value => value && value.rowCount !== count)) return null;
  let linkedPolymer = false, allNonpolymer = true;
  for (let row = 0; row < count; row++) {
    const directId = identifier(direct?.str(row)), chainId = identifier(asym?.str(row));
    const ownerId = chainId ? chainOwners.get(chainId) : undefined;
    if (directId && ownerId && directId !== ownerId) return null;
    const id = directId ?? ownerId;
    linkedPolymer ||= Boolean(id && polymerIds.has(id));
    allNonpolymer &&= Boolean(id && ["non-polymer", "water"].includes(entityTypes.get(id) ?? ""));
  }
  if (linkedPolymer) return true;
  if (allNonpolymer) return false;
  if (polymerIds.size || ids || declaredPolymers || direct || chains) return null;
  // ATOM alone does not establish a polymer; do not call such unknown sites a nonpolymer crystal.
  if (groups && Array.from({ length: count }, (_, row) => groups.str(row).toUpperCase()).includes("ATOM")) return null;
  return false;
}

/** Content-only classification. Malformed, ambiguous or unsupported source remains neutral. */
export async function classifyCifStructure(text: string): Promise<CifStructureClassification> {
  if (text.length > 20_000_000) return { kind: null };
  try {
    const parsed = await parseCifText(text).run();
    if (parsed.isError) return { kind: null };
    const coordinates = (block: CifBlock) => ["fract", "Cartn"].map(prefix => ["x", "y", "z"].map(axis => siteField(block, `${prefix}_${axis}`)));
    const blocks = parsed.result.blocks.filter(block => coordinates(block).flat().some(Boolean));
    if (blocks.length !== 1) return { kind: null };
    const block = blocks[0], families = coordinates(block).filter(columns => columns.some(Boolean));
    const count = families[0][0]?.rowCount ?? 0;
    if (!count || count > 1_000_000) return { kind: null };
    for (const columns of families) {
      if (columns.some(column => !column || column.rowCount !== count)) return { kind: null };
      for (const column of columns) for (let row = 0; row < count; row++) {
        if (numeric(column!.str(row)) === null) return { kind: null };
      }
    }
    const cell = hasValidCell(block);
    if (!siteField(block, "Cartn_x") && !cell) return { kind: null };
    const polymer = polymerEvidence(block, count);
    if (polymer === true) return { kind: "Macromolecule" };
    if (polymer === null || !cell) return { kind: null };
    const models = siteField(block, "pdbx_PDB_model_num");
    const modelIds = models?.rowCount === count ? Array.from({ length: count }, (_, row) => {
      const value = models.str(row);
      return /^\+?\d+$/u.test(value) ? Number(value) : NaN;
    }) : [];
    const singleModel = !models || (modelIds.length === count && modelIds.every(value => Number.isSafeInteger(value) && value > 0) && new Set(modelIds).size === 1);
    return singleModel ? { kind: "Crystal structure", asymmetricSiteCount: count } : { kind: "Crystal structure" };
  } catch {
    return { kind: null };
  }
}
