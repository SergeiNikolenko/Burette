/** Restore native conformer coordinates into the original SDF records.
 * The artifact's molecule ordinal (not its frame order) identifies the source.
 * Keep bonds, atom annotations, names and all SD properties verbatim.
 */
export function conformerCollectionSdf(source: string, xyz: string, ensemble = false): string {
  const records = source.replace(/\r\n?/gu, "\n").split(/^\$\$\$\$[^\S\n]*(?:\n|$)/mu)
    .filter(record => record.trim()).map(record => record.replace(/\n$/u, ""));
  const results = records.map(() => [] as string[]);
  const lines = xyz.trimEnd().split(/\r?\n/u);
  for (let cursor = 0; cursor < lines.length;) {
    const count = Number(lines[cursor++]);
    const comment = lines[cursor++] ?? "";
    const ordinal = /\bmolecule=(\d+)\b/u.exec(comment);
    if (!Number.isInteger(count) || count <= 0 || !ordinal || cursor + count > lines.length) {
      throw new Error("Invalid native conformer artifact");
    }
    const index = Number(ordinal[1]);
    const record = records[index];
    if (record === undefined) throw new Error("Conformer references an unknown source molecule");
    const atoms = lines.slice(cursor, cursor + count).map(line => {
      const [element, ...values] = line.trim().split(/\s+/u);
      const coordinates = values.map(Number);
      if (!element || coordinates.length !== 3 || !coordinates.every(Number.isFinite)) {
        throw new Error("Invalid conformer coordinates");
      }
      return { element, coordinates };
    });
    cursor += count;
    if (!/\bstereo=passed\b/u.test(comment)) continue;
    // Native artifacts rank each molecule's conformers by energy.
    if (!ensemble && results[index].length) continue;
    const output = record.split("\n");
    const counts = output.findIndex(line => /\bV2000\b/u.test(line));
    if (counts >= 0) {
      if (Number(output[counts].slice(0, 3)) !== count) throw new Error("Conformer atom count differs from source");
      atoms.forEach(({ element, coordinates }, offset) => {
        const line = output[counts + 1 + offset] ?? "";
        if (line.slice(31, 34).trim() !== element) throw new Error("Conformer atom order differs from source");
        const fields = coordinates.map(value => value.toFixed(4).padStart(10));
        if (fields.some(field => field.length !== 10)) throw new Error("Conformer coordinate exceeds V2000 range");
        output[counts + 1 + offset] = fields.join("") + line.slice(30);
      });
    } else {
      const start = output.findIndex(line => line.trim() === "M  V30 BEGIN ATOM");
      const end = output.findIndex(line => line.trim() === "M  V30 END ATOM");
      if (start < 0 || end - start - 1 !== count) throw new Error("Unsupported conformer source atom block");
      atoms.forEach(({ element, coordinates }, offset) => {
        const line = output[start + 1 + offset];
        const match = /^(M  V30\s+\d+\s+)(\S+)(\s+)\S+\s+\S+\s+\S+(.*)$/u.exec(line);
        if (!match || match[2] !== element) throw new Error("Conformer atom order differs from source");
        output[start + 1 + offset] = `${match[1]}${element}${match[3]}${coordinates.join(" ")}${match[4]}`;
      });
    }
    // Molfile dimensional code belongs to the second header line.
    if (/[23]D\s*$/u.test(output[1] ?? "")) {
      output[1] = output[1].replace(/[23]D(\s*)$/u, "3D$1");
    }
    results[index].push(output.join("\n"));
  }
  return results.flatMap((generated, index) => generated.length ? generated : [records[index]])
    .map(record => `${record}\n$$$$\n`).join("");
}
