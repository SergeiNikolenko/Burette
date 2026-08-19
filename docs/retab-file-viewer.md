# Retab file viewer

Generic (non-chemistry) file rendering is built on the [Retab UI](https://ui.retab.com)
shadcn registry: PDF, DOCX, XLSX, PPTX, CSV/TSV, images, code, Markdown and email.
Chemistry surfaces (Mol*, 2D grid, xyzrender, spectrum, Ketcher, mesoscale, FEP) are
unaffected and keep their own renderers.

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

## Local patches

Registry code is vendored, so these edits must be re-applied after every update:

| File | Patch | Reason |
| --- | --- | --- |
| `viewer-controls.tsx`, `viewer-download.tsx`, `viewer-zoom.tsx` | `size="iconSm"` → `size="icon-sm"` | our `Button` names icon sizes with dashes |
| `csv-viewer-row-patcher.ts`, `xlsx-viewer-row-patcher.ts` | `isHidden: Boolean(element.hidden)` | `HTMLElement.hidden` is `boolean \| "until-found"` in our TypeScript DOM lib |
| `file-viewer-sidebar.tsx` | cast the rail click event to `React.MouseEvent<HTMLButtonElement>` | the rail renders either `Slot.Root` or `button` |

The CLI also rewrites shared dependency ranges in `apps/desktop/package.json`
(`lucide-react`, `@base-ui/react`, `radix-ui` are downgraded, `tailwind-merge` is added).
Restore our ranges after every update and verify with `bun run typecheck`.
