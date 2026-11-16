# Polymer worker and source ownership

This private desktop source stage has no builder UI activation. `usePolymerSource`
reads the current explicit MOL/SDF connection table, including a restored MOLX
logical graph or an unsaved source draft. It shares bounded text and document
lifetime capture with the assembly source owner; the assembly API is unchanged.

`prepare(settings, requestCurrent)` captures the exact source, session revision,
and caller request lifetime. It samples atactic alternatives once with browser
cryptographic entropy and freezes the prepared request. `build()` coalesces a
pending worker and retains the successful result. Preview, repeated Create, and
an opening retry use the same SDF bytes and alternatives. `release()` cancels the
worker and retires publication; callers release a replaced or closed request.
Source close, exact-document replacement, logical-source replacement, and draft
revision changes also retire it. `create(actions)` uses the existing guarded
file-open owner and `newDocument: true`, including its unadopted-source cleanup.

The worker parses one explicit connection table with the existing 2 MB / 256
source-atom parser. Source indices are zero-based MOL/SDF rows, including H;
OpenChemLib's internal H reorder is mapped back before placement. The separate
pure placement budget remains 1–500 repeats and 100,000 input-atoms × repeats.
Neither limit is an optimization/relaxation budget. Charges, isotope labels, and
radicals are refused after the metadata-preserving parse, before graph writing.
Only the accepted hydrogen termination and resolved local tacticity class apply.

The [private native role-picking prerequisite](polymer-picking.md) does not activate the builder UI.

Pending stage 7 work includes actual native 3D role picking and UI acceptance,
automatic 3D preparation of 2D sources with graph/stereo preservation (requirement
03.08), real relaxation, other terminations, copolymers, and geometry-preserving
insertion into an existing molecule with one Undo. A planar-site refusal here
is an admission boundary, not completion of automatic 3D preparation. Full
Avogadro parity and other surfaces remain open.

Validation: `vp run test:polymer-worker` compiles and executes the real worker,
checks native MolStar source-row/full-bond reopening, and uses the real source
editor and file-open hooks for lifecycle/publication races.
`vp run typecheck:polymer-worker` checks this boundary. Existing assembly and
pure polymer tests remain unchanged.
