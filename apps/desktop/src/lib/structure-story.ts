const MAX_DOCUMENT_ID_LENGTH = 256;
const MAX_FILE_NAME_LENGTH = 512;
const MAX_STAGE_LENGTH = 160;
const MAX_SUMMARY_LENGTH = 8_000;
const MAX_CHAIN_LENGTH = 64;
const MAX_STEP_COUNT = 10_000;
const MAX_RESIDUE_COUNT = 1_000_000;

export type StructureStoryComparison = {
  rmsd: number;
  chain: string;
  residueCount: number;
};

export type StructureStory = {
  documentId: string;
  stepIndex: number;
  stepCount: number;
  fileName: string;
  stage: string;
  summary: string;
  comparison: StructureStoryComparison | null;
  source?: "mvs";
  key?: string | null;
  isPlaying?: boolean;
  descriptionFormat?: "markdown" | "plaintext";
};

function boundedString(value: unknown, maximumLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) return null;
  return number;
}

export function structureStoryFromViewerMessage(body: Record<string, unknown> | null | undefined): StructureStory | null {
  if (!body) return null;
  const documentId = boundedString(body.documentId, MAX_DOCUMENT_ID_LENGTH);
  const fileName = boundedString(body.fileName, MAX_FILE_NAME_LENGTH);
  if (body.type === "mvsStoryChanged") {
    const current = body.current && typeof body.current === "object" ? body.current as Record<string, unknown> : null;
    const stepIndex = boundedInteger(body.stepIndex, 0, MAX_STEP_COUNT - 1);
    const stepCount = boundedInteger(body.stepCount, 1, MAX_STEP_COUNT);
    const stage = boundedString(current?.title, MAX_STAGE_LENGTH);
    const summary = boundedString(current?.description, MAX_SUMMARY_LENGTH) || "No description for this Story step.";
    if (!documentId || !fileName || !stage || stepIndex === null || stepCount === null || stepIndex >= stepCount) return null;
    return {
      documentId,
      stepIndex,
      stepCount,
      fileName,
      stage,
      summary,
      comparison: null,
      source: "mvs",
      key: boundedString(current?.key, 256) || null,
      isPlaying: body.isPlaying === true,
      descriptionFormat: current?.descriptionFormat === "plaintext" ? "plaintext" : "markdown",
    };
  }
  const stage = boundedString(body.stage, MAX_STAGE_LENGTH);
  const summary = boundedString(body.summary, MAX_SUMMARY_LENGTH);
  const stepIndex = boundedInteger(body.stepIndex, 0, MAX_STEP_COUNT - 1);
  const stepCount = boundedInteger(body.stepCount, 1, MAX_STEP_COUNT);
  if (!documentId || !fileName || !stage || !summary || stepIndex === null || stepCount === null || stepIndex >= stepCount) {
    return null;
  }

  const rawComparison = body.comparison && typeof body.comparison === "object"
    ? body.comparison as Record<string, unknown>
    : null;
  const rmsd = Number(rawComparison?.rmsd);
  const chain = boundedString(rawComparison?.chain, MAX_CHAIN_LENGTH);
  const residueCount = boundedInteger(rawComparison?.residueCount, 1, MAX_RESIDUE_COUNT);
  const comparison = rawComparison && Number.isFinite(rmsd) && rmsd >= 0 && chain && residueCount !== null
    ? { rmsd, chain, residueCount }
    : null;

  return { documentId, stepIndex, stepCount, fileName, stage, summary, comparison };
}
