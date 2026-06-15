# API Contract

## Tauri Commands

Proposed commands:

- `descriptor_runtime_status`
- `descriptor_runtime_install`
- `descriptor_runtime_cancel_install`
- `descriptor_source_status`
- `descriptor_run`
- `descriptor_run_status`
- `descriptor_cancel_run`
- `descriptor_fetch_result`
- `descriptor_export_csv`

All commands should return structured errors with user-facing messages and
machine-readable codes.

## Source Status

`descriptor_source_status` input:

```ts
type DescriptorSourceStatusRequest = {
  sourceKind: "document" | "grid" | "grid-row" | "ketcher";
  documentId?: string;
  rowId?: string;
  payloadHash?: string;
};
```

Response:

```ts
type DescriptorSourceStatus = {
  eligible: boolean;
  reason?: string;
  sourceKind: string;
  sourceLabel?: string;
  moleculeCount?: number;
  cachedRunId?: string;
  activeRunId?: string;
};
```

## Run Request

```ts
type DescriptorRunRequest = {
  sourceKind: "document" | "grid" | "grid-row" | "ketcher";
  documentId?: string;
  rowId?: string;
  sourcePayload?: DescriptorSourcePayload;
  descriptorSet: "basic-2d" | "all-2d";
  ignore3d: true;
};

type DescriptorSourcePayload = {
  format: "molfile" | "smiles" | "sdf";
  text: string;
  label?: string;
  contentHash?: string;
};
```

The first version should only allow `ignore3d: true`.

`sourcePayload` is required for `sourceKind: "ketcher"` unless a separate
prepare-payload command is introduced. React owns the live Ketcher sketch and
must export molfile or SMILES before Rust can calculate descriptors.

## Grid Page Extension

Extend the existing grid page request without breaking older callers:

```ts
type GridPageRequest = {
  documentId: string;
  query?: string;
  sort?: string | GridSortSpec;
  offset?: number;
  limit?: number;
  filters?: GridFilter[];
  includeColumns?: string[];
};

type GridSortSpec = {
  field: string;
  direction: "asc" | "desc";
};

type GridFilter = {
  field: string;
  op:
    | "eq"
    | "neq"
    | "contains"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "between"
    | "is_null"
    | "is_not_null";
  value?: string | number | boolean;
  maxValue?: number;
};
```

Extend the page result:

```ts
type GridPageResult = {
  rows: GridPageRow[];
  totalRows: number;
  offset: number;
  limit: number;
  availableColumns?: GridColumnSchema[];
  appliedFilters?: GridFilter[];
  appliedSort?: GridSortSpec;
};

type GridPageRow = {
  rowId?: string;
  index: number;
  name?: string;
  smiles?: string;
  molblock?: string;
  props?: Record<string, string>;
  descriptors?: Record<string, DescriptorCellValue>;
};

type DescriptorCellValue = {
  value?: number | string | boolean;
  missingKind?: string;
  errorText?: string;
};

type GridColumnSchema = {
  id: string;
  label: string;
  kind: "base" | "property" | "descriptor";
  valueType: "number" | "text" | "boolean";
  sortable: boolean;
  filterable: boolean;
  descriptorId?: string;
};
```

## SQL Safety

Descriptor filter and sort fields must be validated against a whitelist derived
from known base fields, stored properties, and descriptor definitions. User
input must never be interpolated into SQL identifiers directly.

## Compatibility Note

The current grid API supports `query`, simple string `sort`, `offset`, and
`limit`. Descriptor columns, typed filters, descriptor sort, row ids, and column
schema are not existing behavior; they are part of this feature's grid contract
work.
