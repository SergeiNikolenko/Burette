# Vertical Dock installer

`background.tiff` is the Finder background used by `scripts/create-dmg.sh`.
It follows a vertical drag-to-install layout: a cropped Dock photograph above,
three downward chevrons, then the real Applications alias below.

`dock-reference.png` is the user-provided Dock screenshot (21 September 2026).
The crop centres Burette between Calendar and the purple cloud terminal icon. Finder overlays the real
Burette app icon on the photographed icon, so the installer remains draggable.
No labels or Applications icons are painted into the artwork. A faint diffuse
blue glow sits behind the app without a hard outline. The lower panel is neutral
grey with subtle cloud texture, keeping Finder’s dark filenames readable.

Regenerate the checked-in SVG and Retina TIFF on macOS with Node, librsvg and
Apple's tiffutil:

```sh
node scripts/build-dmg-background.mjs
bun tests/test-dmg-background.mjs
bash scripts/create-dmg.sh /path/to/Burette.app /path/to/Burette.dmg
```

The artwork is 356 × 520 points; the Finder window is 356 × 552 including its
32-point title bar. Its 128-point icons are centred at (178, 184) and (178, 386).
Keep these positions in `create-dmg.sh` aligned with `build-dmg-background.mjs`.
The TIFF contains 1× and 2× pages with 72 and 144 DPI respectively.
The generated TIFF is an intentional large asset.

Validate the final read-only DMG in Finder, not just the SVG. Check icon overlap,
label placement, both appearance modes, and the Applications symlink. Packaging
an existing app does not rebuild, re-sign or notarize that app.

The existing sky.png provides the faint monochrome cloud texture in the lower
panel. The sky renderer and molecular SVGs remain available as source artwork;
the molecular SVGs are no longer used in the installer background.
