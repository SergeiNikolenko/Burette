// Turns a composition selector into a query Mol* can build a component from.
//
// The panel's rows are selectors parsed out of the file text; the viewer's scene
// tree lists Mol* components. To configure a row - colour it, give it its own
// representation, isolate it - it has to become a component first, and a
// component is created from a query string.
//
// The query is written in PyMOL syntax rather than Mol*'s own mol-script. That is
// not a preference: this build of Mol* does not expose `MolScriptBuilder`, and its
// mol-script reader does not parse the keyword-argument form that `atom-groups`
// needs - `(sel.atom.atom-groups :chain-test …)` returns an empty selection while
// `(sel.atom.all)` works, so the failure is silent. The PyMOL, VMD and Jmol
// transpilers are all present and take a plain string.
//
// Every mapping below was checked against the structure the panel had already
// counted: `polymer and chain A` yields 2776 atoms, which is exactly what the
// Chain A row reports, and `organic and resn NAD and chain A and resi 377` yields
// 44, matching the NAD A 377 row. See test-molstar-selection-query.mjs.

// Deliberately loose. Selectors reach here from several parsers and can carry
// nested residue objects and undefined values; rather than mirror that shape, every
// value is validated below and anything that does not render to a bare token is
// refused. A type that merely described the input would not have made it safe.
export type StructureSelectorRecord = Record<string, unknown>;

// Mol*'s own component keywords, and the only four kinds the composition emits.
const KIND_TERM: Record<string, string> = {
  polymer: "polymer",
  ligand: "organic",
  water: "solvent",
  ion: "inorganic",
};

// Keys the query can express. Anything else means the row is narrower than the
// query would be, so no component is offered rather than a wrong one.
const FIELD_TERM: Record<string, string> = {
  auth_asym_id: "chain",
  label_asym_id: "chain",
  label_comp_id: "resn",
  auth_comp_id: "resn",
  auth_seq_id: "resi",
  label_seq_id: "resi",
};

function term(keyword: string, value: unknown): string | null {
  const entries = Array.isArray(value) ? value : [value];
  const values = entries.map((entry) => String(entry).trim());
  // One unusable value voids the whole term. Filtering it out instead would widen
  // the query silently - "chains A and B" would quietly become "chain A".
  if (values.some((entry) => !/^[A-Za-z0-9_'-]+$/.test(entry))) return null;
  if (values.length === 0) return null;
  if (values.length === 1) return `${keyword} ${values[0]}`;
  return `(${values.map((entry) => `${keyword} ${entry}`).join(" or ")})`;
}

/**
 * Returns a PyMOL-syntax query for the selector, or null when the selector says
 * something the query cannot say. Null is the safe answer: a component built from
 * a looser query would hold more atoms than the row it came from.
 */
export function pymolQueryForSelector(selector: StructureSelectorRecord | null | undefined): string | null {
  if (!selector || typeof selector !== "object") return null;
  const terms: string[] = [];
  for (const [key, value] of Object.entries(selector)) {
    if (value === undefined || value === null) continue;
    if (key === "kind") {
      const kind = String(value);
      // "all" and a bare structure reference are the whole thing, and carry no
      // further terms worth writing.
      if (kind === "all") return "all";
      const keyword = KIND_TERM[kind];
      if (!keyword) return null;
      terms.push(keyword);
      continue;
    }
    if (key === "structure") {
      if (String(value) !== "primary") return null;
      terms.push("all");
      continue;
    }
    const keyword = FIELD_TERM[key];
    // An insertion code lands here deliberately. PyMOL writes it joined to the
    // residue number and this build's transpiler has not been checked for that,
    // so the row keeps its selection behaviour and simply offers no component.
    if (!keyword) return null;
    const rendered = term(keyword, value);
    if (!rendered) return null;
    terms.push(rendered);
  }
  if (terms.length === 0) return null;
  // "all" beside anything else is redundant at best and wrong at worst.
  const meaningful = terms.filter((entry) => entry !== "all");
  if (meaningful.length === 0) return "all";
  return meaningful.join(" and ");
}
