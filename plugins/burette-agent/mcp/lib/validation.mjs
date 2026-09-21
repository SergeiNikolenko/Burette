const MAX_DATASETS = 50;
const MAX_ROWS_PER_DATASET = 2000;
const MAX_INLINE_BYTES = 3 * 1024 * 1024;
const MAX_BLOCKS = 100;
const VALID_STATUSES = new Set(["ready", "partial", "blocked", "fixture"]);
const VALID_SURFACES = new Set([
  "molecular-workspace",
  "molecule-table",
  "trajectory-review",
  "molecular-report",
]);

export function validateMolecularArtifact({ manifest, snapshot, surface = "molecular-report" }) {
  const errors = [];
  const warnings = [];

  if (!VALID_SURFACES.has(surface)) {
    errors.push(`Unsupported surface: ${surface}.`);
  }
  if (!isPlainObject(manifest)) {
    errors.push("manifest must be an object.");
  }
  if (!isPlainObject(snapshot)) {
    errors.push("snapshot must be an object.");
  }
  if (errors.length) return result(false, errors, warnings);

  const inlineBytes = Buffer.byteLength(JSON.stringify({ manifest, snapshot }), "utf8");
  if (inlineBytes > MAX_INLINE_BYTES) {
    return result(false, [`inline payload is ${inlineBytes} bytes; maximum is ${MAX_INLINE_BYTES}.`], warnings);
  }

  if (manifest.version !== 1) errors.push("manifest.version must be 1.");
  if (!nonEmptyString(manifest.title)) errors.push("manifest.title is required.");
  if (!Array.isArray(manifest.blocks) || manifest.blocks.length === 0) {
    errors.push("manifest.blocks must be a non-empty array.");
  } else if (manifest.blocks.length > MAX_BLOCKS) {
    errors.push(`manifest.blocks exceeds the maximum of ${MAX_BLOCKS}.`);
  } else {
    for (const [index, block] of manifest.blocks.entries()) {
      const label = `manifest.blocks[${index}]`;
      if (!isPlainObject(block) || !["markdown", "table", "chart"].includes(block.type)) {
        errors.push(`${label}.type must be markdown, table, or chart.`);
      } else if (block.type === "markdown") {
        if (!nonEmptyString(block.body)) errors.push(`${label}.body must be non-empty markdown.`);
      } else if (!nonEmptyString(block.dataset)) {
        errors.push(`${label}.dataset is required.`);
      }
      if (isPlainObject(block) && Object.hasOwn(block, "dataset") &&
        (!nonEmptyString(block.dataset) || !isPlainObject(snapshot.datasets) || !Object.hasOwn(snapshot.datasets, block.dataset))) {
        errors.push(`${label}.dataset must reference an existing snapshot dataset.`);
      }
    }
  }
  if (surface === "molecular-report") {
    const firstBlock = Array.isArray(manifest.blocks) ? manifest.blocks[0] : null;
    if (!firstBlock || firstBlock.type !== "markdown" || typeof firstBlock.body !== "string") {
      errors.push("molecular-report artifacts must start with a markdown block.");
    } else {
      const expectedHeading = `# ${manifest.title}`;
      if (firstBlock.body.trimStart().split(/\r?\n/u, 1)[0].trimEnd() !== expectedHeading) {
        errors.push(`first markdown block must start with ${JSON.stringify(expectedHeading)}.`);
      }
    }
  }

  if (snapshot.version !== 1) errors.push("snapshot.version must be 1.");
  if (!VALID_STATUSES.has(snapshot.status)) {
    errors.push("snapshot.status must be ready, partial, blocked, or fixture.");
  }
  if (!isPlainObject(snapshot.datasets)) {
    errors.push("snapshot.datasets must be an object keyed by dataset id.");
  } else {
    const datasetEntries = Object.entries(snapshot.datasets);
    if (datasetEntries.length > MAX_DATASETS) {
      errors.push(`snapshot.datasets has ${datasetEntries.length} datasets; maximum is ${MAX_DATASETS}.`);
    }
    for (const [datasetId, rows] of datasetEntries.slice(0, MAX_DATASETS)) {
      if (isPlainObject(rows) && Array.isArray(rows.rows)) {
        errors.push(`snapshot.datasets.${datasetId} must not use {columns, rows} table shape.`);
        continue;
      }
      if (!Array.isArray(rows)) {
        errors.push(`snapshot.datasets.${datasetId} must be an array of row objects.`);
        continue;
      }
      if (rows.length > MAX_ROWS_PER_DATASET) {
        errors.push(`snapshot.datasets.${datasetId} has ${rows.length} rows; maximum is ${MAX_ROWS_PER_DATASET}.`);
      }
      const badRow = rows.find(row => !isPlainObject(row));
      if (badRow !== undefined) {
        errors.push(`snapshot.datasets.${datasetId} rows must be plain objects.`);
      }
    }
  }

  if (snapshot.status === "ready" && Array.isArray(snapshot.accessIssues) && snapshot.accessIssues.length) {
    errors.push("snapshot.accessIssues is only allowed for partial or blocked snapshots.");
  }
  if ((snapshot.status === "partial" || snapshot.status === "blocked") && !Array.isArray(snapshot.accessIssues)) {
    warnings.push("partial or blocked snapshots should include snapshot.accessIssues.");
  }
  if (Array.isArray(snapshot.artifacts)) {
    for (const artifact of snapshot.artifacts) {
      if (!isPlainObject(artifact)) errors.push("snapshot.artifacts entries must be objects.");
      if (isPlainObject(artifact) && !nonEmptyString(artifact.kind)) {
        errors.push("snapshot.artifacts entries require kind.");
      }
    }
  }

  return result(errors.length === 0, errors, warnings, {
    surface,
    datasetCount: isPlainObject(snapshot.datasets) ? Object.keys(snapshot.datasets).length : 0,
    inlineBytes,
  });
}

function result(ok, errors, warnings, summary = {}) {
  return {
    ok,
    schema: "burette_molecular_artifact_validation.v1",
    errors,
    warnings,
    summary,
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
