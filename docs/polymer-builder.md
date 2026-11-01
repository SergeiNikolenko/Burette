# Polymer repeat placement

The pure polymer constructor accepts one explicit connected neutral repeat graph,
ordered heavy attachment atoms and their distinct singly bonded leaving H atoms.
Count is 1–500 within the existing 100,000 input-atoms-times-count budget; new
links are single bonds with a requested length of 0.5–3 Å.

Hydrogen termination keeps the first head H and final tail H. The historical
`endGroups: "open"` value now raises an explicit unsupported-terminal-valence
error: deleting H without writing persistent radical or other terminal chemistry
was silently hydrogen-capped again by an ordinary SDF reader. The type retains
that spelling to make the API compatibility change explicit; it is not supported.

The first repeat retains its coordinates exactly. Later repeats use proper rigid
rotations between local attachment frames: the new head leaving direction faces
opposite the previous tail leaving direction. The projected head-to-tail vector
sets a deterministic outward roll. A non-collinear second attachment direction
supplies the frame when needed. Opposed collinear ends carry the previous frame;
same-direction collinear ends have no defined roll and are rejected. No world
axis, reflection, coordinate perturbation or minimization determines attachment.
Existing inter-repeat overlap refusal remains active.

`sourceAtomIndices[i]` and zero-based `repeatIndices[i]` identify every surviving
output atom's source/copy. They are provenance indices, not reused document UUIDs.
The graph contains the surviving original bonds and one tail-to-next-head bond
per join. Source arrays remain unchanged. The result is an unrelaxed starting
structure; `requiresRelaxation` retains its existing meaning.

`test:polymer-attachment` verifies analytic tetrahedral placement, rigid distances,
source reorder and rigid-transform invariance, hydrogen/formula/valence, rejected
input and real SDF graph reopening in RDKit and native MolStar. This pure stage
does not activate a UI, pick atoms in 3D, publish documents,
insert into an existing graph, or claim Browser/native-app acceptance. The full
stage 7 and twelve-stage parity backlog remain open.

## Local vinyl tacticity

An optional `tacticity` discriminated value selects `{ kind: "isotactic" }`,
`{ kind: "syndiotactic" }` or `{ kind: "atactic", alternatives: [...] }`.
This stage supports a carbon head directly bonded to a CH2 tail that has one
other carbon neighbor. The two singly bonded tail hydrogens are the local
alternatives. The explicitly selected tail H is alternative 0; the other is 1.
The starting tail is prochiral, so input CIP assignment is not required.

Isotactic uses 0 throughout; syndiotactic alternates 0/1. Atactic requires exactly
one already resolved binary choice per repeat. The pure function does not draw
random values: a future job owner must sample once per request and preserve those
choices through preview/create/retry. The result includes `repeatAlternatives`.
This API realizes the chosen atactic pattern; it does not yet expose random
sampling in a worker or UI. With no tacticity option, existing selected-H behavior
is retained for other eligible repeat graphs.

Only the joining tail H is removed. All surviving atoms still use proper rigid
transforms. Unrelated existing stereocenters are never globally reflected. A
terminal capped site can remain chemically non-stereogenic even though a local
choice is recorded. General multiple-site tacticity and other termination
chemistry remain separate requirements.

The independently frozen six-repeat propylene references contain C18H38,
56 explicit atoms, 55 bonds and four actual interior stereocenters. Isotactic
finite-chain CIP is R,R,S,S; syndiotactic is S,R,R,S. CIP priorities depend on
finite-chain ends, so uniform absolute R/S is not the tacticity definition.
`test:polymer-tacticity` checks exact graph isomers against independent SMILES,
coordinate-derived RDKit CIP, source reorder, opposite seed, replayable patterns,
provenance and preserved local geometry. Fixtures retain their upstream and
independent-review provenance. No additional full-stage or surface completion
is inferred.

### Resolved tetrahedral eligibility

Local tacticity additionally requires both hydrogen alternatives to form stable
three-dimensional tetrahedra around the tail atom. Every center-to-neighbor
triple must exceed 0.1 Å³ plus the determinant error bound from four-decimal SDF
rounding, with consistent orientation of the four faces. The 0.1 threshold comes
from RDKit 2026.03.6 `assignChiralTypesFrom3D`, not an invented angular cutoff.
Requiring all triples makes this sufficient eligibility independent of atom/bond
ordering; the reader's particular fixed-order fourth-neighbor fallback can accept
some less robust cases that this bounded constructor intentionally refuses.

Planar/near-planar configurations and the degenerate collinear alternative-frame
case are rejected before placement; no perturbation, invented CIP annotation,
reflection or relaxation substitutes for resolved stereo. A nonzero determinant
alone does not prove that the actual SDF consumer assigns a configuration.
The original normal fixture/reference tests remain unchanged, and regressions
cover z scales 0, 1e-6, 0.001 and 0.01 plus a genuinely assigned 0.1 control.
