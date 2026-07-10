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

export type SdfCollectionRecord = {
  index: number;
  name: string;
  smiles?: string;
  molblock: string;
  props: Record<string, string>;
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
  if (sources.length < 2) {
    throw new Error("Drop at least two molecule collections to merge them.");
  }

  const cleanSources = sources.map((source, index) => {
    if (!isMoleculeCollectionPath(source.path)) {
      throw new Error(`${source.path || `Collection source ${index + 1}`} is not a supported molecule collection.`);
    }
    if (!source.text.trim()) {
      throw new Error(`${source.path || `Collection source ${index + 1}`} is empty.`);
    }
    return source;
  });

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
    const records = texts.flatMap((text, index) => {
      const sourceRecords = splitSdfCollectionRecords(text);
      if (sourceRecords.length === 0) throw new Error(`SDF collection source ${index + 1} does not contain any records.`);
      return sourceRecords;
    });
    return records.map((record) => `${record}\n$$$$`).join("\n") + "\n";
  }
  if (family === "smiles") {
    return texts.flatMap((text, index) => {
      const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
      if (!lines.some((line) => !line.startsWith("#"))) {
        throw new Error(`SMILES collection source ${index + 1} does not contain any molecule records.`);
      }
      return lines;
    })
      .join("\n") + "\n";
  }

  return mergeDelimitedCollectionText(texts, family === "csv" ? "," : "\t", family.toUpperCase());
}

export function splitSdfCollectionRecords(text: string) {
  const records: string[] = [];
  let lines: string[] = [];
  const finish = () => {
    const record = lines.join("\n").trim();
    lines = [];
    if (record) records.push(record);
  };
  for (const line of text.replace(/\r\n?/gu, "\n").split("\n")) {
    if (/^\s*\$\$\$\$\s*$/u.test(line)) finish();
    else lines.push(line);
  }
  finish();
  return records;
}

export function parseSdfCollectionRecords(text: string): SdfCollectionRecord[] {
  return splitSdfCollectionRecords(text).map((record, index) => {
    const lines = record.split("\n");
    const props = parseSdfProperties(lines);
    const title = lines[0]?.trim();
    const name = [props.Name, props.NAME, props.ID, title]
      .find((value) => value?.trim())
      ?.trim() ?? `Molecule ${index + 1}`;
    const smiles = [props.SMILES, props.Smiles, props.smiles]
      .find((value) => value?.trim())
      ?.trim();
    return {
      index,
      name,
      ...(smiles ? { smiles } : {}),
      molblock: extractSdfMolblock(lines),
      props,
    };
  });
}

function parseSdfProperties(lines: string[]) {
  const props: Record<string, string> = {};
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^>\s*<([^>]+)>/u.exec(lines[index] || "");
    if (!match) continue;
    const values: string[] = [];
    index += 1;
    while (index < lines.length && lines[index].trim() !== "") {
      values.push(lines[index]);
      index += 1;
    }
    props[match[1].trim()] = values.join("\n");
  }
  return props;
}

function extractSdfMolblock(lines: string[]) {
  const molEnd = lines.findIndex((line) => line.trim() === "M  END");
  const propertyStart = lines.findIndex((line) => /^>\s*</u.test(line));
  const end = molEnd >= 0 ? molEnd + 1 : (propertyStart >= 0 ? propertyStart : lines.length);
  return lines.slice(0, end).join("\n").trimEnd();
}

function mergeDelimitedCollectionText(texts: string[], separator: "," | "\t", label: string) {
  let expectedHeader: string[] | null = null;
  const outputLines: string[] = [];
  for (const [index, text] of texts.entries()) {
    const lines = text.replace(/\r\n?/gu, "\n").split("\n");
    const headerIndex = lines.findIndex((line) => line.trim().length > 0);
    if (headerIndex < 0) throw new Error(`${label} collection source ${index + 1} is empty.`);
    const headerLine = lines[headerIndex].replace(/^\uFEFF/u, "");
    const header = parseDelimitedHeader(headerLine, separator).map((cell) => cell.trim().toLowerCase());
    if (header.length === 0 || header.every((cell) => !cell)) {
      throw new Error(`${label} collection source ${index + 1} has an empty header.`);
    }
    if (expectedHeader && !sameHeader(expectedHeader, header)) {
      throw new Error(`${label} collection headers must use the same columns in the same order.`);
    }
    expectedHeader ??= header;
    const dataLines = lines.slice(headerIndex + 1);
    while (dataLines.length > 0 && !dataLines[dataLines.length - 1].trim()) dataLines.pop();
    if (!dataLines.some((line) => line.trim().length > 0)) {
      throw new Error(`${label} collection source ${index + 1} does not contain any data rows.`);
    }
    if (index === 0) outputLines.push(headerLine);
    outputLines.push(...dataLines);
  }
  while (outputLines.length > 0 && !outputLines[outputLines.length - 1].trim()) outputLines.pop();
  return outputLines.join("\n") + "\n";
}

function sameHeader(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function parseDelimitedHeader(line: string, separator: "," | "\t") {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === separator && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}
