import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = (name) => resolve(root, "schemas/compute", name);
const fixturePath = (name) => schemaPath(`fixtures/${name}`);
const jsonCache = new Map();
const readJson = (path) => {
  if (!jsonCache.has(path)) jsonCache.set(path, JSON.parse(readFileSync(path, "utf8")));
  return jsonCache.get(path);
};
const fixture = (name) => readJson(fixturePath(name));

function sameValue(left, right) {
  return jcs(left) === jcs(right);
}

function schemaTypeMatches(type, value) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function jsonPointer(rootSchema, fragment) {
  if (!fragment || fragment === "#") return rootSchema;
  assert.match(fragment, /^#\//u);
  return fragment.slice(2).split("/").reduce((value, token) => {
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
    assert.ok(Object.hasOwn(value, key), `unresolved schema pointer ${fragment}`);
    return value[key];
  }, rootSchema);
}

function resolveReference(reference, context) {
  if (reference.startsWith("#")) {
    return { schema: jsonPointer(context.rootSchema, reference), context };
  }
  const hashIndex = reference.indexOf("#");
  const fileReference = hashIndex === -1 ? reference : reference.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "#" : reference.slice(hashIndex);
  const targetPath = resolve(dirname(context.schemaPath), fileReference);
  const targetRoot = readJson(targetPath);
  return {
    schema: jsonPointer(targetRoot, fragment),
    context: { rootSchema: targetRoot, schemaPath: targetPath },
  };
}

function validate(schema, value, context, path = "$") {
  if (schema === true) return [];
  if (schema === false) return [`${path} is forbidden`];

  const errors = [];
  if (schema.$ref) {
    const reference = resolveReference(schema.$ref, context);
    errors.push(...validate(reference.schema, value, reference.context, path));
  }

  if (schema.const !== undefined && !sameValue(schema.const, value)) {
    errors.push(`${path} must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((candidate) => sameValue(candidate, value))) {
    errors.push(`${path} is outside the enum`);
  }
  if (schema.not && validate(schema.not, value, context, path).length === 0) {
    errors.push(`${path} must not match the forbidden schema`);
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => schemaTypeMatches(type, value))) {
      errors.push(`${path} must have type ${types.join("|")}`);
      return errors;
    }
  }

  for (const branch of schema.allOf ?? []) errors.push(...validate(branch, value, context, path));
  if (schema.anyOf) {
    const matches = schema.anyOf.filter((branch) => validate(branch, value, context, path).length === 0);
    if (matches.length === 0) errors.push(`${path} must match at least one anyOf branch`);
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((branch) => validate(branch, value, context, path).length === 0);
    if (matches.length !== 1) errors.push(`${path} must match exactly one oneOf branch, matched ${matches.length}`);
  }
  if (schema.if) {
    const conditionMatches = validate(schema.if, value, context, path).length === 0;
    if (conditionMatches && schema.then) errors.push(...validate(schema.then, value, context, path));
    if (!conditionMatches && schema.else) errors.push(...validate(schema.else, value, context, path));
  }

  if (typeof value === "string") {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) errors.push(`${path} is too short`);
    if (schema.maxLength !== undefined && length > schema.maxLength) errors.push(`${path} is too long`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${path} does not match pattern`);
    if (schema.format === "uuid" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)) {
      errors.push(`${path} is not a UUID`);
    }
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} is below minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} exceeds maximum`);
    if (schema.multipleOf !== undefined && value % schema.multipleOf !== 0) {
      errors.push(`${path} must be a multiple of ${schema.multipleOf}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path} has too few items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path} has too many items`);
    if (schema.uniqueItems && new Set(value.map((item) => jcs(item))).size !== value.length) {
      errors.push(`${path} must contain unique items`);
    }
    const prefixItems = schema.prefixItems ?? [];
    prefixItems.forEach((itemSchema, index) => {
      if (index < value.length) errors.push(...validate(itemSchema, value[index], context, `${path}[${index}]`));
    });
    if (schema.items !== undefined) {
      const start = prefixItems.length;
      if (schema.items === false && value.length > start) {
        errors.push(`${path} contains items after its fixed prefix`);
      } else if (schema.items !== false) {
        for (let index = start; index < value.length; index += 1) {
          errors.push(...validate(schema.items, value[index], context, `${path}[${index}]`));
        }
      }
    }
    if (schema.contains) {
      const matches = value.filter((item, index) => validate(schema.contains, item, context, `${path}[${index}]`).length === 0).length;
      const minimum = schema.minContains ?? 1;
      if (matches < minimum) errors.push(`${path} has too few matching contains items`);
      if (schema.maxContains !== undefined && matches > schema.maxContains) errors.push(`${path} has too many matching contains items`);
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) errors.push(`${path} has too few properties`);
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) errors.push(`${path} has too many properties`);
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) errors.push(`${path}.${required} is required`);
    }
    for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) errors.push(...validate(propertySchema, value[key], context, `${path}.${key}`));
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const key of keys) {
        if (!allowed.has(key)) errors.push(`${path}.${key} is not allowed`);
      }
    }
  }

  return errors;
}

function validateWith(schemaFile, value, fragment = "#") {
  const path = schemaPath(schemaFile);
  const rootSchema = readJson(path);
  return validate(jsonPointer(rootSchema, fragment), value, { rootSchema, schemaPath: path });
}

const supportedSchemaKeywords = new Set([
  "$schema", "$id", "$comment", "$defs", "$ref",
  "title", "description",
  "type", "const", "enum", "format", "pattern",
  "minimum", "maximum", "multipleOf",
  "minLength", "maxLength",
  "minItems", "maxItems", "uniqueItems", "prefixItems", "items",
  "contains", "minContains", "maxContains",
  "minProperties", "maxProperties", "required", "properties", "additionalProperties",
  "allOf", "anyOf", "oneOf", "not", "if", "then", "else",
]);

function assertValidatorCoverage(schema, path = "$") {
  if (typeof schema === "boolean") return;
  assert.ok(schema !== null && typeof schema === "object" && !Array.isArray(schema), `${path} must be a schema object or boolean`);
  for (const [keyword, value] of Object.entries(schema)) {
    assert.ok(supportedSchemaKeywords.has(keyword), `${path} uses unsupported schema keyword ${keyword}`);
    if (keyword === "$defs" || keyword === "properties") {
      for (const [name, child] of Object.entries(value)) assertValidatorCoverage(child, `${path}.${keyword}.${name}`);
    } else if (["allOf", "anyOf", "oneOf", "prefixItems"].includes(keyword)) {
      for (const [index, child] of value.entries()) assertValidatorCoverage(child, `${path}.${keyword}[${index}]`);
    } else if (["items", "contains", "not", "if", "then", "else", "additionalProperties"].includes(keyword)
      && (typeof value === "boolean" || (value !== null && typeof value === "object"))) {
      assertValidatorCoverage(value, `${path}.${keyword}`);
    }
  }
}

const strictKeywordTypes = [
  [["properties", "required", "minProperties", "maxProperties"], ["object"]],
  [["items", "prefixItems", "contains", "minContains", "maxContains", "minItems", "maxItems", "uniqueItems"], ["array"]],
  [["pattern", "minLength", "maxLength", "format"], ["string"]],
  [["minimum", "maximum", "multipleOf"], ["number", "integer"]],
];

function assertStrictTypeCoverage(schema, path = "$") {
  if (typeof schema === "boolean") return;
  const declaredTypes = new Set(Array.isArray(schema.type) ? schema.type : [schema.type]);
  for (const [keywords, acceptedTypes] of strictKeywordTypes) {
    const usedKeywords = keywords.filter((keyword) => Object.hasOwn(schema, keyword));
    if (usedKeywords.length === 0) continue;
    assert.ok(
      acceptedTypes.some((type) => declaredTypes.has(type)),
      `${path} uses ${usedKeywords.join(", ")} without a local ${acceptedTypes.join("|")} type`,
    );
  }
  for (const [keyword, value] of Object.entries(schema)) {
    if (keyword === "$defs" || keyword === "properties") {
      for (const [name, child] of Object.entries(value)) assertStrictTypeCoverage(child, `${path}.${keyword}.${name}`);
    } else if (["allOf", "anyOf", "oneOf", "prefixItems"].includes(keyword)) {
      for (const [index, child] of value.entries()) assertStrictTypeCoverage(child, `${path}.${keyword}[${index}]`);
    } else if (["items", "contains", "not", "if", "then", "else", "additionalProperties"].includes(keyword)
      && (typeof value === "boolean" || (value !== null && typeof value === "object"))) {
      assertStrictTypeCoverage(value, `${path}.${keyword}`);
    }
  }
}

function expectValid(schemaFile, value, label, fragment = "#") {
  assert.deepEqual(validateWith(schemaFile, value, fragment), [], `${label} must satisfy ${schemaFile}${fragment}`);
}

function expectInvalid(schemaFile, value, label, fragment = "#") {
  assert.notDeepEqual(validateWith(schemaFile, value, fragment), [], `${label} must be rejected by ${schemaFile}${fragment}`);
}

function jcs(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${jcs(value[key])}`).join(",")}}`;
}

function jcsSha256(value) {
  return createHash("sha256").update(jcs(value)).digest("hex");
}

function hasStrictlyIncreasing(values, key = (value) => value) {
  return values.every((value, index) => index === 0 || key(values[index - 1]) < key(value));
}

function hasUniqueKeys(values, key) {
  return new Set(values.map(key)).size === values.length;
}

function clusterSemanticErrors(value) {
  const errors = [];
  const scope = value.source.scope;
  if (scope.kind === "selected" && !hasStrictlyIncreasing(scope.sourceIndexes)) {
    errors.push("selected source indexes are not strictly increasing");
  }
  if (scope.kind === "filtered") {
    const columns = scope.columnFilters ?? [];
    const descriptors = scope.descriptorFilters ?? [];
    const analyses = scope.analysisFilters ?? [];
    if (columns.length + descriptors.length + analyses.length > 64) errors.push("combined filter count exceeds 64");
    if (!hasUniqueKeys(columns, (filter) => filter.id)) errors.push("duplicate column filter ID");
    if (!hasUniqueKeys(descriptors, (filter) => filter.id)) errors.push("duplicate descriptor filter ID");
    if (!hasUniqueKeys(analyses, (filter) => `${filter.runId}\0${filter.valueId}`)) errors.push("duplicate analysis filter value");
    for (const filter of [...columns, ...descriptors, ...analyses]) {
      if (filter.min !== null && filter.min !== undefined && filter.max !== null && filter.max !== undefined && filter.min > filter.max) {
        errors.push("filter minimum exceeds maximum");
      }
    }
  }
  const cutoff = value.parameters.similarity.cutoff;
  if (cutoff.numerator > cutoff.denominator) errors.push("cutoff numerator exceeds denominator");
  return errors;
}

const packedDTypeWidths = {
  bool8: 1,
  u8: 1,
  i8: 1,
  u16: 2,
  i16: 2,
  u32: 4,
  i32: 4,
  u64: 8,
  i64: 8,
  f32: 4,
  f64: 8,
};

function packedLayoutSemanticErrors(layout) {
  const errors = [];
  if (!hasStrictlyIncreasing(layout.files, (file) => file.relativePath)) errors.push("packed files are not canonically sorted");
  if (!hasUniqueKeys(layout.files, (file) => file.relativePath)) errors.push("duplicate packed file path");
  if (!hasStrictlyIncreasing(layout.arrays, (array) => array.name)) errors.push("packed arrays are not canonically sorted");
  if (!hasUniqueKeys(layout.arrays, (array) => array.name)) errors.push("duplicate packed array name");

  const totalBytes = layout.files.reduce((total, file) => total + BigInt(file.byteLength), 0n);
  if (totalBytes > 1099511627776n) errors.push("packed layout exceeds aggregate byte limit");
  const files = new Map(layout.files.map((file) => [file.relativePath, BigInt(file.byteLength)]));
  const ranges = new Map();
  for (const array of layout.arrays) {
    const width = packedDTypeWidths[array.dtype];
    const alignment = BigInt(array.alignment);
    const offset = BigInt(array.byteOffset);
    const length = BigInt(array.byteLength);
    const expected = array.shape.reduce((count, dimension) => count * BigInt(dimension), 1n) * BigInt(width);
    const expectedOrder = width === 1 ? "notApplicable" : null;
    if ((expectedOrder && array.byteOrder !== expectedOrder) || (!expectedOrder && array.byteOrder === "notApplicable")) {
      errors.push(`array ${array.name} has invalid byte order`);
    }
    if (array.alignment < width || array.alignment % width !== 0 || offset % alignment !== 0n) {
      errors.push(`array ${array.name} has invalid alignment`);
    }
    if (length !== expected) errors.push(`array ${array.name} has inconsistent byte length`);
    const fileLength = files.get(array.fileRelativePath);
    if (fileLength === undefined) {
      errors.push(`array ${array.name} references an unknown file`);
      continue;
    }
    const end = offset + length;
    if (end > fileLength) errors.push(`array ${array.name} exceeds its file`);
    if (length > 0n) {
      const fileRanges = ranges.get(array.fileRelativePath) ?? [];
      fileRanges.push({ start: offset, end, name: array.name });
      ranges.set(array.fileRelativePath, fileRanges);
    }
  }
  for (const fileRanges of ranges.values()) {
    fileRanges.sort((left, right) => left.start < right.start ? -1 : left.start > right.start ? 1 : 0);
    for (let index = 1; index < fileRanges.length; index += 1) {
      if (fileRanges[index].start < fileRanges[index - 1].end) errors.push("packed array ranges overlap");
    }
  }
  return errors;
}

function molecularPackSemanticErrors(value) {
  const errors = packedLayoutSemanticErrors(value.layout);
  const recordCount = value.frozenSource.recordCount;
  const sourceIds = value.layout.arrays.find((array) => array.name === "sourceRecordIds");
  const moleculeHashes = value.layout.arrays.find((array) => array.name === "moleculeContentHashes");
  if (!sourceIds || !sameValue(sourceIds.shape, [recordCount])) errors.push("sourceRecordIds shape differs from recordCount");
  if (!moleculeHashes || !sameValue(moleculeHashes.shape, [recordCount, 32])) errors.push("moleculeContentHashes shape differs from recordCount");
  return errors;
}

function enginePackSemanticErrors(value) {
  const errors = packedLayoutSemanticErrors(value.layout);
  if (value.layout.files.some((file) => file.relativePath === value.molecularSnapshot.manifest.relativePath)) {
    errors.push("engine pack reuses molecular manifest path");
  }
  return errors;
}

function resultPackSemanticErrors(value) {
  const errors = packedLayoutSemanticErrors(value.layout);
  if (!hasUniqueKeys(value.enginePacks, (engine) => engine.enginePackId)) errors.push("duplicate engine pack ID");
  const reservedPaths = new Set([value.molecularSnapshot.manifest.relativePath]);
  for (const engine of value.enginePacks) {
    if (engine.workflowTemplate !== value.workflowTemplate
      || engine.snapshotId !== value.molecularSnapshot.snapshotId
      || engine.snapshotSha256 !== value.molecularSnapshot.snapshotSha256) errors.push("engine pack snapshot binding mismatch");
    if (reservedPaths.has(engine.manifest.relativePath)) errors.push("duplicate referenced manifest path");
    reservedPaths.add(engine.manifest.relativePath);
  }
  if (value.layout.files.some((file) => reservedPaths.has(file.relativePath))) errors.push("result layout reuses a referenced manifest path");
  return errors;
}

function capabilitySemanticErrors(value) {
  const errors = [];
  const claim = (entry) => [
    entry.workflowTemplate,
    entry.method,
    entry.chemistryDomain,
    entry.backend,
    entry.precision,
  ].join("\0");
  if (!hasUniqueKeys(value.capabilities, claim)) errors.push("duplicate capability claim");
  if (!hasUniqueKeys(value.reasons, (reason) => reason.code)) errors.push("duplicate capability reason code");
  const reasonCodes = new Set(value.reasons.map((reason) => reason.code));
  if (value.capabilities.some((entry) => entry.reasonCode !== null && entry.reasonCode !== undefined && !reasonCodes.has(entry.reasonCode))) {
    errors.push("capability reasonCode has no matching reason");
  }
  return errors;
}

function jobSnapshotSemanticErrors(value) {
  const errors = [...clusterSemanticErrors(value.request)];
  if (value.normalizedRequestSha256 !== jcsSha256(value.request)) errors.push("request hash mismatch");
  if (value.acceptedPlanSha256 !== jcsSha256(value.plan)) errors.push("plan hash mismatch");
  if (value.updatedAtMs < value.createdAtMs) errors.push("job update precedes creation");
  if (value.progress.completedUnits > value.progress.totalUnits) errors.push("job progress exceeds total");
  if (value.workflowTemplate !== value.request.workflowTemplate || value.workflowTemplate !== value.plan.workflowTemplate) {
    errors.push("workflow binding mismatch");
  }
  if (value.request.executionPolicy.backendPolicy !== value.plan.backendPolicy) errors.push("backend policy binding mismatch");
  const stageBindingFields = [
    "stageId",
    "kind",
    "idempotent",
    "requestedBackend",
    "effectiveBackend",
    "precision",
    "engine",
    "fallback",
  ];
  for (const [index, stage] of value.stages.entries()) {
    const planned = value.plan.stages[index];
    if (!planned || stage.ordinal !== index || stageBindingFields.some((field) => !sameValue(stage[field], planned[field]))) {
      errors.push(`stage ${index} differs from its accepted plan`);
    }
    if (stage.progress.completedUnits > stage.progress.totalUnits) errors.push(`stage ${index} progress exceeds total`);
    if (stage.state === "succeeded" && stage.progress.completedUnits !== stage.progress.totalUnits) {
      errors.push(`stage ${index} succeeded with incomplete progress`);
    }
    if (stage.startedAtMs !== null && stage.updatedAtMs !== null && stage.updatedAtMs < stage.startedAtMs) {
      errors.push(`stage ${index} update precedes start`);
    }
    if (stage.finishedAtMs !== null && (stage.startedAtMs === null || stage.updatedAtMs === null || stage.finishedAtMs < stage.startedAtMs || stage.finishedAtMs > stage.updatedAtMs)) {
      errors.push(`stage ${index} finish is outside its execution interval`);
    }
  }
  if (!hasUniqueKeys(value.attempts, (attempt) => attempt.attemptId)) errors.push("duplicate attempt ID");
  const attemptsByStage = new Map();
  for (const attempt of value.attempts) {
    if (attempt.runtimeVersion !== value.pinnedRuntime.version) errors.push("attempt runtime differs from pinned runtime");
    if (attempt.heartbeatAtMs < attempt.startedAtMs) errors.push("attempt heartbeat precedes start");
    if (attempt.finishedAtMs !== null && attempt.finishedAtMs < attempt.heartbeatAtMs) errors.push("attempt finish precedes heartbeat");
    const stageAttempts = attemptsByStage.get(attempt.stageId) ?? [];
    stageAttempts.push(attempt);
    attemptsByStage.set(attempt.stageId, stageAttempts);
  }
  const attemptStateForStage = {
    running: "running",
    succeeded: "succeeded",
    failed: "failed",
    interrupted: "interrupted",
    cancelled: "cancelled",
  };
  for (const stage of value.stages) {
    const stageAttempts = attemptsByStage.get(stage.stageId) ?? [];
    for (const [index, attempt] of stageAttempts.entries()) {
      if (attempt.attemptNumber !== index + 1) errors.push("attempt numbers are not sequential");
      if ((index === 0) !== (attempt.retryReason === null || attempt.retryReason === undefined)) {
        errors.push("attempt retryReason disagrees with its attempt number");
      }
      if (index + 1 < stageAttempts.length
        && !["failed", "interrupted"].includes(attempt.state)) errors.push("non-retryable attempt has a successor");
      if (index + 1 < stageAttempts.length && attempt.error?.retryable !== true) errors.push("retried attempt lacks a retryable error");
    }
    const first = stageAttempts.at(0);
    const latest = stageAttempts.at(-1);
    const retryReset = value.state === "preparing"
      && stage.state === "queued"
      && stage.idempotent
      && latest?.state === "interrupted";
    if (stage.state === "queued" && (stageAttempts.length === 0 || retryReset)) continue;
    if (!latest || latest.state !== attemptStateForStage[stage.state]) errors.push("latest attempt state differs from stage state");
    if (first && stage.startedAtMs !== first.startedAtMs) errors.push("stage start differs from first attempt");
    if (latest && (stage.updatedAtMs === null || latest.heartbeatAtMs > stage.updatedAtMs)) errors.push("stage update precedes latest attempt heartbeat");
    if (latest && ["succeeded", "failed", "interrupted", "cancelled"].includes(stage.state)
      && stage.finishedAtMs !== latest.finishedAtMs) errors.push("stage finish differs from latest attempt");
  }
  if ([...attemptsByStage.keys()].some((stageId) => !value.stages.some((stage) => stage.stageId === stageId))) errors.push("attempt references unknown stage");
  const recordCount = value.frozenSource.frozenSource.recordCount;
  if (value.outcome && value.outcome.successfulRecords + value.outcome.failedRecords !== recordCount) errors.push("outcome count mismatch");
  if (["succeeded", "succeeded_with_failures"].includes(value.state) && value.progress.completedUnits !== value.progress.totalUnits) {
    errors.push("successful job has incomplete progress");
  }
  if (value.resultPack && (
    value.resultPack.jobId !== value.jobId
    || value.resultPack.workflowTemplate !== value.workflowTemplate
    || value.resultPack.snapshotId !== value.frozenSource.snapshotId
    || value.resultPack.snapshotSha256 !== value.frozenSource.snapshotSha256
  )) errors.push("result pack binding mismatch");
  return errors;
}

function artifactSemanticErrors(value, job) {
  const errors = [];
  if (!hasStrictlyIncreasing(value.files, (file) => file.relativePath)) errors.push("artifact files are not canonically sorted");
  if (!hasUniqueKeys(value.files, (file) => file.relativePath)) errors.push("duplicate artifact path");
  if (value.files.reduce((total, file) => total + BigInt(file.byteCount), 0n) > 1099511627776n) errors.push("artifact exceeds aggregate byte limit");
  const descriptor = value.resultPack.manifest;
  if (!value.files.some((file) => file.relativePath === descriptor.relativePath
    && file.sha256 === descriptor.sha256
    && file.byteCount === descriptor.byteLength
    && file.mediaType === descriptor.mediaType)) errors.push("result-pack descriptor is absent");
  if (value.resultPack.jobId !== value.jobId
    || value.resultPack.workflowTemplate !== value.workflowTemplate
    || value.resultPack.snapshotId !== value.molecularSnapshot.snapshotId
    || value.resultPack.snapshotSha256 !== value.molecularSnapshot.snapshotSha256) errors.push("artifact result identity mismatch");
  if (job && (value.jobId !== job.jobId
    || !sameValue(value.molecularSnapshot, job.frozenSource)
    || value.normalizedRequestSha256 !== job.normalizedRequestSha256
    || value.acceptedPlanSha256 !== job.acceptedPlanSha256
    || !sameValue(value.runtime, job.pinnedRuntime)
    || !sameValue(value.resultPack, job.resultPack)
    || !job.artifactIds.includes(value.artifactId)
    || value.createdAtMs !== job.stages.at(-1).finishedAtMs)) errors.push("artifact-to-job binding mismatch");
  return errors;
}

function expectSemanticValid(errors, label) {
  assert.deepEqual(errors, [], `${label} must satisfy Rust-only semantic boundaries`);
}

function expectSemanticInvalid(errors, label) {
  assert.ok(errors.length > 0, `${label} must be rejected by Rust-only semantic boundaries`);
}

const publicSchemaFiles = [
  "workflow-templates/cluster.v1.schema.json",
  "protocol/compute-capability-report.v1.schema.json",
  "protocol/control-envelope.v1.schema.json",
  "protocol/molecular-snapshot.v1.schema.json",
  "protocol/engine-pack.v1.schema.json",
  "protocol/result-pack.v1.schema.json",
  "protocol/job-snapshot.v1.schema.json",
  "protocol/artifact-manifest.v1.schema.json",
];

for (const file of ["protocol/common.v1.schema.json", ...publicSchemaFiles]) {
  const schema = readJson(schemaPath(file));
  assertValidatorCoverage(schema, file);
  assertStrictTypeCoverage(schema, file);
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema", `${file} must use JSON Schema 2020-12`);
  assert.match(schema.$id, /^https:\/\/burrete\.app\/schemas\/compute\//u, `${file} must have a stable schema ID`);
}
for (const file of publicSchemaFiles) {
  assert.equal(readJson(schemaPath(file)).additionalProperties, false, `${file} must reject unknown top-level fields`);
}

const request = fixture("valid-cluster-request.json");
const filteredRequest = fixture("valid-filtered-cluster-request.json");
const plan = fixture("valid-execution-plan.json");
expectValid("workflow-templates/cluster.v1.schema.json", request, "canonical cluster request");
expectValid("workflow-templates/cluster.v1.schema.json", filteredRequest, "canonical filtered cluster request");
expectValid("workflow-templates/cluster.v1.schema.json", plan, "canonical execution plan", "#/$defs/executionPlan");
expectSemanticValid(clusterSemanticErrors(request), "canonical cluster request");
expectSemanticValid(clusterSemanticErrors(filteredRequest), "canonical filtered cluster request");
assert.equal(jcsSha256(request), "e9ac23cb9b124ece406aee5619cf49112de538f4fdf6d2f2217387df1ab202af");
assert.equal(jcsSha256(filteredRequest), "abc35f1fd431bf053362f15ed63e7125e8f573f2762f92e40454afaf02341c9b");
assert.equal(jcsSha256(plan), "746fb1f42a9be112bf9d4efc02d50370e64acc8db6790ea70d5d42e178238f58");

const capability = fixture("valid-compute-capability-report.json");
expectValid("protocol/compute-capability-report.v1.schema.json", capability, "full capability report");
expectSemanticValid(capabilitySemanticErrors(capability), "full capability report");

const clientRequest = fixture("valid-client-handshake-request.json");
const clientResponse = fixture("valid-client-handshake-response.json");
const workerRequest = fixture("valid-worker-handshake-request.json");
const workerResponse = fixture("valid-worker-handshake-response.json");
for (const [value, label, fragment] of [
  [clientRequest, "client handshake request", "#/$defs/clientRequest"],
  [clientResponse, "client handshake response", "#/$defs/clientResponse"],
  [workerRequest, "worker handshake request", "#/$defs/workerControlRequest"],
  [workerResponse, "worker handshake response", "#/$defs/workerControlResponse"],
]) {
  expectValid("protocol/control-envelope.v1.schema.json", value, label);
  expectValid("protocol/control-envelope.v1.schema.json", value, label, fragment);
}
assert.equal(clientResponse.requestId, clientRequest.requestId);
assert.equal(clientResponse.result.clientNonce, clientRequest.command.clientNonce);
assert.equal(workerResponse.requestId, workerRequest.requestId);
assert.equal(workerResponse.result.coordinatorNonce, workerRequest.command.coordinatorNonce);

const boxedCapabilityResponse = {
  protocolVersion: 1,
  requestId: "018f48f2-2e20-7e53-976b-cf93e0897734",
  result: { kind: "capabilities", report: capability },
};
expectValid("protocol/control-envelope.v1.schema.json", boxedCapabilityResponse, "boxed capability JSON", "#/$defs/clientResponse");

const molecularPack = fixture("valid-molecular-snapshot-pack.json");
const enginePack = fixture("valid-engine-pack.json");
const resultPack = fixture("valid-result-pack.json");
expectValid("protocol/molecular-snapshot.v1.schema.json", molecularPack, "molecular snapshot pack");
expectValid("protocol/engine-pack.v1.schema.json", enginePack, "engine pack");
expectValid("protocol/result-pack.v1.schema.json", resultPack, "result pack");
expectSemanticValid(molecularPackSemanticErrors(molecularPack), "molecular snapshot pack");
expectSemanticValid(enginePackSemanticErrors(enginePack), "engine pack");
expectSemanticValid(resultPackSemanticErrors(resultPack), "result pack");

const queued = fixture("valid-queued-job-snapshot.json");
const succeeded = fixture("valid-succeeded-job-snapshot.json");
expectValid("protocol/job-snapshot.v1.schema.json", queued, "queued job snapshot");
expectValid("protocol/job-snapshot.v1.schema.json", succeeded, "succeeded job snapshot");
for (const snapshot of [queued, succeeded]) {
  assert.equal(snapshot.normalizedRequestSha256, jcsSha256(snapshot.request));
  assert.equal(snapshot.acceptedPlanSha256, jcsSha256(snapshot.plan));
  expectSemanticValid(jobSnapshotSemanticErrors(snapshot), `${snapshot.state} job snapshot`);
}

const retryReset = structuredClone(queued);
retryReset.revision = 2;
retryReset.state = "preparing";
retryReset.updatedAtMs = 120;
retryReset.attempts = [{
  attemptId: "018f48f2-2e20-7e53-976b-cf93e0897721",
  stageId: "freezeScope",
  attemptNumber: 1,
  runtimeVersion: retryReset.pinnedRuntime.version,
  state: "interrupted",
  startedAtMs: 101,
  heartbeatAtMs: 110,
  finishedAtMs: 110,
  error: {
    code: "WorkerCrashed",
    message: "Worker interrupted before retry reset.",
    stageId: "freezeScope",
    moleculeStableId: null,
    retryable: true,
  },
  retryReason: null,
}];
expectValid("protocol/job-snapshot.v1.schema.json", retryReset, "retry-reset job snapshot");
expectSemanticValid(jobSnapshotSemanticErrors(retryReset), "retry-reset job snapshot");

const artifact = fixture("valid-artifact-manifest.json");
expectValid("protocol/artifact-manifest.v1.schema.json", artifact, "artifact manifest");
expectSemanticValid(artifactSemanticErrors(artifact, succeeded), "artifact manifest");
assert.deepEqual(artifact.runtime, succeeded.pinnedRuntime);
assert.deepEqual(artifact.resultPack, succeeded.resultPack);
assert.deepEqual(artifact.molecularSnapshot, succeeded.frozenSource);
assert.equal(artifact.normalizedRequestSha256, succeeded.normalizedRequestSha256);
assert.equal(artifact.acceptedPlanSha256, succeeded.acceptedPlanSha256);
assert.equal(artifact.createdAtMs, succeeded.stages.at(-1).finishedAtMs);
assert.ok(artifact.files.some((file) =>
  file.relativePath === artifact.resultPack.manifest.relativePath
  && file.sha256 === artifact.resultPack.manifest.sha256
  && file.byteCount === artifact.resultPack.manifest.byteLength
  && file.mediaType === artifact.resultPack.manifest.mediaType));

for (const [name, label] of [
  ["invalid-nested-unknown.json", "nested unknown request field"],
  ["invalid-analysis-nil-run-id.json", "nil analysis run ID"],
  ["invalid-cluster-arbitrary-stages.json", "client-supplied arbitrary stages"],
  ["invalid-cluster-oversized.json", "oversized request text"],
  ["invalid-unsafe-integer.json", "unsafe source index"],
]) {
  expectInvalid("workflow-templates/cluster.v1.schema.json", fixture(name), label);
}
expectInvalid("protocol/compute-capability-report.v1.schema.json", fixture("invalid-capability-version.json"), "wrong capability version");
expectInvalid("protocol/control-envelope.v1.schema.json", fixture("invalid-wrong-protocol.json"), "wrong protocol version");
expectInvalid("protocol/control-envelope.v1.schema.json", fixture("invalid-wrong-token-kind.json"), "wrong authority token kinds");

const arbitraryPlan = structuredClone(plan);
arbitraryPlan.stages[2].stageId = "arbitraryGpuProgram";
expectInvalid("workflow-templates/cluster.v1.schema.json", arbitraryPlan, "arbitrary execution-plan stage", "#/$defs/executionPlan");

const uppercaseArtifactHash = structuredClone(artifact);
uppercaseArtifactHash.files[0].sha256 = "A".repeat(64);
expectInvalid("protocol/artifact-manifest.v1.schema.json", uppercaseArtifactHash, "uppercase SHA-256");

const escapedArtifact = structuredClone(artifact);
escapedArtifact.files[0].relativePath = "result/../secret.json";
expectInvalid("protocol/artifact-manifest.v1.schema.json", escapedArtifact, "non-canonical artifact path");

const unknownPackedField = structuredClone(molecularPack);
unknownPackedField.layout.files[0].absolutePath = "/tmp/data.bin";
expectInvalid("protocol/molecular-snapshot.v1.schema.json", unknownPackedField, "nested packed-file authority field");

const unsafeSnapshot = structuredClone(queued);
unsafeSnapshot.updatedAtMs = 9007199254740992;
expectInvalid("protocol/job-snapshot.v1.schema.json", unsafeSnapshot, "unsafe snapshot timestamp");

const trailingSlashPack = structuredClone(molecularPack);
trailingSlashPack.layout.files[0].relativePath = "pack/";
expectInvalid("protocol/molecular-snapshot.v1.schema.json", trailingSlashPack, "packed path with trailing slash");

const wrongByteOrderPack = structuredClone(molecularPack);
wrongByteOrderPack.layout.arrays[1].byteOrder = "notApplicable";
expectInvalid("protocol/molecular-snapshot.v1.schema.json", wrongByteOrderPack, "multi-byte array without byte order");

const misalignedPack = structuredClone(molecularPack);
misalignedPack.layout.arrays[1].byteOffset = 1;
expectInvalid("protocol/molecular-snapshot.v1.schema.json", misalignedPack, "misaligned packed-array offset");

const incompleteSucceeded = structuredClone(succeeded);
incompleteSucceeded.stages[0].hostTimeMs = null;
expectInvalid("protocol/job-snapshot.v1.schema.json", incompleteSucceeded, "successful stage without host timing");

const duplicateArtifactFile = structuredClone(artifact);
duplicateArtifactFile.files.push(structuredClone(duplicateArtifactFile.files[0]));
expectInvalid("protocol/artifact-manifest.v1.schema.json", duplicateArtifactFile, "duplicate artifact file object");

const duplicateCapability = structuredClone(capability);
duplicateCapability.capabilities.push(structuredClone(duplicateCapability.capabilities[0]));
expectInvalid("protocol/compute-capability-report.v1.schema.json", duplicateCapability, "duplicate capability object");

const missingCapabilityReason = structuredClone(capability);
missingCapabilityReason.availability = "degraded";
missingCapabilityReason.capabilities[1].available = false;
missingCapabilityReason.capabilities[1].reasonCode = "RuntimeMissing";
missingCapabilityReason.reasons = [{ code: "MetalUnavailable", message: "Metal is unavailable." }];
expectInvalid("protocol/compute-capability-report.v1.schema.json", missingCapabilityReason, "unresolved capability reasonCode");

// These mutations are intentionally valid structural JSON. They document the
// invariants that standard JSON Schema cannot express and that Rust validate()
// must reject before a request or persisted record becomes authoritative.
const unsortedSelection = structuredClone(request);
unsortedSelection.source.scope.sourceIndexes = [7, 2];
expectValid("workflow-templates/cluster.v1.schema.json", unsortedSelection, "structurally valid unsorted selection");
expectSemanticInvalid(clusterSemanticErrors(unsortedSelection), "unsorted selected indexes");

const tooManyCombinedFilters = structuredClone(request);
tooManyCombinedFilters.source.scope = {
  kind: "filtered",
  query: { kind: "text", text: "" },
  columnFilters: Array.from({ length: 33 }, (_, index) => ({
    id: `column-${index}`,
    filterType: "number",
    text: null,
    min: 0,
    max: null,
  })),
  descriptorFilters: Array.from({ length: 32 }, (_, index) => ({
    id: `descriptor-${index}`,
    min: 0,
    max: null,
  })),
  analysisFilters: [],
};
expectValid("workflow-templates/cluster.v1.schema.json", tooManyCombinedFilters, "structurally valid aggregate filter overflow");
expectSemanticInvalid(clusterSemanticErrors(tooManyCombinedFilters), "aggregate filter overflow");

const invertedCutoff = structuredClone(request);
invertedCutoff.parameters.similarity.cutoff = { numerator: 2, denominator: 1 };
expectValid("workflow-templates/cluster.v1.schema.json", invertedCutoff, "structurally valid inverted cutoff");
expectSemanticInvalid(clusterSemanticErrors(invertedCutoff), "inverted rational cutoff");

const inconsistentPackedLength = structuredClone(molecularPack);
inconsistentPackedLength.layout.arrays[0].byteLength = 63;
expectValid("protocol/molecular-snapshot.v1.schema.json", inconsistentPackedLength, "structurally valid inconsistent packed length");
expectSemanticInvalid(packedLayoutSemanticErrors(inconsistentPackedLength.layout), "inconsistent packed-array byte length");

const unknownPackedFile = structuredClone(molecularPack);
unknownPackedFile.layout.arrays[0].fileRelativePath = "pack/missing.bin";
expectValid("protocol/molecular-snapshot.v1.schema.json", unknownPackedFile, "structurally valid unknown packed file reference");
expectSemanticInvalid(packedLayoutSemanticErrors(unknownPackedFile.layout), "unknown packed file reference");

const overlappingPackedArrays = structuredClone(molecularPack);
overlappingPackedArrays.layout.arrays[0].byteOffset = 0;
expectValid("protocol/molecular-snapshot.v1.schema.json", overlappingPackedArrays, "structurally valid overlapping arrays");
expectSemanticInvalid(packedLayoutSemanticErrors(overlappingPackedArrays.layout), "overlapping packed arrays");

const mismatchedMolecularRecordCount = structuredClone(molecularPack);
mismatchedMolecularRecordCount.frozenSource.recordCount = 3;
expectValid("protocol/molecular-snapshot.v1.schema.json", mismatchedMolecularRecordCount, "structurally valid molecular record-count mismatch");
expectSemanticInvalid(molecularPackSemanticErrors(mismatchedMolecularRecordCount), "molecular identity-array shape mismatch");

const reusedEngineManifestPath = structuredClone(enginePack);
const molecularManifestPath = reusedEngineManifestPath.molecularSnapshot.manifest.relativePath;
reusedEngineManifestPath.layout.files[0].relativePath = molecularManifestPath;
for (const array of reusedEngineManifestPath.layout.arrays) array.fileRelativePath = molecularManifestPath;
expectValid("protocol/engine-pack.v1.schema.json", reusedEngineManifestPath, "structurally valid reused engine manifest path");
expectSemanticInvalid(enginePackSemanticErrors(reusedEngineManifestPath), "engine pack reusing molecular manifest path");

const duplicateEnginePackId = structuredClone(resultPack);
const repeatedEnginePack = structuredClone(duplicateEnginePackId.enginePacks[0]);
repeatedEnginePack.engineVersion = "different-engine-version";
duplicateEnginePackId.enginePacks.push(repeatedEnginePack);
expectValid("protocol/result-pack.v1.schema.json", duplicateEnginePackId, "structurally valid duplicate engine pack ID");
expectSemanticInvalid(resultPackSemanticErrors(duplicateEnginePackId), "duplicate result engine pack ID");

const mismatchedEngineSnapshot = structuredClone(resultPack);
mismatchedEngineSnapshot.enginePacks[0].snapshotSha256 = "a".repeat(64);
expectValid("protocol/result-pack.v1.schema.json", mismatchedEngineSnapshot, "structurally valid engine snapshot mismatch");
expectSemanticInvalid(resultPackSemanticErrors(mismatchedEngineSnapshot), "result engine snapshot mismatch");

const duplicateCapabilityClaim = structuredClone(capability);
const repeatedClaim = structuredClone(duplicateCapabilityClaim.capabilities[0]);
repeatedClaim.maturity = "production";
duplicateCapabilityClaim.capabilities.push(repeatedClaim);
expectValid("protocol/compute-capability-report.v1.schema.json", duplicateCapabilityClaim, "structurally valid duplicate capability claim");
expectSemanticInvalid(capabilitySemanticErrors(duplicateCapabilityClaim), "duplicate capability claim");

const mismatchedRequestHash = structuredClone(succeeded);
mismatchedRequestHash.normalizedRequestSha256 = "a".repeat(64);
expectValid("protocol/job-snapshot.v1.schema.json", mismatchedRequestHash, "structurally valid mismatched request hash");
expectSemanticInvalid(jobSnapshotSemanticErrors(mismatchedRequestHash), "mismatched canonical request hash");

const mismatchedStagePlan = structuredClone(succeeded);
mismatchedStagePlan.stages[0].engine.version = "different-runtime";
expectValid("protocol/job-snapshot.v1.schema.json", mismatchedStagePlan, "structurally valid mismatched stage plan");
expectSemanticInvalid(jobSnapshotSemanticErrors(mismatchedStagePlan), "mismatched stage-plan binding");

const incompleteSucceededProgress = structuredClone(succeeded);
incompleteSucceededProgress.stages[0].progress.completedUnits = 0;
expectValid("protocol/job-snapshot.v1.schema.json", incompleteSucceededProgress, "structurally valid incomplete successful stage progress");
expectSemanticInvalid(jobSnapshotSemanticErrors(incompleteSucceededProgress), "incomplete successful stage progress");

const retryReasonOnFirstAttempt = structuredClone(succeeded);
retryReasonOnFirstAttempt.attempts[0].retryReason = "unexpected retry reason";
expectValid("protocol/job-snapshot.v1.schema.json", retryReasonOnFirstAttempt, "structurally valid first-attempt retry reason");
expectSemanticInvalid(jobSnapshotSemanticErrors(retryReasonOnFirstAttempt), "retry reason on first attempt");

const failedAttemptAfterSuccess = structuredClone(succeeded);
failedAttemptAfterSuccess.attempts.push({
  attemptId: "018f48f2-2e20-7e53-976b-cf93e0897720",
  stageId: "freezeScope",
  attemptNumber: 2,
  runtimeVersion: succeeded.pinnedRuntime.version,
  state: "failed",
  startedAtMs: 104,
  heartbeatAtMs: 105,
  finishedAtMs: 105,
  error: {
    code: "WorkerCrashed",
    message: "Worker failed after a durable success.",
    stageId: "freezeScope",
    moleculeStableId: null,
    retryable: true,
  },
  retryReason: "retry after success",
});
expectValid("protocol/job-snapshot.v1.schema.json", failedAttemptAfterSuccess, "structurally valid failed attempt after success");
expectSemanticInvalid(jobSnapshotSemanticErrors(failedAttemptAfterSuccess), "failed attempt after successful stage");

const duplicateArtifactPath = structuredClone(artifact);
const secondArtifactFile = structuredClone(duplicateArtifactPath.files[0]);
secondArtifactFile.role = "duplicateManifest";
duplicateArtifactPath.files.push(secondArtifactFile);
expectValid("protocol/artifact-manifest.v1.schema.json", duplicateArtifactPath, "structurally valid duplicate artifact path");
expectSemanticInvalid(artifactSemanticErrors(duplicateArtifactPath), "duplicate artifact path");

const missingResultDescriptor = structuredClone(artifact);
missingResultDescriptor.files[0].sha256 = "a".repeat(64);
expectValid("protocol/artifact-manifest.v1.schema.json", missingResultDescriptor, "structurally valid missing result descriptor");
expectSemanticInvalid(artifactSemanticErrors(missingResultDescriptor), "missing exact result-pack descriptor");

const aggregateArtifactOverflow = structuredClone(artifact);
aggregateArtifactOverflow.files.push({
  role: "payload",
  relativePath: "zz/payload.bin",
  sha256: "a".repeat(64),
  byteCount: 1099511627776,
  mediaType: "application/octet-stream",
});
expectValid("protocol/artifact-manifest.v1.schema.json", aggregateArtifactOverflow, "structurally valid artifact aggregate overflow");
expectSemanticInvalid(artifactSemanticErrors(aggregateArtifactOverflow), "artifact aggregate byte overflow");

console.log("compute schema contract tests passed");
