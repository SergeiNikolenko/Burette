// Combinatorial library enumeration: every combination of building blocks put
// through a reaction, or attached to the numbered positions of a core. The
// worker runs this with RDKit WASM; tests/test-library-enumeration.mjs runs the
// same functions against RDKit's own EnumerateLibraryFromReaction and molzip.

// The result opens as one SDF text document, and a text document is capped at
// 10 MB by the desktop importer. A drug-like product costs 3-5 KB there, so the
// bound is on combinations, which is the number the dialog shows before a run.
export const LIBRARY_PRODUCT_LIMIT = 2_000;

const MATCH_PRODUCT_LIMIT = 1_000;
const SCHEME_TEXT_LIMIT = 4_000;

/** A message meant for the person who set the library up, as opposed to an engine failure. */
export class LibraryInputError extends Error {}

/** The reactant templates of a reaction SMARTS, or none when it does not read as reactants>agents>products. */
export function reactionReactantTemplates(smarts) {
  const sides = String(smarts ?? "").trim().split(">");
  if (sides.length !== 3 || !sides[0].trim() || !sides[2].trim()) return [];
  // A '.' inside brackets or parentheses belongs to a recursive pattern or to a
  // grouped template, so only the top-level ones separate reactants.
  const templates = [];
  let depth = 0;
  let start = 0;
  const reactants = sides[0];
  for (let index = 0; index < reactants.length; index += 1) {
    const character = reactants[index];
    if (character === "[" || character === "(") depth += 1;
    else if (character === "]" || character === ")") depth -= 1;
    else if (character === "." && depth === 0) {
      templates.push(reactants.slice(start, index).trim());
      start = index + 1;
    }
  }
  templates.push(reactants.slice(start).trim());
  return templates.every(Boolean) ? templates : [];
}

// An attachment point is a dummy atom however it is spelled: *, [*:1], [1*],
// [R1]. Its number is the atom map, else the R number, else the isotope.
const ATTACHMENT_ATOM = /^(\d*)(?:\*|R(\d*)|#0)(?::(\d+))?$/u;

function attachmentPoints(smiles) {
  const points = [];
  for (let index = 0; index < smiles.length; index += 1) {
    if (smiles[index] === "*") {
      points.push({ start: index, end: index + 1, label: 0 });
    } else if (smiles[index] === "[") {
      const end = smiles.indexOf("]", index);
      if (end < 0) break;
      const match = ATTACHMENT_ATOM.exec(smiles.slice(index + 1, end));
      if (match) points.push({ start: index, end: end + 1, label: Number(match[3] || match[2] || match[1] || 0) });
      index = end;
    }
  }
  return points;
}

// molzip joins two molecules at dummy atoms that carry the same atom map
// number, so every attachment point is rewritten to that one spelling.
function withAttachmentLabels(smiles, points, labels) {
  let text = "";
  let cursor = 0;
  points.forEach((point, index) => {
    text += `${smiles.slice(cursor, point.start)}[*:${labels[index]}]`;
    cursor = point.end;
  });
  return text + smiles.slice(cursor);
}

function numberedCore(core) {
  const text = String(core ?? "").trim();
  if (text.length > SCHEME_TEXT_LIMIT) throw new LibraryInputError("The core is too long.");
  const points = attachmentPoints(text);
  if (points.length === 0) throw new LibraryInputError("Mark the attachment points in the core, for example [*:1].");
  const labels = points.length === 1 && points[0].label === 0 ? [1] : points.map((point) => point.label);
  if (labels.includes(0)) throw new LibraryInputError("Number every attachment point, for example [*:1] and [*:2].");
  if (new Set(labels).size !== labels.length) throw new LibraryInputError("Each R position can appear once in the core.");
  return { smiles: withAttachmentLabels(text, points, labels), labels };
}

/** The R positions a core defines, in the order the building-block lists follow. */
export function coreAttachmentLabels(core) {
  return numberedCore(core).labels.sort((left, right) => left - right);
}

function readMolecule(rdkit, input) {
  // RDKit reads an empty string as a molecule with no atoms.
  if (!input) return null;
  try {
    const molecule = rdkit.get_mol(input);
    if (molecule && molecule.is_valid?.() === false) {
      molecule.delete();
      return null;
    }
    return molecule ?? null;
  } catch {
    return null;
  }
}

function release(...handles) {
  for (const handle of handles) {
    try { handle?.delete?.(); } catch { /* already released */ }
  }
}

function blockInput(block) {
  const molblock = typeof block?.molblock === "string" && block.molblock.trim() ? block.molblock : "";
  return molblock || (typeof block?.smiles === "string" ? block.smiles.trim() : "");
}

function blockSource(block) {
  return typeof block?.source === "string" ? block.source.replace(/\s+/gu, " ").trim().slice(0, 200) : "";
}

// Reactants are screened against their own template first, so a building block
// that cannot react is skipped once instead of failing every combination it is in.
function prepareReaction(rdkit, request, positions, handles) {
  const smarts = String(request.reaction ?? "").trim();
  if (smarts.length > SCHEME_TEXT_LIMIT) throw new LibraryInputError("The reaction is too long.");
  const templates = reactionReactantTemplates(smarts);
  if (templates.length === 0) throw new LibraryInputError("A reaction reads reactants>agents>products.");
  if (templates.length !== positions.length) {
    throw new LibraryInputError(`This reaction takes ${templates.length} reactant list${templates.length === 1 ? "" : "s"}.`);
  }
  let reaction = null;
  try { reaction = rdkit.get_rxn(smarts); } catch { /* reported below */ }
  if (!reaction) throw new LibraryInputError("Could not read the reaction SMARTS.");
  handles.push(reaction);
  const name = typeof request.reactionName === "string" ? request.reactionName.trim().slice(0, 80) : "";
  const lists = positions.map((blocks, position) => {
    let template = null;
    try { template = rdkit.get_qmol(templates[position]); } catch { /* a grouped template is screened by the reaction itself */ }
    handles.push(template);
    const list = { label: `Reactant ${position + 1}`, blocks: [], unreadable: 0, unmatched: 0 };
    for (const block of blocks) {
      const molecule = readMolecule(rdkit, blockInput(block));
      if (!molecule) {
        list.unreadable += 1;
      } else if (template && molecule.get_substruct_match(template) === "{}") {
        list.unmatched += 1;
        release(molecule);
      } else {
        handles.push(molecule);
        list.blocks.push({ molecule, smiles: molecule.get_smiles(), source: blockSource(block) });
      }
    }
    return list;
  });
  const combine = (blocks) => {
    const reactants = new rdkit.MolList();
    let sets = null;
    try {
      for (const block of blocks) reactants.append(block.molecule);
      sets = reaction.run_reactants(reactants, MATCH_PRODUCT_LIMIT);
      const products = [];
      for (let index = 0; index < sets.size(); index += 1) {
        const set = sets.get(index);
        const parts = [];
        for (let member = 0; member < set.size(); member += 1) {
          const part = set.at(member);
          parts.push(part.get_smiles());
          release(part);
        }
        release(set);
        if (parts.length) products.push(parts.join("."));
      }
      return products;
    } finally {
      release(sets, reactants);
    }
  };
  return { schemeLabel: "Reaction", scheme: name || smarts, lists, combine };
}

function prepareCore(rdkit, request, positions, handles) {
  const core = numberedCore(request.core);
  const labels = [...core.labels].sort((left, right) => left - right);
  if (labels.length !== positions.length) {
    throw new LibraryInputError(`This core takes ${labels.length} building-block list${labels.length === 1 ? "" : "s"}.`);
  }
  const coreMolecule = readMolecule(rdkit, core.smiles);
  if (!coreMolecule) throw new LibraryInputError("Could not read the core.");
  handles.push(coreMolecule);
  const lists = positions.map((blocks, position) => {
    const list = { label: `R${labels[position]}`, blocks: [], unreadable: 0, unmatched: 0 };
    for (const block of blocks) {
      // A drawn building block reaches the attachment-point rewrite as SMILES too.
      let text = typeof block?.smiles === "string" ? block.smiles.trim() : "";
      if (typeof block?.molblock === "string" && block.molblock.trim()) {
        const drawn = readMolecule(rdkit, block.molblock);
        text = drawn ? drawn.get_smiles() : "";
        release(drawn);
      }
      const points = attachmentPoints(text);
      if (!text) {
        list.unreadable += 1;
      } else if (points.length !== 1) {
        list.unmatched += 1;
      } else {
        const molecule = readMolecule(rdkit, withAttachmentLabels(text, points, [labels[position]]));
        if (!molecule) {
          list.unreadable += 1;
        } else {
          handles.push(molecule);
          list.blocks.push({ molecule, smiles: molecule.get_smiles(), source: blockSource(block) });
        }
      }
    }
    return list;
  });
  const combine = (blocks) => {
    let molecule = coreMolecule;
    try {
      for (const block of blocks) {
        const joined = rdkit.molzip(molecule, block.molecule);
        if (molecule !== coreMolecule) release(molecule);
        molecule = joined;
        if (!molecule) return [];
      }
      return [molecule.get_smiles()];
    } finally {
      if (molecule !== coreMolecule) release(molecule);
    }
  };
  return { schemeLabel: "Core", scheme: coreMolecule.get_smiles(), lists, combine };
}

/**
 * Enumerates the library a request describes. Products are unique by canonical
 * SMILES; the first combination that gives a product is the one it records.
 */
export function enumerateLibrary(rdkit, request, { onProgress } = {}) {
  const mode = request?.mode;
  if (mode !== "reaction" && mode !== "core") throw new LibraryInputError("Choose a reaction or a core.");
  const positions = Array.isArray(request.positions) ? request.positions : [];
  if (positions.length === 0 || positions.some((blocks) => !Array.isArray(blocks) || blocks.length === 0)) {
    throw new LibraryInputError("Every position needs at least one building block.");
  }
  const requested = positions.reduce((count, blocks) => count * blocks.length, 1);
  if (requested > LIBRARY_PRODUCT_LIMIT) {
    throw new LibraryInputError(
      `A library holds up to ${LIBRARY_PRODUCT_LIMIT.toLocaleString("en-US")} products; this one would have ${requested.toLocaleString("en-US")}.`,
    );
  }
  const handles = [];
  try {
    const prepared = mode === "reaction"
      ? prepareReaction(rdkit, request, positions, handles)
      : prepareCore(rdkit, request, positions, handles);
    const { lists, combine } = prepared;
    const combinations = lists.reduce((count, list) => count * list.blocks.length, 1);
    const products = [];
    const seen = new Set();
    let duplicates = 0;
    let withoutProduct = 0;
    let capped = false;
    const indexes = lists.map(() => 0);
    for (let done = 0; done < combinations && !capped; done += 1) {
      const blocks = lists.map((list, position) => list.blocks[indexes[position]]);
      let raw = [];
      try { raw = combine(blocks); } catch { /* counted as a combination without a product */ }
      const own = new Set();
      for (const smiles of raw) {
        // A product straight out of the reaction is unsanitized; reading it
        // again both validates it and makes its SMILES canonical.
        const molecule = readMolecule(rdkit, smiles);
        if (!molecule) continue;
        const canonical = molecule.get_smiles();
        if (canonical && !own.has(canonical)) {
          own.add(canonical);
          if (seen.has(canonical)) {
            duplicates += 1;
          } else if (products.length >= LIBRARY_PRODUCT_LIMIT) {
            capped = true;
          } else {
            seen.add(canonical);
            molecule.set_new_coords();
            products.push({
              smiles: canonical,
              molblock: molecule.get_molblock(),
              parts: blocks.map((block) => ({ smiles: block.smiles, source: block.source })),
            });
          }
        }
        release(molecule);
      }
      if (own.size === 0) withoutProduct += 1;
      // The last position turns fastest, the order of a Cartesian product.
      for (let position = indexes.length - 1; position >= 0; position -= 1) {
        indexes[position] += 1;
        if (indexes[position] < lists[position].blocks.length) break;
        indexes[position] = 0;
      }
      onProgress?.(done + 1, combinations);
    }
    return {
      schemeLabel: prepared.schemeLabel,
      scheme: prepared.scheme,
      positions: lists.map((list) => ({
        label: list.label,
        used: list.blocks.length,
        unreadable: list.unreadable,
        unmatched: list.unmatched,
      })),
      products,
      combinations,
      duplicates,
      withoutProduct,
      capped,
    };
  } finally {
    release(...handles);
  }
}

/** The library as SDF: one record per product, with the scheme and each position's building block and its source. */
export function libraryToSdf(library) {
  return library.products.map((product, index) => {
    const lines = product.molblock.replace(/\s+$/u, "").split(/\r?\n/u);
    lines[0] = `Product ${index + 1}`;
    const fields = [
      [library.schemeLabel, library.scheme],
      ...product.parts.flatMap((part, position) => [
        [library.positions[position].label, part.smiles],
        [`${library.positions[position].label} source`, part.source],
      ]),
    ];
    const data = fields.filter(([, value]) => value).map(([name, value]) => `>  <${name}>\n${value}\n\n`).join("");
    return `${lines.join("\n")}\n${data}$$$$\n`;
  }).join("");
}
