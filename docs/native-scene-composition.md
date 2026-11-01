# Native scene composition

The existing composition visibility channel owns live represented-scene counts.
An optional request `{type: "compositionVisibilityRequest", queries: ["all"],
hierarchy: true, requestId}` also requests bounded Polymer chain descriptors.
The native viewer evaluates its existing Polymer query against the union of
represented components. Overlapping representations count once; hidden components
remain present; removals and restoration update the union.

Each descriptor contains the exact native author chain ID and atom/residue totals.
Descriptors aggregate the same author ID across units/structures, matching the
existing chain selector scope. No coordinate text, Original, atom object array,
source-format guess or BuretteAgent summary is generated. Empty IDs have no chain
action. At most 126 descriptors of at most 128 identifier characters are returned;
whole-scene totals remain exact and truncation is explicit in the protocol. Two
of the existing 128 query slots remain for the whole-scene and Polymer queries.
The whole-scene subscription is retained when other query clients fill the budget.

The same channel supports at most 16 active hierarchy request IDs, each bounded
to 128 characters. Requests beyond capacity do not evict an existing consumer.
`releaseId` retires only that subscription. Responses echo `hierarchyRequestIds`
so independent Info consumers can reject queued results from an earlier source.
Ordinary visibility-only callers retain their existing payload and behavior.

The reporter stays beside the existing private query/component owner because it
reuses its cached query results and represented Loci union. It adds no native
facade export or general-purpose action API. ROOT and selected query-language
implementations remain separate and unchanged.

`test:native-scene-composition` executes the actual built MolStar IIFE and the
exact native reporter with the saved generated peptide fixture, duplicate
components, hiding, removal/state restoration, 130 authored chains and capacity
release. This CPU validation does not establish Browser/WebGL acceptance.

## Plain MOLX Info consumer

Info uses native composition only for Mol* MOLX without a validated logical text
source. Ordinary CIF and logical-source MOLX retain their text/draft composition.
The consumer checks the exact document object, active iframe Window and source
attributes, plus its echoed subscription ID. Attribute or document lifetime ABA
retires the old subscription; unmount releases it. No scene source, scientific
metadata or edit lease is stored in this display hook.

The existing composition rows/actions display Atoms 43, Chains 1 and Chain 7 with
3 residues/43 atoms for the saved PGI scene. Selection, hiding and removal use
the existing native actions. Empty scenes display zero atoms. A ToolPage Info
and the ordinary right Info dock can subscribe concurrently to the same viewer.

`test:native-scene-info` compiles the actual Info owner and consumer, runs the real
ordinary MOLX chooser and native scene, and exercises both Info consumers, chain
actions, state restoration, detachment/reattachment and queued stale responses.
The original scientific MOLX/CIF tests remain unchanged. The fixture is a peptide
created in Burette, not experimental or quantum-producer output. Native Undo UI
and the final Browser bundle remain separate parent acceptance steps.
