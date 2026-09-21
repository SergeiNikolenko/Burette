import mvsDataModule from 'molstar/lib/commonjs/extensions/mvs/mvs-data.js';
import animationTreeModule from 'molstar/lib/commonjs/extensions/mvs/tree/animation/animation-tree.js';
import treeValidationModule from 'molstar/lib/commonjs/extensions/mvs/tree/generic/tree-validation.js';
import mvsTreeModule from 'molstar/lib/commonjs/extensions/mvs/tree/mvs/mvs-tree.js';

const { MVSData } = mvsDataModule;
const { MVSAnimationSchema } = animationTreeModule;
const { treeSchemaToMarkdown } = treeValidationModule;
const { MVSTreeSchema } = mvsTreeModule;

const schemaByKind = {
  animation: MVSAnimationSchema,
  scene: MVSTreeSchema,
};

const officialDocs = {
  introduction: 'https://molstar.org/mol-view-spec-docs/',
  treeSchema: 'https://molstar.org/mol-view-spec-docs/tree-schema/',
  selectors: 'https://molstar.org/mol-view-spec-docs/selectors/',
  annotations: 'https://molstar.org/mol-view-spec-docs/annotations/',
  cameraSettings: 'https://molstar.org/mol-view-spec-docs/camera-settings/',
  primitives: 'https://molstar.org/mol-view-spec-docs/primitives/',
  volumetricData: 'https://molstar.org/mol-view-spec-docs/volumetric-data/',
  animations: 'https://molstar.org/mol-view-spec-docs/animations/',
  demos: 'https://molstar.org/mol-view-spec-docs/mvs-extension/',
  jsonSchema: 'https://molstar.org/mol-view-spec-docs/tree-schema/openapi.json',
};

export function validateOfficialMvs(story) {
  const issues = MVSData.validationIssues(story, { noExtra: false });
  return Array.isArray(issues) ? issues : [];
}

export function getOfficialMvsAuthoringReference({ schema = 'scene', nodeKind } = {}) {
  const treeSchema = schemaByKind[schema];
  if (!treeSchema) {
    throw referenceError('MVS_SCHEMA_KIND_INVALID', `Unsupported MolViewSpec schema kind: ${schema}.`, {
      availableSchemas: Object.keys(schemaByKind),
    });
  }

  const nodeKinds = Object.keys(treeSchema.nodes);
  const base = {
    schema: 'burette_mvs_authoring_reference.v1',
    schemaKind: schema,
    specVersion: String(MVSData.SupportedVersion),
    rootKind: treeSchema.rootKind,
    nodeKinds,
    officialDocs,
    guidance: nodeKind
      ? 'Use this version-matched node contract when authoring and validate the complete MVSJ or MVSX before opening it.'
      : 'Request one nodeKind at a time for exact parents, parameters, types, defaults, and descriptions from the installed Mol* runtime.',
  };

  if (!nodeKind) return base;
  if (!treeSchema.nodes[nodeKind]) {
    throw referenceError('MVS_NODE_NOT_FOUND', `MolViewSpec node is not present in the ${schema} schema: ${nodeKind}.`, {
      schema,
      availableNodeKinds: nodeKinds,
    });
  }

  return {
    ...base,
    nodeKind,
    markdown: extractNodeMarkdown(treeSchemaToMarkdown(treeSchema), nodeKind),
  };
}

function extractNodeMarkdown(markdown, nodeKind) {
  const lines = markdown.split('\n');
  const marker = `## \`${nodeKind}\``;
  const start = lines.indexOf(marker);
  if (start < 0) {
    throw referenceError('MVS_REFERENCE_GENERATION_FAILED', `Could not generate documentation for MolViewSpec node: ${nodeKind}.`);
  }
  const next = lines.findIndex((line, index) => index > start && line.startsWith("## `"));
  return lines.slice(start, next < 0 ? lines.length : next).join('\n').trim();
}

function referenceError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}
