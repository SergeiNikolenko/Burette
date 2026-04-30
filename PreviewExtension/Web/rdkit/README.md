# RDKit.js Runtime Assets

Burrete's 2D molecule grid expects these vendored offline files in this directory:

- `RDKit_minimal.js`
- `RDKit_minimal.wasm`

Generate them with:

```sh
npm install --ignore-scripts
npm run vendor:rdkit
```

The files are vendored into the app bundle so Quick Look previews do not depend on network access.
