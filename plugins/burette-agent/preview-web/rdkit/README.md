# RDKit.js Runtime Assets

Burette's 2D molecule grid expects these vendored offline files in this directory:

- `RDKit_minimal.js`
- `RDKit_minimal.wasm`

Generate them with:

```sh
bun install --ignore-scripts
bun run vendor:rdkit
```

The files are vendored into the app bundle so Quick Look previews do not depend on network access.
