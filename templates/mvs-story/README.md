# MolViewSpec Story Templates

This directory is the source catalog for reusable Burette Story scaffolds. The
plugin build copies the JSON descriptors to
`plugins/burette-agent/assets/mvs-story-templates/`.

Each `burette_mvs_story_template.v1` descriptor contains:

- an agent-readable scientific purpose and category;
- declared variables with required/default values;
- a storyboard that separates the purpose and evidence for every step;
- scientific caveats that must survive customization;
- a complete compact Story whose snapshots validate against the official
  MolViewSpec schema after variable substitution.

Available templates:

| ID | Use |
| --- | --- |
| `structure-overview` | Global fold followed by ligand context. |
| `binding-site-tour` | Complex overview, pocket focus, and evidence-qualified interpretation. |
| `docking-pose-comparison` | Receptor context, two independently shown poses, and a consistent overlay. |
| `aligned-structure-comparison` | Reference, candidate, and overlay for structures already in one coordinate frame. |

List and instantiate them through the stable agent CLI:

```bash
bun scripts/burette-agent.mjs story-template-list
bun scripts/burette-agent.mjs story-template-create \
  --template binding-site-tour \
  --output /tmp/binding-site.mvsx \
  --var protein_url=protein.pdb \
  --var ligand_url=ligand.sdf \
  --asset protein.pdb=/absolute/path/protein.pdb \
  --asset ligand.sdf=/absolute/path/ligand.sdf
```

Templates are scaffolds, not analysis engines. An agent must replace generic
descriptions with observed evidence and may add residue selectors, labels,
measurements, primitives, and cameras only from declared inputs or completed
calculations. Docking scores must remain method-specific ranking outputs rather
than being relabeled as measured binding affinities.
