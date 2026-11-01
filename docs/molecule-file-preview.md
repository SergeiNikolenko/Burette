# Owned molecular file previews

`MoleculeFilePreview` renders a locally generated, already bounded molecular result through the existing `GridMolecule3D` renderer. It creates a Blob from the exact text and reuses `useObjectUrl` to own its URL. The iframe bootstrap contains only this URL and configuration; source text is not copied into srcdoc or repeated in inspector postMessage updates.

A replacement payload unmounts the previous iframe and URL owner together. Cancel/unmount revokes the URL, including before renderer startup finishes. Repeated renders of the same text reuse the Blob. Theme or hydrogen display changes reload the preview configuration while retaining the same owned URL. Independent previews have independent lifetimes.

The existing native `BuretteDataURL` loader fetches the bytes. Blob URLs are opaque and receive no cache-buster query. The app CSP adds only `blob:` to `connect-src`: a srcdoc iframe inherits this policy, and its own metadata cannot relax a parent prohibition. All other directives and origins remain unchanged; `data:` is not added to connect-src.

Callers select the actual format. Generated polymer output is SDF, including V3000 and its record terminator, so it uses `format="sdf"`. Existing inline MOL/mmCIF consumers retain their 350,000-character admission/update limit and existing iframe reuse behavior. The Blob component adds no new scientific output budget; its producer remains responsible for admission.

## Validation

- `bun run test:molecule-file-preview` exercises real Blob fetch/revocation, replacement/cancel, exact bytes, the production bootstrap/payload loader, and native V3000 parsing.
- `bun run typecheck:molecule-file-preview` checks the focused TypeScript surface.
- On macOS, `bun run test:molecule-file-preview:webkit` uses an offscreen WKWebView with the actual app CSP and packaged MolStar. It never opens an application window. A synthetic 500-repeat chain has 6,502 atoms, 6,501 bonds and 444,651 SDF characters; full native rendering, replacement, light/dark, hydrogen visibility and teardown are checked. Artifacts stay in ignored `build/molecule-blob-preview-test` for diagnosis.
- Existing inline bootstrap and peptide preview tests remain unchanged.

The small chiral fixture is an independently constructed ideal geometry, not an imported experimental molecule. This transport does not perform conformer generation or optimization. Browser gestures, polymer UI adoption and full polymer feature parity remain separate acceptance lanes.
