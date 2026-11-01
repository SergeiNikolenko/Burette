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
does not activate a UI, implement tacticity, pick atoms in 3D, publish documents,
insert into an existing graph, or claim Browser/native-app acceptance. The full
stage 7 and twelve-stage parity backlog remain open.
