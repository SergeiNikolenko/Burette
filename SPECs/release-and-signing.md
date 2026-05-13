# Release And Signing

## Summary

Burette can adopt Writer's release discipline, but release identity remains
Burette-specific.

## Requirements

- Version checks keep package, lockfile, marketing version, and visible About
  version aligned.
- The final app bundle is signed after embedding the Quick Look extension.
- The embedded extension is signed and verifiable.
- Update endpoints and release assets point to the Burette repository.
- Later license alignment is tracked as a release/legal task.

## Acceptance Criteria

- `codesign --verify --deep --strict` passes on the final app bundle.
- Release automation cannot overwrite existing tags.
- Quick Look extension remains present in release artifacts.
