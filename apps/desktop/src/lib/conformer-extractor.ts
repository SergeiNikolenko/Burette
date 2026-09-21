export const CONFORMER_EXTRACTOR_ABI_VERSION = 1;
export const CONFORMER_EXTRACTOR_RDKIT_RELEASE = 20_250_304;

export const conformerVariants = [
  "DG",
  "KDG",
  "ETDG",
  "ETDGv2",
  "ETKDG",
  "ETKDGv2",
  "ETKDGv3",
  "srETKDGv3",
] as const;

export type NativeConformerVariant = typeof conformerVariants[number];

export type NativeConformerParameters = {
  variant: NativeConformerVariant;
  atomicNumbers: Uint16Array;
  formalCharges: Int8Array;
  distanceAtomPairs: Uint32Array;
  distanceBoundsSquared: Float32Array;
  distanceWeights: Float32Array;
  chiralAtomQuads: Uint32Array;
  chiralVolumeBounds: Float32Array;
  torsionAtomQuads: Uint32Array;
  torsionCoefficients: Float32Array;
  torsionSigns: Int8Array;
  improperAtomQuads: Uint32Array;
  improperWeights: Float32Array;
  etkDistanceAtomPairs: Uint32Array;
  etkDistanceBounds: Float32Array;
  etkDistanceKinds: Uint8Array;
  etkDistanceWeights: Float32Array;
  stereoAtomQuints: Uint32Array;
  stereoFlags: Uint8Array;
};

const HEADER_BYTES = 64;
const MAGIC = [0x42, 0x43, 0x45, 0x58] as const;

export function parseNativeConformerParameters(
  bytes: Uint8Array,
  expectedVariant: NativeConformerVariant,
  maximumBytes: number,
): NativeConformerParameters {
  if (!(bytes instanceof Uint8Array)
    || !Number.isSafeInteger(maximumBytes)
    || maximumBytes < HEADER_BYTES
    || bytes.byteLength > maximumBytes
    || bytes.byteLength < HEADER_BYTES) {
    throw new Error("RDKit conformer extractor output is outside the admitted byte envelope.");
  }
  if (bytes.byteOffset % 4 !== 0) {
    throw new Error("RDKit conformer extractor output is not 4-byte aligned.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < MAGIC.length; index += 1) {
    if (view.getUint8(index) !== MAGIC[index]) {
      throw new Error("RDKit conformer extractor output has an invalid magic value.");
    }
  }
  if (view.getUint16(4, true) !== CONFORMER_EXTRACTOR_ABI_VERSION
    || view.getUint16(6, true) !== HEADER_BYTES
    || view.getUint8(9) !== 0
    || view.getUint16(10, true) !== 0
    || view.getUint32(48, true) !== CONFORMER_EXTRACTOR_RDKIT_RELEASE) {
    throw new Error("RDKit conformer extractor header is incompatible with ABI v1.");
  }
  for (let offset = 52; offset < HEADER_BYTES; offset += 1) {
    if (view.getUint8(offset) !== 0) {
      throw new Error("RDKit conformer extractor reserved header bytes are not zero.");
    }
  }

  const variant = conformerVariants[view.getUint8(8)];
  if (!variant || variant !== expectedVariant) {
    throw new Error("RDKit conformer extractor variant differs from the requested variant.");
  }
  const counts = Array.from({ length: 7 }, (_, index) => view.getUint32(12 + index * 4, true));
  const [atoms, distances, chiral, torsions, impropers, etkDistances, stereo] = counts;
  if (atoms === 0) {
    throw new Error("RDKit conformer extractor returned an empty molecule.");
  }
  const payloadBytes = view.getUint32(40, true);
  const totalBytes = view.getUint32(44, true);
  if (totalBytes !== bytes.byteLength || payloadBytes !== totalBytes - HEADER_BYTES) {
    throw new Error("RDKit conformer extractor byte counts differ from the received buffer.");
  }

  let offset = HEADER_BYTES;
  const section = <T extends ArrayBufferView>(
    Constructor: TypedArrayConstructor<T>,
    count: number,
    width: number,
    label: string,
  ): T => {
    const elements = checkedProduct(count, width, `${label} element count`);
    offset = align(offset, Constructor.BYTES_PER_ELEMENT);
    const byteLength = checkedProduct(elements, Constructor.BYTES_PER_ELEMENT, `${label} byte count`);
    const end = offset + byteLength;
    if (!Number.isSafeInteger(end) || end > bytes.byteLength) {
      throw new Error(`RDKit conformer extractor ${label} exceeds its buffer.`);
    }
    const result = new Constructor(bytes.buffer, bytes.byteOffset + offset, elements);
    offset = end;
    return result;
  };

  const result: NativeConformerParameters = {
    variant,
    atomicNumbers: section(Uint16Array, atoms, 1, "atomicNumbers"),
    formalCharges: section(Int8Array, atoms, 1, "formalCharges"),
    distanceAtomPairs: section(Uint32Array, distances, 2, "distanceAtomPairs"),
    distanceBoundsSquared: section(Float32Array, distances, 2, "distanceBoundsSquared"),
    distanceWeights: section(Float32Array, distances, 1, "distanceWeights"),
    chiralAtomQuads: section(Uint32Array, chiral, 4, "chiralAtomQuads"),
    chiralVolumeBounds: section(Float32Array, chiral, 2, "chiralVolumeBounds"),
    torsionAtomQuads: section(Uint32Array, torsions, 4, "torsionAtomQuads"),
    torsionCoefficients: section(Float32Array, torsions, 6, "torsionCoefficients"),
    torsionSigns: section(Int8Array, torsions, 6, "torsionSigns"),
    improperAtomQuads: section(Uint32Array, impropers, 4, "improperAtomQuads"),
    improperWeights: section(Float32Array, impropers, 1, "improperWeights"),
    etkDistanceAtomPairs: section(Uint32Array, etkDistances, 2, "etkDistanceAtomPairs"),
    etkDistanceBounds: section(Float32Array, etkDistances, 2, "etkDistanceBounds"),
    etkDistanceKinds: section(Uint8Array, etkDistances, 1, "etkDistanceKinds"),
    etkDistanceWeights: section(Float32Array, etkDistances, 1, "etkDistanceWeights"),
    stereoAtomQuints: section(Uint32Array, stereo, 5, "stereoAtomQuints"),
    stereoFlags: section(Uint8Array, stereo, 1, "stereoFlags"),
  };
  if (offset !== bytes.byteLength) {
    throw new Error("RDKit conformer extractor output has trailing or missing payload bytes.");
  }
  validateParameters(result);
  return result;
}

type TypedArrayConstructor<T extends ArrayBufferView> = {
  readonly BYTES_PER_ELEMENT: number;
  new(buffer: ArrayBufferLike, byteOffset: number, length: number): T;
};

function checkedProduct(left: number, right: number, label: string) {
  const result = left * right;
  if (!Number.isSafeInteger(result)) {
    throw new Error(`RDKit conformer extractor ${label} overflowed.`);
  }
  return result;
}

function align(offset: number, alignment: number) {
  return Math.ceil(offset / alignment) * alignment;
}

function validateParameters(parameters: NativeConformerParameters) {
  const atomCount = parameters.atomicNumbers.length;
  if (parameters.atomicNumbers.some((value) => value < 1 || value > 118)) {
    throw new Error("RDKit conformer extractor returned an unsupported atomic number.");
  }
  for (const [label, indices] of [
    ["distanceAtomPairs", parameters.distanceAtomPairs],
    ["chiralAtomQuads", parameters.chiralAtomQuads],
    ["torsionAtomQuads", parameters.torsionAtomQuads],
    ["improperAtomQuads", parameters.improperAtomQuads],
    ["etkDistanceAtomPairs", parameters.etkDistanceAtomPairs],
    ["stereoAtomQuints", parameters.stereoAtomQuints],
  ] as const) {
    if (indices.some((value) => value >= atomCount)) {
      throw new Error(`RDKit conformer extractor ${label} contains an out-of-range atom index.`);
    }
  }
  for (const [label, values] of [
    ["distanceBoundsSquared", parameters.distanceBoundsSquared],
    ["distanceWeights", parameters.distanceWeights],
    ["chiralVolumeBounds", parameters.chiralVolumeBounds],
    ["torsionCoefficients", parameters.torsionCoefficients],
    ["improperWeights", parameters.improperWeights],
    ["etkDistanceBounds", parameters.etkDistanceBounds],
    ["etkDistanceWeights", parameters.etkDistanceWeights],
  ] as const) {
    if (values.some((value) => !Number.isFinite(value))) {
      throw new Error(`RDKit conformer extractor ${label} contains a non-finite value.`);
    }
  }
  validatePairs(parameters.distanceAtomPairs, parameters.distanceBoundsSquared, "distance");
  validatePairs(parameters.etkDistanceAtomPairs, parameters.etkDistanceBounds, "ETK distance");
  if (parameters.distanceWeights.some((value) => value < 0)
    || parameters.improperWeights.some((value) => value < 0)
    || parameters.etkDistanceWeights.some((value) => value < 0)) {
    throw new Error("RDKit conformer extractor returned a negative constraint weight.");
  }
  for (let term = 0; term < parameters.chiralVolumeBounds.length; term += 2) {
    if (parameters.chiralVolumeBounds[term] > parameters.chiralVolumeBounds[term + 1]) {
      throw new Error("RDKit conformer extractor returned inverted chiral bounds.");
    }
  }
  if (parameters.torsionSigns.some((value) => value < -1 || value > 1)) {
    throw new Error("RDKit conformer extractor returned an unsupported torsion sign.");
  }
  if (parameters.etkDistanceKinds.some((value) => value === 0)
    || parameters.stereoFlags.some((value) => value > 1)) {
    throw new Error("RDKit conformer extractor returned unsupported term metadata.");
  }
}

function validatePairs(pairs: Uint32Array, bounds: Float32Array, label: string) {
  let previousLeft = -1;
  let previousRight = -1;
  for (let term = 0; term < pairs.length / 2; term += 1) {
    const left = pairs[term * 2];
    const right = pairs[term * 2 + 1];
    const lower = bounds[term * 2];
    const upper = bounds[term * 2 + 1];
    if (left >= right
      || left < previousLeft
      || (left === previousLeft && right <= previousRight)) {
      throw new Error(`RDKit conformer extractor ${label} pairs are not canonical and sorted.`);
    }
    if (lower < 0 || upper <= 0 || lower > upper) {
      throw new Error(`RDKit conformer extractor ${label} bounds are outside their domain.`);
    }
    previousLeft = left;
    previousRight = right;
  }
}
