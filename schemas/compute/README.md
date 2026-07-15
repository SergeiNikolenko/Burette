# Compute protocol schemas

These JSON Schema 2020-12 documents describe the untrusted JSON boundary of
the Burrete compute protocol. They reject unknown fields, invalid enum and
token spellings, unsafe JSON integers, malformed identifiers and hashes,
unbounded collections, non-canonical paths, invalid packed-array storage
metadata, and incomplete state-specific evidence.

The schemas are a structural prefilter, not the authority for persisted or
executed compute state. Every decoded value must also pass the corresponding
validator in `crates/burrete-compute-protocol`. Rust validation remains
authoritative for invariants that standard JSON Schema cannot express:

- UTF-8 byte limits rather than Unicode code-point limits;
- strict ordering or uniqueness by one field or a compound key;
- sums across arrays and aggregate byte budgets;
- comparisons and arithmetic across fields, including rational bounds,
  packed-array byte lengths, file ranges, and overlap;
- canonical JCS hashes and identity bindings between requests, plans, jobs,
  packs, artifacts, and handshake transcripts;
- timestamp ordering and stage-to-attempt history bindings;
- the encoded control-frame byte limit.

`fixtures/valid-*.json` are complete golden wire objects. The contract test also
contains representative structural-valid/semantic-invalid mutations for these
cross-field classes, so weakening the Rust-only boundary is visible rather
than accidental.
The canonical request and execution-plan fixtures use RFC 8785 JCS and are
pinned to their expected SHA-256 values in the test.

Run the focused contract in both supported JavaScript runtimes:

```sh
bun tests/test-compute-schema-contract.mjs
node tests/test-compute-schema-contract.mjs
```
