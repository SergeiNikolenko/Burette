# Isolated molecule preview

Run from the repository root:

```sh
vp dev apps/desktop --host 127.0.0.1 --port 1497 --strictPort --config apps/desktop/vite.config.ts
```

Open `/dev/molecule-preview.html` in the in-app Browser. This development-only
fixture reads the production card markup, CSS, geometry and hide/restore handlers.
RDKit draws GDP; three fixture instances exercise the navigation controls.
Ketcher is disabled because this page has no workspace host. Lasso and zoom use
the production interaction controller; selection highlights atoms locally. Copy
uses the production feedback handler, including success/failure and reset.

Check both appearances, edge resize, hide, background click, Escape, and restore
using the bottom chip. Selection changes and document teardown are covered by
`tests/test-molecule-preview-interactions.mjs`. This is not native-app acceptance.
