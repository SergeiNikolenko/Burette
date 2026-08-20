# Retab file viewer

Generic (non-chemistry) file rendering is built on the [Retab UI](https://ui.retab.com)
shadcn registry: PDF, DOCX, XLSX, PPTX, CSV/TSV, images (incl. TIFF), Markdown, HTML,
email, plain text, code, logs and configs. Chemistry surfaces (Mol*, 2D grid,
xyzrender, spectrum, Ketcher, mesoscale, FEP) are unaffected and keep their own
renderers, and so do scientific text formats (`xvg`, `fasta`, `out`, `err`, structure
inputs): they feed structure-text highlighting and source editing.

Two extension sets in `apps/desktop/src/lib/file-routing.ts` drive the split:

- `documentViewerExtensions` (office, images, Markdown, HTML, email): always render
  in a Retab document tab, even when dropped on a dock.
- `documentTextViewerExtensions` (text, code, logs, configs): render in a Retab
  document tab from the main open path, but a dock drop keeps the editable
  CodeMirror surface — that is where source editing lives.

CSV/TSV stay grid-first: the chemistry grid opens them (SMILES columns become 2D
grids, plain tables get the data-table preview); only grid-rejected files fall back
to a Retab tab, without surfacing the grid's rejection as an error toast.

## How a document opens

`isDocumentViewerPath` in `apps/desktop/src/lib/file-routing.ts` decides which files
belong to the viewer. Both open paths — `use-app-file-open.ts` for the shell and
`use-app-dock-payload-open.ts` for dock drops — classify those files before the text
fallback, and open them through `openDocumentTab`, which is the `document` page kind.

The page kind hands the viewer the file bytes:

- desktop: the `read_document_file` Tauri command (256 MiB limit) and a `blob` source.
  The asset protocol is not an option here, its scope covers generated runtime files
  only, so arbitrary user paths are refused.
- browser dev: the existing `/__burette/read-file` bridge and a `url` source. The
  extensions must also be listed in `DEV_FILE_EXTENSIONS` in `apps/desktop/vite.config.ts`.

## Installing and updating

The registry is declared in `apps/desktop/components.json`:

```json
"registries": { "@retab": "https://ui.retab.com/r/{name}.json" }
```

Install or refresh with the shadcn CLI from `apps/desktop`:

```bash
yes n | bunx shadcn@4.13.1 add @retab/file-viewer --yes
```

`@retab/file-viewer` is not modular: `@retab/pdf-viewer` depends back on it, so the whole
set (~240 files) always installs together.

Answer `n` to every overwrite prompt. Six files are intentionally kept as ours and must
never be overwritten by the registry:

- `src/lib/utils.ts`
- `src/components/ui/button.tsx`
- `src/components/ui/separator.tsx`
- `src/components/ui/dropdown-menu.tsx`
- `src/components/ui/skeleton.tsx`
- `src/components/ui/spinner.tsx`

## Static assets

The Markdown viewer's primary mermaid renderer is a WASM module fetched from
`/vendor/mmdr/typst_mmdr.wasm`. The registry does not ship it; it is vendored at
`apps/desktop/public/vendor/mmdr/typst_mmdr.wasm` (downloaded from
`https://ui.retab.com/vendor/mmdr/typst_mmdr.wasm`). Without it the code falls back
to the `mermaid` npm package, whose foreignObject labels the sanitizer strips —
diagrams then render with empty node labels.

## Theme tokens

Vendored components read plain shadcn token names (`var(--background)`,
`var(--foreground)`, ...). Burette names its tokens `--shadcn-*`, so `.app-shell`
in `apps/desktop/src/styles.css` aliases the plain names to ours; custom properties
inherit from there into the viewer's shadow root. `--accent` is deliberately not
aliased — the app already owns that name.

## Pixel parity with upstream

The viewer surface must look exactly like ui.retab.com, while the rest of the app
keeps the Burette theme. Two mechanisms provide that:

- Retab's own `button`, `dropdown-menu`, `skeleton` and `spinner` (the registry
  ships them inside its items) are vendored as `retab-button.tsx`,
  `retab-dropdown-menu.tsx`, `retab-skeleton.tsx`, `retab-spinner.tsx`, and every
  vendored Retab file imports those instead of the Burette primitives of the same
  name. Burette's `button.tsx` etc. stay untouched for the rest of the app.
- `.document-stage` in `styles.css` pins the palette harvested from
  ui.retab.com's computed styles (light and dark) — alpha-blended hairline
  borders, 4% muted tones. The registry publishes no theme of its own; it
  inherits host tokens, so this scope is what makes the surface match upstream.
- The shadcn v4 border-color preflight (`* { border-color: var(--border) }`)
  that Retab's host app ships globally is restored scoped to the viewer:
  `.document-stage *` for the light DOM plus `:host *` for the csv/xlsx shadow
  scopes. Without it, bare `border-r`/`border-b` utilities paint with
  near-black `currentColor` — the "dark grid" failure mode.

Plain delimited files are routed by `isMolecularDelimitedFile`
(`apps/desktop/src/lib/delimited-molecules.ts`): a structure-named column or
SMILES-looking values send the file to the chemistry grid, anything else opens in
the Retab CSV table.

## Local patches

Registry code is vendored, so these edits must be re-applied after every update:

| File | Patch | Reason |
| --- | --- | --- |
| every vendored file importing `./button`, `./dropdown-menu`, `./skeleton`, `./spinner` | import path prefixed with `retab-` | keep Retab's primitives for the viewer surface without restyling the app |
| `csv-viewer-row-patcher.ts`, `xlsx-viewer-row-patcher.ts` | `isHidden: Boolean(element.hidden)` | `HTMLElement.hidden` is `boolean \| "until-found"` in our TypeScript DOM lib |
| `file-viewer-sidebar.tsx` | cast the rail click event to `React.MouseEvent<HTMLButtonElement>` | the rail renders either `Slot.Root` or `button` |
| `file-viewer-route.tsx` | image branch passes `defaultScale={1}` | open media at natural size, no fit-to-width auto zoom |

The PDF page kind composes `PdfViewerPages` with `defaultScale={1}` and the page
thumbnail sidebar (`PdfViewerThumbnails`), mirroring upstream's pdf-viewer-demo.

The CLI also rewrites shared dependency ranges in `apps/desktop/package.json`
(`lucide-react`, `@base-ui/react`, `radix-ui` are downgraded, `tailwind-merge` is added).
Restore our ranges after every update and verify with `bun run typecheck`.
