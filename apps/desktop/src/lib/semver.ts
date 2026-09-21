type ParsedIdentifier =
  | { kind: "numeric"; value: number }
  | { kind: "text"; value: string };

type ParsedVersion = {
  core: number[];
  prerelease: ParsedIdentifier[];
};

export function compareVersions(left: string, right: string) {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  const coreComparison = compareNumericParts(leftVersion.core, rightVersion.core);
  if (coreComparison !== 0) return coreComparison;
  return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease);
}

function parseVersion(raw: string): ParsedVersion {
  const trimmed = raw.trim().replace(/^v/i, "");
  const [withoutBuildMetadata] = trimmed.split("+", 1);
  const separatorIndex = withoutBuildMetadata.indexOf("-");
  const corePart =
    separatorIndex >= 0 ? withoutBuildMetadata.slice(0, separatorIndex) : withoutBuildMetadata;
  const prereleasePart =
    separatorIndex >= 0 ? withoutBuildMetadata.slice(separatorIndex + 1) : "";
  return {
    core: corePart.split(".").map(parseNumericPart),
    prerelease: prereleasePart
      ? prereleasePart.split(".").filter(Boolean).map(parseIdentifier)
      : [],
  };
}

function parseNumericPart(value: string) {
  return /^\d+$/.test(value) ? Number.parseInt(value, 10) : 0;
}

function parseIdentifier(value: string): ParsedIdentifier {
  if (/^\d+$/.test(value)) {
    return { kind: "numeric", value: Number.parseInt(value, 10) };
  }
  return { kind: "text", value };
}

function compareNumericParts(left: number[], right: number[]) {
  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a > b ? 1 : -1;
  }
  return 0;
}

function comparePrerelease(left: ParsedIdentifier[], right: ParsedIdentifier[]) {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;
  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!a) return -1;
    if (!b) return 1;
    if (a.kind === "numeric" && b.kind === "numeric") {
      if (a.value !== b.value) return a.value > b.value ? 1 : -1;
      continue;
    }
    if (a.kind === "numeric") return -1;
    if (b.kind === "numeric") return 1;
    if (a.value !== b.value) return a.value > b.value ? 1 : -1;
  }
  return 0;
}
