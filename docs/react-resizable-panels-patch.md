# Resizable panel dependency patch

Burette pins `react-resizable-panels` to **4.14.8** and applies a Bun package
patch. The official synchronization fix from upstream commit
`625ef2d83a839eb6fb1a1c7e2703f27598136472` is retained. The local source patch
preserves fixed pixel sizes when panel constraints re-register a group, including
hidden containers, collapse/expand, keyboard resizing, and imperative calls before
ResizeObserver delivery. Read-only getters remain pure; keyboard changes retain
`isUserInteraction: true` so the application persists user sizes.

## Sources and generated output

- Upstream: <https://github.com/bvaughn/react-resizable-panels>
- Tag: `4.14.8`, commit `c19f0a93a96e4f214e9bd7b77eaec155f31f50d7`
- Reviewed source: `patches/react-resizable-panels@4.14.8.source.patch`
- Generated Bun patch: `patches/react-resizable-panels@4.14.8.patch`
- Baseline and output hashes: `patches/react-resizable-panels@4.14.8.provenance.json`

The generated patch changes the two runtime bundles and their source maps.
The public declaration file is unchanged. Do not edit the generated patch or
installed runtime files by hand.

## Reproduce

1. Clone the exact upstream tag into a fresh directory outside Burette. Verify
   `git rev-parse HEAD` equals the commit above.
2. Install the unchanged upstream lockfile with
   `pnpm install --frozen-lockfile --ignore-scripts`, then run
   `pnpm run build:lib`. The baseline must match the registry hashes recorded in
   the provenance file; all five baseline dist files were verified byte-for-byte.
3. Apply the source patch with `git apply --check` followed by `git apply`.
   Run `pnpm run build:lib` again. Compare each emitted file with its candidate
   hash in the provenance file.
4. In another disposable consumer, install exact `react-resizable-panels@4.14.8`.
   Run `bun patch react-resizable-panels@4.14.8`, copy the mechanically rebuilt
   `dist` files into that prepared package, then run
   `bun patch --commit node_modules/react-resizable-panels`. Use Bun 1.4.2.
5. Copy the resulting patch to Burette's declared patch path. Keep the root
   `package.json` version and `patchedDependencies` entry paired with `bun.lock`.
   Regenerate the existing lock with `bun install --lockfile-only --ignore-scripts`
   and inspect the diff for unrelated dependency changes. Verify a fresh
   `bun install --frozen-lockfile --ignore-scripts` in an isolated checkout.

Installations for validation must use their own node_modules directories, never a
symlink to another checkout. The dependency is declared in root `package.json`;
`apps/desktop/package.json` does not need a duplicate declaration.

## Validation

Run the repository regression suite and its strict type check:

```sh
vp run test:resizable-panels
vp run typecheck:resizable-panels
```

The source patch was independently checked against eleven lifecycle scenarios and
two additional getter/event/relative-size scenarios: 13 scenarios, 91 assertions.
Both generated ESM and CommonJS packages passed after a fresh frozen Bun install.
The unchanged upstream `Group.test.tsx` and `getImperativeItemMethods.test.ts`
suites passed 87 tests. Upstream 4.14.8 and 4.15.2 each failed eight of the original
eleven scenarios without the patch; 4.15.2 adds separate accordion redistribution
behavior and was not selected as the baseline for this fix.

For an application change, also run the desktop TypeScript check and build, then
verify the actual browser shell: resize wide/narrow/wide, reopen after Settings,
collapse/expand, keyboard resize, and pointer drag. Component tests and build
results do not replace that browser acceptance.

## Browser acceptance

The compiled browser shell at source revision
`f6e4419fb600a03e7789a5b57267db6e60e8181c` was exercised with a molecular
file in both light and dark themes. The right dock retained its 360-pixel width
through 1280 → 760 → 1280 viewport changes, collapse/reopen, and a Settings
round trip while the workspace was hidden. Keyboard resizing changed it to
approximately 424 pixels; that width survived another viewport change. A pointer
drag reduced it to approximately 364 pixels, which remained stable after returning
to the wide viewport and switching themes. At 760 pixels the document had no
horizontal overflow, and the browser console reported no errors.

This verifies the browser pane lifecycle for that fixed build. Packaged macOS,
Quick Look, iPhone, and unrelated workbench flows require their own acceptance.
