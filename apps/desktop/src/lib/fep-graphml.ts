export type FepNetworkNode = {
  id: string;
  label: string;
  shortLabel: string;
  atoms: number;
  heavyAtoms: number;
  bonds: number;
  dockingScore: number | null;
  sourceAtomToMolAtom: Record<number, number>;
  sourceAtomAtomicNumbers: Record<number, number>;
  x: number;
  y: number;
  molblock: string;
};

export type FepNetworkEdge = {
  source: string;
  target: string;
  score: number;
  energy: number | null;
  uncertainty: number | null;
  mapping: Array<[number, number]>;
  mappedAtoms: number;
};

export type FepNetworkData = {
  nodes: FepNetworkNode[];
  edges: FepNetworkEdge[];
};

type GraphMlKey = {
  for: "node" | "edge" | "all";
  name: string;
};

type Moldict = {
  atoms?: unknown[];
  bonds?: unknown[];
  conformer?: unknown[];
  molprops?: Record<string, unknown>;
};

const atomSymbols: Record<number, string> = {
  1: "H",
  5: "B",
  6: "C",
  7: "N",
  8: "O",
  9: "F",
  15: "P",
  16: "S",
  17: "Cl",
  35: "Br",
  53: "I",
};

export function parseFepGraphml(text: string): FepNetworkData {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) throw new Error(parserError.textContent?.trim() || "Invalid GraphML");

  const keys = readGraphMlKeys(doc);
  const nodeMoldictKey = keyId(keys, "node", "moldict");
  const edgeAnnotationsKey = keyId(keys, "edge", "annotations");
  const edgeMappingKey = keyId(keys, "edge", "mapping");
  if (!nodeMoldictKey) throw new Error("GraphML is missing node moldict data");

  const nodes = Array.from(doc.getElementsByTagName("node")).map((node) => {
    const id = node.getAttribute("id") || "";
    const moldict = parseJsonData<Moldict>(node, nodeMoldictKey);
    return moldictToNode(id, moldict);
  });

  const edges = Array.from(doc.getElementsByTagName("edge")).map((edge) => {
    const annotations = edgeAnnotationsKey ? parseJsonData<Record<string, unknown>>(edge, edgeAnnotationsKey, {}) : {};
    const mapping = edgeMappingKey ? parseAtomMapping(parseJsonData<unknown[]>(edge, edgeMappingKey, [])) : [];
    return {
      source: edge.getAttribute("source") || "",
      target: edge.getAttribute("target") || "",
      score: typeof annotations.score === "number" ? annotations.score : 0,
      energy: firstNumberAnnotation(annotations, ["ddG", "ΔΔG", "deltaDeltaG", "delta_delta_g", "freeEnergy", "energy"]),
      uncertainty: firstNumberAnnotation(annotations, ["uncertainty", "error", "stderr", "std_error", "ddGError", "energyError"]),
      mapping,
      mappedAtoms: mapping.length,
    };
  }).filter((edge) => edge.source && edge.target);

  return layoutFepNetwork({ nodes, edges });
}

export function parseFepNetworkText(text: string): FepNetworkData {
  return text.trimStart().startsWith("<") ? parseFepGraphml(text) : parseFepEdgeList(text);
}

function parseFepEdgeList(text: string): FepNetworkData {
  const nodeLabels = new Map<string, string>();
  const nodeOrder: string[] = [];
  const edges: FepNetworkEdge[] = [];

  function ensureNode(id: string, label?: string) {
    if (!nodeLabels.has(id)) {
      nodeLabels.set(id, label || id);
      nodeOrder.push(id);
      return;
    }
    if (label && nodeLabels.get(id) === id) nodeLabels.set(id, label);
  }

  for (const line of text.split(/\r?\n/u)) {
    const [edgeText, commentText = ""] = line.split("#", 2);
    const match = edgeText.trim().match(/^([^\s:]+):([^\s:]+)\b/u);
    if (!match) continue;
    const [, source, target] = match;
    const labels = commentText.split("->", 2).map((value) => value.trim()).filter(Boolean);
    ensureNode(source, labels[0]);
    ensureNode(target, labels[1]);
    edges.push({
      source,
      target,
      score: 0,
      energy: null,
      uncertainty: null,
      mapping: [],
      mappedAtoms: 0,
    });
  }

  if (edges.length === 0) throw new Error("FEP edge list has no source:target edges");
  const nodes = nodeOrder.map((id) => emptyFepNode(id, nodeLabels.get(id) || id));
  return layoutFepNetwork({ nodes, edges });
}

function emptyFepNode(id: string, label: string): FepNetworkNode {
  return {
    id,
    label,
    shortLabel: shortLigandLabel(label),
    atoms: 0,
    heavyAtoms: 0,
    bonds: 0,
    dockingScore: null,
    sourceAtomToMolAtom: {},
    sourceAtomAtomicNumbers: {},
    x: 50,
    y: 50,
    molblock: "",
  };
}

function readGraphMlKeys(doc: XMLDocument) {
  const keys = new Map<string, GraphMlKey>();
  for (const key of Array.from(doc.getElementsByTagName("key"))) {
    const id = key.getAttribute("id");
    const target = key.getAttribute("for");
    const name = key.getAttribute("attr.name");
    if (!id || !name) continue;
    keys.set(id, {
      for: target === "node" || target === "edge" ? target : "all",
      name,
    });
  }
  return keys;
}

function keyId(keys: Map<string, GraphMlKey>, target: "node" | "edge", name: string) {
  for (const [id, key] of keys) {
    if ((key.for === target || key.for === "all") && key.name === name) return id;
  }
  return null;
}

function parseJsonData<T>(element: Element, key: string, fallback?: T): T {
  const data = Array.from(element.getElementsByTagName("data")).find((entry) => entry.getAttribute("key") === key);
  const text = data?.textContent?.trim();
  if (!text) {
    if (fallback !== undefined) return fallback;
    throw new Error(`GraphML entry is missing data key ${key}`);
  }
  return JSON.parse(text) as T;
}

function moldictToNode(id: string, moldict: Moldict): FepNetworkNode {
  const props = moldict.molprops ?? {};
  const label = stringProp(props, "ofe-name") || id || "ligand";
  const atoms = Array.isArray(moldict.atoms) ? moldict.atoms : [];
  const bonds = Array.isArray(moldict.bonds) ? moldict.bonds : [];
  const coordinates = parseConformerCoordinates(moldict.conformer, atoms.length);
  const molblock = moldictToMolblock(label, atoms, bonds, coordinates);
  const sourceAtomToMolAtom = sourceAtomToMolAtomMap(atoms);
  const sourceAtomAtomicNumbers = sourceAtomAtomicNumberMap(atoms);
  const heavyAtoms = atoms.filter((atom) => atomicNumber(atom) !== 1).length;
  const heavyBonds = bonds.filter((bond) => {
    const [left, right] = bondAtomIndexes(bond);
    return left !== null && right !== null && atomicNumber(atoms[left]) !== 1 && atomicNumber(atoms[right]) !== 1;
  }).length;
  return {
    id,
    label,
    shortLabel: shortLigandLabel(label),
    atoms: atoms.length,
    heavyAtoms,
    bonds: heavyBonds,
    dockingScore: numberProp(props, "docking score"),
    sourceAtomToMolAtom,
    sourceAtomAtomicNumbers,
    x: 50,
    y: 50,
    molblock,
  };
}

function sourceAtomToMolAtomMap(atoms: unknown[]) {
  const result: Record<number, number> = {};
  let molAtomIndex = 0;
  atoms.forEach((atom, atomIndex) => {
    if (atomicNumber(atom) === 1) return;
    result[atomIndex] = molAtomIndex;
    molAtomIndex += 1;
  });
  return result;
}

function sourceAtomAtomicNumberMap(atoms: unknown[]) {
  const result: Record<number, number> = {};
  atoms.forEach((atom, atomIndex) => {
    const atomicNo = atomicNumber(atom);
    if (atomicNo > 0) result[atomIndex] = atomicNo;
  });
  return result;
}

function parseAtomMapping(value: unknown[]) {
  const mapping: Array<[number, number]> = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const source = integerValue(entry[0]);
    const target = integerValue(entry[1]);
    if (source === null || target === null) continue;
    mapping.push([source, target]);
  }
  return mapping;
}

function integerValue(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function moldictToMolblock(label: string, atoms: unknown[], bonds: unknown[], coordinates: number[][] | null = null) {
  const heavyIndexByAtom = new Map<number, number>();
  const atomLines: string[] = [];
  atoms.forEach((atom, atomIndex) => {
    const atomicNo = atomicNumber(atom);
    if (atomicNo === 1) return;
    heavyIndexByAtom.set(atomIndex, atomLines.length + 1);
    const coord = coordinates?.[atomIndex] ?? [0, 0, 0];
    atomLines.push(`${molCoord(coord[0] ?? 0)}${molCoord(coord[1] ?? 0)}${molCoord(0)} ${atomSymbol(atomicNo).padEnd(3, " ")} 0  0  0  0  0  0  0  0  0  0  0  0`);
  });

  const aromaticBondTypes = kekuleAromaticBondTypes(atoms, bonds);
  const bondLines: string[] = [];
  bonds.forEach((bond, bondIndex) => {
    const [left, right] = bondAtomIndexes(bond);
    if (left === null || right === null) return;
    const from = heavyIndexByAtom.get(left);
    const to = heavyIndexByAtom.get(right);
    if (!from || !to) return;
    const bondType = aromaticBondTypes.get(bondIndex) ?? molBondType(bond);
    bondLines.push(`${from.toString().padStart(3, " ")}${to.toString().padStart(3, " ")}${bondType.toString().padStart(3, " ")}  0  0  0  0`);
  });

  return [
    label.slice(0, 80),
    "Burette FEP GraphML",
    "",
    `${atomLines.length.toString().padStart(3, " ")}${bondLines.length.toString().padStart(3, " ")}  0  0  0  0            999 V2000`,
    ...atomLines,
    ...bondLines,
    "M  END",
    "",
  ].join("\n");
}

function layoutFepNetwork(data: FepNetworkData): FepNetworkData {
  if (data.nodes.length <= 1) return data;
  const degree = new Map(data.nodes.map((node) => [node.id, 0]));
  for (const edge of data.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  const center = [...data.nodes].sort((left, right) => (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0))[0];
  if (!center) return data;
  if ((degree.get(center.id) ?? 0) >= Math.max(2, data.nodes.length - 1)) {
    return { nodes: starLayout(data.nodes, center.id, data.edges), edges: data.edges };
  }
  const layout = forceLayout(data, center.id, degree);
  const positioned = data.nodes.map((node) => ({ ...node, ...(layout.get(node.id) ?? { x: node.x, y: node.y }) }));
  return { nodes: positioned, edges: data.edges };
}

function starLayout(nodes: FepNetworkNode[], centerId: string, edges: FepNetworkEdge[]) {
  const leaves = nodes
    .filter((node) => node.id !== centerId)
    .sort((left, right) => left.id.localeCompare(right.id));
  const edgeLengthByNode = starEdgeLengthByNode(centerId, edges);
  const compactSlots = [
    { x: 25, y: 20 },
    { x: 75, y: 20 },
    { x: 75, y: 80 },
    { x: 25, y: 80 },
  ];
  const radiusX = leaves.length <= 4 ? 30 : 34;
  const radiusY = leaves.length <= 4 ? 31 : 32;
  return nodes.map((node) => {
    if (node.id === centerId) return { ...node, x: 50, y: 50 };
    const index = leaves.findIndex((leaf) => leaf.id === node.id);
    const compactSlot = leaves.length <= compactSlots.length ? compactSlots[index] : undefined;
    const lengthScale = edgeLengthByNode.get(node.id) ?? 1;
    if (compactSlot) {
      return {
        ...node,
        x: 50 + (compactSlot.x - 50) * lengthScale,
        y: 50 + (compactSlot.y - 50) * lengthScale,
      };
    }
    const angle = -Math.PI * 0.72 + (index / Math.max(1, leaves.length)) * Math.PI * 2 + Math.PI / Math.max(8, leaves.length * 2);
    return {
      ...node,
      x: 50 + Math.cos(angle) * radiusX * lengthScale,
      y: 50 + Math.sin(angle) * radiusY * lengthScale,
    };
  });
}

function starEdgeLengthByNode(centerId: string, edges: FepNetworkEdge[]) {
  const energyRange = metricRange(edges.map((edge) => edge.energy));
  const scoreRange = metricRange(edges.map((edge) => edge.score));
  const result = new Map<string, number>();
  for (const edge of edges) {
    const leafId = edge.source === centerId ? edge.target : edge.target === centerId ? edge.source : null;
    if (!leafId) continue;
    const normalized = edge.energy !== null && energyRange
      ? Math.abs(signedRangeMetric(edge.energy, energyRange))
      : scoreRange ? normalizedRangeMetric(edge.score, scoreRange) : Math.max(0, Math.min(1, edge.score));
    result.set(leafId, 0.96 + normalized * 0.12);
  }
  return result;
}

function metricRange(values: Array<number | null | undefined>) {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!numbers.length) return null;
  return { min: Math.min(...numbers), max: Math.max(...numbers) };
}

function normalizedRangeMetric(value: number, range: { min: number; max: number }) {
  if (range.max === range.min) return 1;
  return Math.max(0, Math.min(1, (value - range.min) / (range.max - range.min)));
}

function signedRangeMetric(value: number, range: { min: number; max: number }) {
  const maxAbs = Math.max(Math.abs(range.min), Math.abs(range.max), 0.001);
  return Math.max(-1, Math.min(1, value / maxAbs));
}

function forceLayout(data: FepNetworkData, centerId: string, degree: Map<string, number>) {
  const sortedNodes = [...data.nodes].sort((left, right) => {
    if (left.id === centerId) return -1;
    if (right.id === centerId) return 1;
    return (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0) || left.id.localeCompare(right.id);
  });
  const state = new Map(sortedNodes.map((node, index) => {
    if (node.id === centerId) return [node.id, { x: 0, y: 0, vx: 0, vy: 0 }];
    const angle = -Math.PI / 2 + ((index - 1) / Math.max(1, sortedNodes.length - 1)) * Math.PI * 2;
    const ring = 0.58 + ((index - 1) % 2) * 0.08;
    return [node.id, {
      x: Math.cos(angle) * ring,
      y: Math.sin(angle) * ring,
      vx: 0,
      vy: 0,
    }];
  }));

  const idealEdgeLength = Math.max(0.42, Math.min(0.7, 1.7 / Math.sqrt(data.nodes.length)));
  for (let tick = 0; tick < 260; tick += 1) {
    const cooling = 1 - tick / 260;
    for (let leftIndex = 0; leftIndex < sortedNodes.length; leftIndex += 1) {
      const left = state.get(sortedNodes[leftIndex].id);
      if (!left) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < sortedNodes.length; rightIndex += 1) {
        const right = state.get(sortedNodes[rightIndex].id);
        if (!right) continue;
        const dx = right.x - left.x || seededOffset(leftIndex, rightIndex);
        const dy = right.y - left.y || seededOffset(rightIndex, leftIndex);
        const distance = Math.max(0.04, Math.hypot(dx, dy));
        const force = 0.0065 * cooling / (distance * distance);
        const fx = dx / distance * force;
        const fy = dy / distance * force;
        left.vx -= fx;
        left.vy -= fy;
        right.vx += fx;
        right.vy += fy;
      }
    }
    for (const edge of data.edges) {
      const source = state.get(edge.source);
      const target = state.get(edge.target);
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(0.04, Math.hypot(dx, dy));
      const force = (distance - idealEdgeLength) * 0.035;
      const fx = dx / distance * force;
      const fy = dy / distance * force;
      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    }
    for (const [id, point] of state) {
      const gravity = id === centerId ? 0.035 : 0.0075;
      point.vx -= point.x * gravity;
      point.vy -= point.y * gravity;
      const speed = Math.max(1, Math.hypot(point.vx, point.vy) / 0.08);
      point.x += point.vx / speed;
      point.y += point.vy / speed;
      point.vx *= 0.62;
      point.vy *= 0.62;
    }
  }

  const normalized = normalizeLayout(state);
  relaxCardCollisions(normalized, data.edges);
  return normalized;
}

function normalizeLayout(state: Map<string, { x: number; y: number }>) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of state.values()) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const width = Math.max(0.1, maxX - minX);
  const height = Math.max(0.1, maxY - minY);
  const paddingX = 13;
  const paddingY = 15;
  return new Map([...state].map(([id, point]) => [id, {
    x: paddingX + ((point.x - minX) / width) * (100 - paddingX * 2),
    y: paddingY + ((point.y - minY) / height) * (100 - paddingY * 2),
  }]));
}

function relaxCardCollisions(points: Map<string, { x: number; y: number }>, edges: FepNetworkEdge[]) {
  const minX = 22;
  const minY = 20;
  const connected = new Set(edges.flatMap((edge) => [`${edge.source}:${edge.target}`, `${edge.target}:${edge.source}`]));
  const entries = [...points];
  for (let tick = 0; tick < 120; tick += 1) {
    let moved = false;
    for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
      const [leftId, left] = entries[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
        const [rightId, right] = entries[rightIndex];
        const dx = right.x - left.x || seededOffset(leftIndex, rightIndex);
        const dy = right.y - left.y || seededOffset(rightIndex, leftIndex);
        if (Math.abs(dx) >= minX || Math.abs(dy) >= minY) continue;
        const linked = connected.has(`${leftId}:${rightId}`);
        const push = linked ? 0.42 : 0.64;
        const angle = Math.atan2(dy, dx);
        const pushX = Math.cos(angle) * push;
        const pushY = Math.sin(angle) * push;
        left.x -= pushX;
        left.y -= pushY;
        right.x += pushX;
        right.y += pushY;
        moved = true;
      }
    }
    for (const [, point] of entries) {
      point.x = Math.max(8, Math.min(92, point.x));
      point.y = Math.max(10, Math.min(90, point.y));
    }
    if (!moved) break;
  }
}

function seededOffset(left: number, right: number) {
  return (((left + 3) * 17 + (right + 5) * 29) % 19 - 9) / 100;
}

function parseConformerCoordinates(conformer: unknown, atomCount: number) {
  if (!Array.isArray(conformer) || typeof conformer[0] !== "string") return null;
  const bytes = Uint8Array.from(conformer[0], (char) => char.charCodeAt(0) & 0xff);
  if (bytes.length < 16 || bytes[0] !== 0x93 || String.fromCharCode(...bytes.slice(1, 6)) !== "NUMPY") return null;
  const majorVersion = bytes[6];
  const headerLength = majorVersion === 1
    ? bytes[8] | (bytes[9] << 8)
    : bytes[8] | (bytes[9] << 8) | (bytes[10] << 16) | (bytes[11] << 24);
  const headerStart = majorVersion === 1 ? 10 : 12;
  const dataStart = headerStart + headerLength;
  if (dataStart >= bytes.length || (bytes.length - dataStart) < atomCount * 3 * 8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset + dataStart);
  const coordinates: number[][] = [];
  for (let atomIndex = 0; atomIndex < atomCount; atomIndex += 1) {
    const offset = atomIndex * 3 * 8;
    coordinates.push([
      view.getFloat64(offset, true),
      view.getFloat64(offset + 8, true),
      view.getFloat64(offset + 16, true),
    ]);
  }
  return coordinates;
}

function atomicNumber(atom: unknown) {
  if (!Array.isArray(atom)) return 6;
  const value = atom[0];
  return typeof value === "number" && Number.isFinite(value) ? value : 6;
}

function atomSymbol(atomicNo: number) {
  return atomSymbols[atomicNo] ?? "C";
}

function atomIsAromatic(atom: unknown) {
  return Array.isArray(atom) && atom[3] === true;
}

function bondAtomIndexes(bond: unknown): [number | null, number | null] {
  if (!Array.isArray(bond)) return [null, null];
  const left = typeof bond[0] === "number" && Number.isInteger(bond[0]) ? bond[0] : null;
  const right = typeof bond[1] === "number" && Number.isInteger(bond[1]) ? bond[1] : null;
  return [left, right];
}

function kekuleAromaticBondTypes(atoms: unknown[], bonds: unknown[]) {
  const aromaticEdges: Array<{ bondIndex: number; left: number; right: number }> = [];
  bonds.forEach((bond, bondIndex) => {
    if (!bondIsAromatic(bond)) return;
    const [left, right] = bondAtomIndexes(bond);
    if (left === null || right === null) return;
    if (!atomIsAromatic(atoms[left]) || !atomIsAromatic(atoms[right])) return;
    aromaticEdges.push({ bondIndex, left, right });
  });

  const result = new Map<number, number>();
  const usedAtoms = new Set<number>();
  aromaticEdges.forEach((edge) => {
    if (usedAtoms.has(edge.left) || usedAtoms.has(edge.right)) {
      result.set(edge.bondIndex, 1);
      return;
    }
    result.set(edge.bondIndex, 2);
    usedAtoms.add(edge.left);
    usedAtoms.add(edge.right);
  });
  aromaticEdges.forEach((edge) => {
    if (!result.has(edge.bondIndex)) result.set(edge.bondIndex, 1);
  });
  return result;
}

function bondIsAromatic(bond: unknown) {
  return Array.isArray(bond) && bond[2] === 12;
}

function molBondType(bond: unknown) {
  if (!Array.isArray(bond)) return 1;
  const value = typeof bond[2] === "number" ? bond[2] : 1;
  if (value === 12) return 4;
  if (value === 1 || value === 2 || value === 3 || value === 4) return value;
  return 1;
}

function firstNumberAnnotation(annotations: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = annotations[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function numberProp(props: Record<string, unknown>, key: string) {
  const value = props[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringProp(props: Record<string, unknown>, key: string) {
  const value = props[key];
  return typeof value === "string" ? value : null;
}

function shortLigandLabel(label: string) {
  return label.replace(/^Suze_/u, "").replace(/_/gu, " ");
}

function molCoord(value: number) {
  return value.toFixed(4).padStart(10, " ");
}
