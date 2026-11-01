// Turns a composition selector into a query Mol* can build a component from.
//
// The panel's rows are selectors parsed out of the file text; the viewer's scene
// tree lists Mol* components. To configure a row - colour it, give it its own
// representation, isolate it - it has to become a component first, and a
// component is created from a query string.
//
// The query is written in Mol*'s own mol-script. PyMOL syntax was used before,
// but Mol*'s PyMOL, VMD and Jmol transpilers only accept chain names made of
// letters, digits and a few quote characters, so a valid mmCIF author chain such
// as `Z_A1` (written by biological assembly export) failed to parse and its
// composition rows silently lost their scene. A mol-script string literal is
// delimited by backticks and carries any other character verbatim.
//
// The four kind terms reproduce Mol*'s PyMOL keywords exactly, so every row that
// PyMOL could express keeps the counts it was checked against: `polymer and
// chain A` yields 2776 atoms on 1htb, matching the Chain A row, and `organic and
// resn NAD and chain A and resi 377` yields 44, matching the NAD A 377 row.
// test-molstar-selection-query.mjs compares the compiled expressions with the
// PyMOL transpiler's output and evaluates them against real structures.

// Deliberately loose. Selectors reach here from several parsers and can carry
// nested residue objects and undefined values; rather than mirror that shape, every
// value is validated below and anything that cannot be written as a literal is
// refused. A type that merely described the input would not have made it safe.
export type StructureSelectorRecord = Record<string, unknown>;

// Residue names behind Mol*'s PyMOL `polymer` and `solvent` keywords.
const POLYMER_RESIDUES = "A C T G U DA DC DT DG DU ALA ARG ASN ASP CYS CYX GLN GLU GLY HIS HID HIE HIP ILE LEU LYS MET MSE PHE PRO SER THR TRP TYR VAL";
const SOLVENT_RESIDUES = "HOH WAT H20 TIP SOL";
const residueIn = (names: string) =>
  `(set.has (set ${names.split(" ").map((name) => `\`${name}\``).join(" ")}) (atom.label_comp_id))`;

// Mol*'s PyMOL keywords for the only four kinds the composition emits.
const KIND_QUERY: Record<string, string> = {
  polymer: `(sel.atom.atom-groups :residue-test ${residueIn(POLYMER_RESIDUES)})`,
  water: `(sel.atom.atom-groups :residue-test ${residueIn(SOLVENT_RESIDUES)})`,
  // PyMOL `organic`: whole non-polymer residues that contain carbon.
  ligand: "(sel.atom.query-in-selection :0 (sel.atom.expand-property :0 (sel.atom.union (sel.atom.query-in-selection"
    + ` :0 (sel.atom.atom-groups :residue-test (not ${residueIn(POLYMER_RESIDUES)}))`
    + " :query (sel.atom.atom-groups :atom-test (= _C (atom.el))))) :property (atom.key.res)) :query (sel.atom.all))",
  // PyMOL `inorganic`: non-polymer, non-solvent residues without carbon.
  ion: "(sel.atom.query-in-selection :0 (sel.atom.expand-property :0 (sel.atom.union (sel.atom.pick"
    + ` :0 (sel.atom.atom-groups :residue-test (not ${residueIn(`${POLYMER_RESIDUES} ${SOLVENT_RESIDUES}`)}) :group-by (atom.key.res))`
    + " :test (not (set.has (atom.set.property (atom.el)) _C)))) :property (atom.key.res)) :query (sel.atom.all))",
};

// Keys the query can express. Anything else means the row is narrower than the
// query would be, so no component is offered rather than a wrong one.
const FIELD_TEST: Record<string, { level: "chain-test" | "residue-test"; property: string; numeric: boolean }> = {
  auth_asym_id: { level: "chain-test", property: "atom.auth_asym_id", numeric: false },
  label_asym_id: { level: "chain-test", property: "atom.label_asym_id", numeric: false },
  label_comp_id: { level: "residue-test", property: "atom.label_comp_id", numeric: false },
  auth_comp_id: { level: "residue-test", property: "atom.auth_comp_id", numeric: false },
  auth_seq_id: { level: "residue-test", property: "atom.auth_seq_id", numeric: true },
  label_seq_id: { level: "residue-test", property: "atom.label_seq_id", numeric: true },
};

function literal(value: unknown, numeric: boolean): string | null {
  const text = String(value);
  if (numeric) return /^-?\d+$/.test(text) ? text : null;
  // Identifiers are compared verbatim: underscores, spaces, quotes and digits are
  // all valid mmCIF author names. A backtick would end the literal, so it is
  // refused rather than escaped - mol-script has no escape for it.
  return text && !text.includes("`") ? `\`${text}\`` : null;
}

function term(field: (typeof FIELD_TEST)[string], value: unknown): string | null {
  const entries = Array.isArray(value) ? value : [value];
  const groups = entries.map((entry) => {
    const rendered = literal(entry, field.numeric);
    return rendered && `(sel.atom.atom-groups :${field.level} (= (${field.property}) ${rendered}))`;
  });
  // One unusable value voids the whole term. Filtering it out instead would widen
  // the query silently - "chains A and B" would quietly become "chain A".
  if (groups.length === 0 || groups.some((group) => !group)) return null;
  return groups.length === 1 ? groups[0] : `(sel.atom.merge ${groups.join(" ")})`;
}

/**
 * Returns a mol-script query for the selector, or null when the selector says
 * something the query cannot say. Null is the safe answer: a component built from
 * a looser query would hold more atoms than the row it came from.
 */
export function molstarQueryForSelector(selector: StructureSelectorRecord | null | undefined): string | null {
  if (!selector || typeof selector !== "object") return null;
  const terms: string[] = [];
  let whole = false;
  for (const [key, value] of Object.entries(selector)) {
    if (value === undefined || value === null) continue;
    if (key === "kind") {
      const kind = String(value);
      // "all" and a bare structure reference are the whole thing, and carry no
      // further terms worth writing.
      if (kind === "all") return "(sel.atom.all)";
      const query = KIND_QUERY[kind];
      if (!query) return null;
      terms.push(query);
      continue;
    }
    if (key === "structure") {
      if (String(value) !== "primary") return null;
      whole = true;
      continue;
    }
    const field = FIELD_TEST[key];
    // An insertion code lands here deliberately: the row keeps its selection
    // behaviour and simply offers no component until that test is checked.
    if (!field) return null;
    const rendered = term(field, value);
    if (!rendered) return null;
    terms.push(rendered);
  }
  if (terms.length === 0) return whole ? "(sel.atom.all)" : null;
  // Same nesting as Mol*'s PyMOL `and`: each term narrows the one before it.
  return terms.slice(1).reduce((query, next) => `(sel.atom.intersect-by :0 ${query} :by ${next})`, terms[0]);
}
