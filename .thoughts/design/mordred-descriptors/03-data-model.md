# Data Model

## Descriptor Run

Descriptor runs should be represented explicitly.

Fields:

- `id`
- `source_kind`: `document`, `grid`, `grid-row`, or `ketcher`
- `source_document_id`
- `source_path`
- `source_hash`
- `descriptor_set`
- `ignore_3d`
- `mordred_version`
- `rdkit_version`
- `status`: `queued`, `running`, `completed`, `failed`, or `cancelled`
- `started_at`
- `finished_at`
- `total_molecules`
- `completed_molecules`
- `failed_molecules`
- `error_message`

## Descriptor Definition

Fields:

- `id`
- `name`
- `group`
- `value_type`: `number`, `text`, `boolean`, or `missing`
- `requires_3d`
- `description`
- `unit`
- `engine`

The first version can ship a curated descriptor catalog for labels and groups.
It does not need to expose every Mordred descriptor in the default UI.

## Descriptor Value

Fields:

- `run_id`
- `source_kind`
- `source_record_id`
- `descriptor_id`
- `value_real`
- `value_text`
- `missing_kind`
- `error_text`

`value_real` should be used for numeric filtering and sorting. Do not store
numeric descriptors only as strings.

## Collection Storage

Collection descriptor values should live with the grid runtime storage, because
the grid runtime already owns collection rows and paged fetch. Descriptor
filtering, descriptor sorting, dynamic columns, and stable descriptor row
identity are new work on top of the existing grid query path.

Recommended tables:

- `descriptor_runs`
- `descriptor_definitions`
- `descriptor_values`

`descriptor_values` should be keyed by run id, molecule row id, and descriptor
id. Common numeric descriptors can be indexed after the initial implementation
if performance requires it.

The first implementation may treat collection descriptor values as runtime-local
and recompute after reopen. Persistent collection descriptors require a stable
record key beyond the current visible row index, for example:

- grid database row id exposed in `GridPageRow`,
- source record fingerprint,
- source file hash,
- record index,
- descriptor engine version.

## Single-Molecule Cache

Single-molecule document and Ketcher results should use an application-level
descriptor cache keyed by:

- source kind,
- source hash,
- descriptor set,
- engine version,
- `ignore_3d`.

This prevents recalculation when the same single molecule is reopened, without
forcing every single-molecule source into the grid database.

## Invalidation

Invalidate descriptor results when:

- a source file changes,
- a grid row is edited,
- records are appended to a collection,
- Ketcher sketch content changes,
- descriptor set changes,
- Mordred or RDKit version changes,
- 2D/3D mode changes.
