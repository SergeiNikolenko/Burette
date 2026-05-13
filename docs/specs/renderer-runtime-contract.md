# Renderer Runtime Contract

The renderer runtime is Burrete's product engine. Both the desktop shell and the
Quick Look extension load generated preview artifacts through this contract.

## Inputs

- source molecular file path
- detected or selected renderer mode
- renderer settings
- generated artifact directory

## Outputs

- preview HTML or SVG
- renderer metadata
- optional logs from external renderer execution
- stable error state that can be shown in the desktop shell or Quick Look

## Requirements

- Do not require network access for bundled renderers.
- Keep Mol*, Fast XYZ, external `xyzrender`, and grid renderer paths separate.
- Keep generated preview artifacts repeatable from the same source file and
  settings.
- Preserve renderer state for mounted desktop preview tabs when possible.
