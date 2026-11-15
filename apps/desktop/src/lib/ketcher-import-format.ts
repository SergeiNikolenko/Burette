export type KetcherDetectedImportFormat =
  | "smiles"
  | "extended-smiles"
  | "molfile-v2000"
  | "molfile-v3000"
  | "rxn-v2000"
  | "rxn-v3000"
  | "ket"
  | "sdf-v2000"
  | "sdf-v3000"
  | "rdf-v2000"
  | "rdf-v3000"
  | "smarts"
  | "cml"
  | "cdxml"
  | "inchi"
  | "inchi-aux"
  | "inchi-key"
  | "svg";

export function detectKetcherImportFormat(text: string): KetcherDetectedImportFormat {
  const value = text.trim();
  const hasV3000 = /\bV3000\b/u.test(value);

  if (/^\$RXN\b/u.test(value)) return hasV3000 ? "rxn-v3000" : "rxn-v2000";
  if (/^\$RDFILE\b/u.test(value)) return hasV3000 ? "rdf-v3000" : "rdf-v2000";
  if (/\n?\$\$\$\$\s*$/u.test(value)) return hasV3000 ? "sdf-v3000" : "sdf-v2000";
  if (/\nM\s+END(?:\n|$)/u.test(value)) return hasV3000 ? "molfile-v3000" : "molfile-v2000";
  if (/^<\?xml[\s\S]*?<CDXML\b|^<CDXML\b/iu.test(value)) return "cdxml";
  if (/^<\?xml[\s\S]*?<cml\b|^<cml\b/iu.test(value)) return "cml";
  if (/^<svg\b/iu.test(value)) return "svg";
  if (/^InChI=\S+(?:\s+AuxInfo=\S+|\nAuxInfo=\S+)/u.test(value)) return "inchi-aux";
  if (/^InChI=/u.test(value)) return "inchi";
  if (/^[A-Z]{14}-[A-Z]{10}-[A-Z]$/u.test(value)) return "inchi-key";
  if (/^\{[\s\S]*\}$/u.test(value)) return "ket";
  if (/\s\|[^|]+\|\s*$/u.test(value)) return "extended-smiles";
  if (/\$\(|\[[^\]]*(?:!|;|&|,|#\d)[^\]]*\]|[~?]/u.test(value)) return "smarts";
  return "smiles";
}

export function isReactionDrawing(text: string) {
  const value = text.trim();
  if (/^\$(?:RXN|RDFILE|RFMT)\b/u.test(value)) return true;
  if (value.startsWith("{")) {
    try {
      const ket = JSON.parse(value);
      const nodes = ket?.root?.nodes;
      return Array.isArray(nodes) && nodes.some(node => {
        const type = node?.$ref ? ket[node.$ref]?.type : node?.type;
        return type === "arrow" || type === "plus" || type === "multi-tailed-arrow";
      });
    } catch {
      return false;
    }
  }
  const format = detectKetcherImportFormat(value);
  if (format !== "smiles" && format !== "extended-smiles" && format !== "smarts") return false;
  // A greater-than sign can also be part of a coordinate bond in a molecule.
  const token = value.split(/\s/u, 1)[0].replaceAll("->", "");
  return token !== ">>" && /^[^>]*>[^>]*>[^>]*$/u.test(token);
}

export function normalizeKetcherSmilesImport(text: string) {
  const value = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const lines = value.split("\n").map((line) => line.trim()).filter(Boolean);
  const candidates = lines.length > 1
    ? lines.map((line) => line.split(/\s+/u)[0] ?? "")
    : value.split(/\s+/u);
  if (candidates.length < 2 || !candidates.every(looksLikeSmilesToken)) return value;
  return candidates.join(".");
}

function looksLikeSmilesToken(value: string) {
  if (!value || /\s/u.test(value)) return false;
  const withoutAtoms = value.replace(/Br|Cl|\[[^\]]+\]|[BCNOFPSIbcnops*]/gu, "");
  return withoutAtoms.length < value.length
    && Array.from(withoutAtoms).every((character) => "0123456789@+-()\\/%=#$:.".includes(character));
}
