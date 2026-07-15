#!/usr/bin/env bun
import assert from "node:assert/strict";
import {
  SOURCE_EDIT_MAX_BYTES,
  SOURCE_LIVE_PREVIEW_MAX_BYTES,
  classifyPreviewMode,
  classifySourceEditEligibility,
  classifySourceShape,
  createSourceEditSession,
  reduceSourceEditSession,
  sourceEditableExtensions,
  sourceDraftValidationError,
  sourceSaveGuard,
  utf8ByteCount,
} from "../apps/desktop/src/lib/source-editing/index.ts";

const revision = (suffix, byteCount = 3) => ({
  modifiedAt: 1_784_123_456_000 + suffix,
  byteCount,
  contentHash: `sha256:${String(suffix).padStart(64, "0")}`,
});

function session(overrides = {}) {
  return {
    ...createSourceEditSession({
      sessionId: "session-1",
      documentId: "document-1",
      sourcePath: "/tmp/source.pdb",
      title: "source.pdb",
      extension: "pdb",
      persistence: { kind: "desktop", handleId: "handle-1" },
      baseContent: "OLD",
      expectedFileRevision: revision(1),
      previewMode: "live",
    }),
    ...overrides,
  };
}

assert.equal(utf8ByteCount("Aé"), 3, "policy counts UTF-8 bytes, not JavaScript code units");
assert.equal(classifyPreviewMode(SOURCE_LIVE_PREVIEW_MAX_BYTES), "live");
assert.equal(classifyPreviewMode(SOURCE_LIVE_PREVIEW_MAX_BYTES + 1), "manual");
assert.equal(classifyPreviewMode(SOURCE_EDIT_MAX_BYTES), "manual");
assert.equal(classifyPreviewMode(SOURCE_EDIT_MAX_BYTES + 1), "read-only");

for (const extension of ["pdb", "ent", "pdbqt", "pqr", "xpdb", "cif", "mmcif", "mcif", "mol", "mol2", "sdf", "sd", "xyz", "gro"]) {
  assert.equal(sourceEditableExtensions.has(extension), true, `${extension} belongs to the first-release edit registry`);
}
assert.equal(sourceEditableExtensions.has("bcif"), false, "binary CIF is not source editable");
assert.deepEqual(classifySourceEditEligibility({ extension: ".PDB", byteCount: 50 }), {
  editable: true,
  previewMode: "live",
});
assert.deepEqual(classifySourceEditEligibility({ extension: "xyz", byteCount: 1_000_001 }), {
  editable: true,
  previewMode: "manual",
});
assert.deepEqual(classifySourceEditEligibility({ extension: "pdb", byteCount: 3_000_001 }), {
  editable: false,
  reason: "too_large",
});
for (const [input, reason] of [
  [{ extension: "pdb", byteCount: 3, truncated: true }, "truncated"],
  [{ extension: "pdb", byteCount: 3, decodeLossy: true }, "lossy_encoding"],
  [{ extension: "bcif", byteCount: 3, binary: true }, "binary_source"],
  [{ extension: "pdb.gz", byteCount: 3, compressed: true }, "compressed_source"],
  [{ extension: "pdb", byteCount: 3, sourceKind: "virtual" }, "virtual_source"],
  [{ extension: "pdb", byteCount: 3, sourceKind: "generated" }, "generated_source"],
  [{ extension: "pdb", byteCount: 3, sourceKind: "combined" }, "combined_source"],
  [{ extension: "pdb", byteCount: 3, sourceKind: "docking" }, "docking_source"],
  [{ extension: "pdb", byteCount: 3, shape: "multi-source" }, "multi_source"],
  [{ extension: "xyz", byteCount: 3, shape: "multi-frame" }, "unsupported_shape"],
  [{ extension: "mae", byteCount: 3 }, "unsupported_format"],
]) {
  assert.deepEqual(classifySourceEditEligibility(input), { editable: false, reason });
}

assert.equal(classifySourceShape("sdf", "one\n$$$$\n"), "single");
assert.equal(classifySourceShape("sdf", "one\n$$$$\ntwo\n$$$$\n"), "collection");
assert.equal(classifySourceShape("xyz", "1\none\nH 0 0 0\n"), "single");
assert.equal(classifySourceShape("xyz", "1\none\nH 0 0 0\n1\ntwo\nH 1 0 0\n"), "multi-frame");
assert.equal(classifySourceShape("pdb", "MODEL 1\nENDMDL\nMODEL 2\nENDMDL\n"), "multi-frame");
assert.equal(classifySourceShape("cif", "data_one\n#\ndata_two\n#\n"), "collection");
assert.equal(sourceDraftValidationError("pdb", "NOT A STRUCTURE\n"), "The PDB draft contains no ATOM or HETATM records.");
assert.equal(sourceDraftValidationError("pdb", "ATOM      1  N   GLY A   1       0.0 0.0 0.0\n"), null);
assert.equal(sourceDraftValidationError("xyz", "2\nwater\nH 0 0 0\n"), "The XYZ draft has an invalid atom count or incomplete atom block.");

const readOnly = createSourceEditSession({
  sessionId: "session-read-only",
  documentId: "document-1",
  sourcePath: "/tmp/source.pdb",
  title: "source.pdb",
  extension: "pdb",
  persistence: { kind: "desktop", handleId: "handle-1" },
  baseContent: "OLD",
  expectedFileRevision: revision(1),
  previewMode: "live",
}, false);
assert.equal(readOnly.diskState, "read-only");
assert.equal(reduceSourceEditSession(readOnly, { type: "enter-edit-mode" }).diskState, "clean");

let edited = reduceSourceEditSession(session(), { type: "edit", content: "NEW" });
assert.equal(edited.diskState, "dirty");
assert.equal(edited.draftRevision, 1);
assert.equal(edited.previewState, "queued");
edited = reduceSourceEditSession(edited, { type: "edit", content: "OLD" });
assert.equal(edited.diskState, "clean", "undoing to base clears dirty state");
assert.equal(edited.draftRevision, 2, "every editor transaction allocates a revision");

let staging = reduceSourceEditSession(reduceSourceEditSession(session(), { type: "edit", content: "NEW" }), {
  type: "start-preview",
  revision: 1,
});
assert.equal(staging.previewState, "staging");
const stale = reduceSourceEditSession(staging, { type: "preview-ready", revision: 0 });
assert.equal(stale, staging, "stale async preview completion is ignored by identity");
const ready = reduceSourceEditSession(staging, { type: "preview-ready", revision: 1 });
assert.equal(ready.previewState, "current");
assert.equal(ready.lastValidRevision, 1);
assert.deepEqual(sourceSaveGuard(ready), { kind: "direct" });

const diagnostic = {
  code: "preview_invalid",
  message: "Invalid atom record",
  revision: 1,
  line: 4,
  column: null,
};
const failed = reduceSourceEditSession(staging, { type: "preview-failed", revision: 1, diagnostic });
assert.equal(failed.previewState, "paused");
assert.equal(failed.lastValidRevision, 0, "failure retains the last good revision");
assert.deepEqual(sourceSaveGuard(failed), {
  kind: "confirm",
  reason: "preview-paused",
  actions: ["save-anyway", "cancel"],
});

const shapeUnsupported = reduceSourceEditSession(staging, {
  type: "preview-shape-unsupported",
  revision: 1,
  diagnostic: { ...diagnostic, code: "source_shape_unsupported" },
});
assert.equal(shapeUnsupported.previewState, "unsupported");
assert.equal(shapeUnsupported.previewUnsupportedReason, "shape");
assert.equal(sourceSaveGuard(shapeUnsupported).kind, "confirm");

const manual = reduceSourceEditSession(session(), { type: "edit", content: "x".repeat(1_000_001) });
assert.equal(manual.previewState, "manual");
assert.equal(manual.previewMode, "manual");
assert.deepEqual(sourceSaveGuard(manual), {
  kind: "confirm",
  reason: "manual-preview",
  actions: ["apply-preview", "save-anyway", "cancel"],
});
const oversized = reduceSourceEditSession(session(), { type: "edit", content: "x".repeat(3_000_001) });
assert.equal(oversized.previewState, "unsupported");
assert.equal(oversized.previewUnsupportedReason, "size");
assert.deepEqual(sourceSaveGuard(oversized), { kind: "blocked", reason: "draft_too_large" });

const queuedGuard = sourceSaveGuard(reduceSourceEditSession(session(), { type: "edit", content: "NEW" }));
assert.deepEqual(queuedGuard, {
  kind: "confirm",
  reason: "preview-pending",
  actions: ["wait-for-preview", "save-anyway", "cancel"],
});

let saving = reduceSourceEditSession(ready, { type: "start-save" });
assert.equal(saving.diskState, "saving");
saving = reduceSourceEditSession(saving, { type: "save-succeeded", revision: revision(2) });
assert.equal(saving.diskState, "clean");
assert.equal(saving.baseContent, "NEW");
assert.deepEqual(saving.expectedFileRevision, revision(2));

let conflicted = reduceSourceEditSession(reduceSourceEditSession(session(), { type: "edit", content: "DRAFT" }), {
  type: "save-conflict",
  revision: revision(3),
});
assert.equal(conflicted.diskState, "conflict");
assert.equal(conflicted.draftContent, "DRAFT", "conflict never clears the draft");
assert.deepEqual(conflicted.lastConflictRevision, revision(3));
assert.deepEqual(sourceSaveGuard(conflicted), { kind: "resolve-conflict" });
conflicted = reduceSourceEditSession(conflicted, { type: "keep-editing" });
assert.equal(conflicted.diskState, "dirty");

let uncertain = reduceSourceEditSession(reduceSourceEditSession(ready, { type: "start-save" }), { type: "save-uncertain" });
assert.equal(uncertain.diskState, "reconciling");
assert.deepEqual(sourceSaveGuard(uncertain), { kind: "reconcile" });
uncertain = reduceSourceEditSession(uncertain, { type: "reconcile-committed", revision: revision(4) });
assert.equal(uncertain.diskState, "clean");

const savedAnyway = reduceSourceEditSession(
  reduceSourceEditSession({ ...failed, diskState: "dirty" }, { type: "start-save" }),
  { type: "save-succeeded", revision: revision(5) },
);
assert.equal(savedAnyway.diskState, "clean");
assert.equal(savedAnyway.previewState, "paused", "successful Save Anyway does not falsify preview validity");

const previewOnly = session({ persistence: { kind: "preview-only", reason: "browser_save_unavailable" } });
const previewOnlyDirty = reduceSourceEditSession(previewOnly, { type: "edit", content: "NEW" });
assert.equal(previewOnlyDirty.persistence.kind, "preview-only");
assert.equal("handleId" in previewOnlyDirty.persistence, false);
assert.deepEqual(sourceSaveGuard(previewOnlyDirty), { kind: "blocked", reason: "browser_save_unavailable" });
assert.equal(reduceSourceEditSession(previewOnlyDirty, { type: "start-save" }), previewOnlyDirty);

const closed = reduceSourceEditSession(previewOnlyDirty, { type: "close" });
assert.equal(closed.diskState, "closed");
assert.equal(closed.editMode, false);
assert.equal(reduceSourceEditSession(closed, { type: "edit", content: "LOST" }), closed);

console.log("source editing state tests passed");
