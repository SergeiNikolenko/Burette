export function sourceAtomPositions(source: string) {
  const rows = source.replace(/\r\n?/gu, "\n").split("\n");
  if (rows[3]?.includes("V3000")) {
    const begin = rows.findIndex(row => row.trimEnd() === "M  V30 BEGIN ATOM");
    const end = rows.findIndex(row => row.trimEnd() === "M  V30 END ATOM");
    if (begin < 5 || end <= begin) return [];
    const atomRows = rows.slice(begin + 1, end).join("\n").replace(/-\nM  V30 /gu, "").split("\n");
    return atomRows.map(row => {
      const match = /^M  V30\s+\d+\s+(?:"[^"]*"|\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+\d+(?:\s|$)/u.exec(row);
      return match?.slice(1).map(molCoordinate) ?? [];
    });
  }
  const count = Number(rows[3]?.slice(0, 3));
  if (!Number.isInteger(count) || count < 1 || !/^\s*\d+\s*$/u.test(rows[3].slice(0, 3))) return [];
  return rows.slice(4, 4 + count).map(row => [0, 10, 20].map(offset => molCoordinate(row.slice(offset, offset + 10).trim())));
}

function molCoordinate(value: string) {
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value) ? Number(value) : NaN;
}

