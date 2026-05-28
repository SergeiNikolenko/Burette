export type CollectionFamily = "sdf" | "smiles" | "csv" | "tsv";

export type CollectionSource = {
  path: string;
  extension: string;
  text: string;
};

export type MergedCollection = {
  family: CollectionFamily;
  extension: string;
  text: string;
  suggestedFileName: string;
  sourcePaths: string[];
};

const COLLECTION_EXTENSIONS = new Set(["csv", "sd", "sdf", "smi", "smiles", "tsv"]);

export function isMoleculeCollectionPath(path: string) {
  return COLLECTION_EXTENSIONS.has(collectionExtension(path));
}

export function collectionExtension(path: string) {
  const name = path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

export function mergeCollectionSources(sources: CollectionSource[]): MergedCollection {
  const cleanSources = sources.filter((source) => isMoleculeCollectionPath(source.path));
  if (cleanSources.length < 2) {
    throw new Error("Drop at least two molecule collections to merge them.");
  }

  const families = Array.from(new Set(cleanSources.map((source) => collectionFamily(source.extension))));
  if (families.some((family) => family === null) || families.length !== 1) {
    throw new Error("Collection merge supports one format family at a time: SDF, SMILES, CSV, or TSV.");
  }

  const family = families[0];
  if (!family) {
    throw new Error("Collection merge supports one format family at a time: SDF, SMILES, CSV, or TSV.");
  }
  const text = mergeCollectionText(family, cleanSources.map((source) => source.text));
  if (!text.trim()) throw new Error("Merged collection is empty.");

  const extension = family === "smiles" ? "smi" : family;
  return {
    family,
    extension,
    text,
    suggestedFileName: `merged-collection.${extension}`,
    sourcePaths: cleanSources.map((source) => source.path),
  };
}

export function collectionFamily(extension: string): CollectionFamily | null {
  const value = extension.trim().toLowerCase();
  if (value === "sd" || value === "sdf") return "sdf";
  if (value === "smi" || value === "smiles") return "smiles";
  if (value === "csv") return "csv";
  if (value === "tsv") return "tsv";
  return null;
}

function mergeCollectionText(family: CollectionFamily, texts: string[]) {
  if (family === "sdf") {
    const records = texts.flatMap((text) => text
      .split(/\$\$\$\$/)
      .map((record) => record.trim())
      .filter(Boolean));
    return records.map((record) => `${record}\n$$$$`).join("\n") + "\n";
  }
  if (family === "smiles") {
    return texts
      .flatMap((text) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
      .join("\n") + "\n";
  }

  const mergedLines: string[] = [];
  for (const [index, text] of texts.entries()) {
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (index === 0) mergedLines.push(...lines);
    else mergedLines.push(...lines.slice(1));
  }
  return mergedLines.join("\n") + "\n";
}
