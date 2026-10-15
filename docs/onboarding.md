# Onboarding

Burette has two kinds of onboarding: a three-step welcome on the first launch
and one-time contextual guides that appear when the user first reaches a
feature. Both live in `apps/desktop/src/components/onboarding`.

## Policy

- The welcome appears only for a fresh workspace. Established users who update
  never see it unless they reset onboarding.
- Contextual guides appear only after the welcome is completed, at most once per
  guide, at most two per day and at least ten minutes apart. A guide is shown
  only in response to the user's own action and is never queued for later.
- Hosted MCP widgets and Codex workspace embeds never show onboarding.
- Settings → Getting started → Reset onboarding restores the welcome and makes
  every contextual guide eligible again.

## Adding a guide

1. Add the entry to `contextual-guides.ts`: pattern, copy, media under
   `apps/desktop/public/onboarding/guides/`, and the `where`/`when` notes.
   Keep media under the 512 KB blob limit (WebP stills, short H.264 clips).
2. Call `requestContextualGuide(id, anchor)` from the user action that reaches
   the feature. Frames post
   `{ type: "burette:contextual-guide", id, rect }` to their parent instead.
3. Check the card in `/dev/onboarding.html` in both themes.

Patterns follow the Codex education surfaces: `carousel` pages through
screens, `education` lists short benefits, `first-use` is a single note,
`announcement` opens as a dialog, and `inline` sits inside the control it
explains.

## Where and when each guide appears

<!-- Generated from contextual-guides.ts; keep in sync. -->

| Guide | Pattern | Where | When |
| --- | --- | --- | --- |
| `view-modes` | carousel | File or tab menu → Open → As → Interactive 3D / 3D render | After you first open a file that supports both views with Open → As → Interactive 3D or 3D render. |
| `grid` | carousel | Collection → Cards / Table | The first time you switch between Cards and Table in a collection. |
| `ketcher` | announcement | Ketcher tab | The first time you open Ketcher, once the editor is ready. |
| `scene-compose` | education | Selected files → Open → In one scene → scene tree toggle | After a scene first holds several files, once the last file has loaded. |
| `pose-compare` | carousel | Selected MOL/SDF files → Open → As poses, or a docking view → pose switcher | The first time you switch poses with the pose list, arrows, slider, or arrow keys. |
| `trajectory` | education | Multi-frame XYZ trajectory → playback controls → Align | The first time Align finishes superimposing the frames. |
| `trajectory-smoothing` | inline | Trajectory → Info → Smooth motion | The first time you expand Smooth motion or turn smoothing on. |
| `source-dock` | carousel | Right dock → Text tab, or a dock file's view options → Text | The first time you open a structure's text in the right or bottom dock. |
| `source-edit` | first-use | Local structure → Text → Edit source | The first time you choose Edit source for a local structure, once the editor opens. |
| `fep-network` | carousel | FEP network → Graph / Grid / 3D | The first time you switch between Graph, Grid, and 3D in an FEP network. |
| `folder-watch` | education | Folder menu → Open → In one scene… | After you first open a folder In one scene from the Open folder dialog. |
| `smarts-search` | education | Collection → Search or SMARTS… | The first time a structure search in a collection finds matches. |
| `xyz-editor` | education | XYZRender → drawing menu → 3D & Animation…, or Style → Orientation & animation… | The first time the orientation and animation editor opens in XYZRender. |
| `spectra` | first-use | Spectrum → peak selection | The first time a spectrum opens, once its plot is drawn. |
| `chemical-space` | carousel | Chemical space → property coloring → point selection | The first time Chemical space opens for a collection, once the map is ready. |
