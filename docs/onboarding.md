# Onboarding

Burette has two kinds of onboarding: an opening and a three-step welcome on the
first launch, and one-time contextual guides that appear when the user first
reaches a feature. All of them live in `apps/desktop/src/components/onboarding`.

## Policy

- The welcome appears only for a fresh workspace. Established users who update
  never see it unless they reset onboarding.
- Contextual guides appear only after the welcome is completed, at most once per
  guide, at most two per day and at least ten minutes apart. A guide is shown
  only in response to the user's own action and is never queued for later.
- Hosted MCP widgets and Codex workspace embeds never show onboarding.
- Settings → Getting started → Reset onboarding restores the welcome and makes
  every contextual guide eligible again.

## Opening

The first launch of a fresh macOS install plays the Atom opening before the
welcome. A launch counts as fresh when there is no saved window state and no
file or link arrived with it. The main window then starts held: hidden, without
its material, shadow or traffic lights. `intro/atom-intro.tsx` draws the
opening in that window and sends `present_intro` cues as it plays:

| Cue | Native effect |
| --- | --- |
| `begin` | Dims every display and shows the bare window above the dim. |
| `chrome` | Fades the traffic lights in. |
| `undim` | Lifts the dims over the given number of seconds. |
| `settle` | Restores the material and shadow; the window stays an ordinary window. |

The button at the end of the opening continues to the welcome's appearance
step, since the opening already greets the user. Esc or switching away skips to
the end. The opening plays only while Burette is the active app: when it was
launched in the background or the user moved on while it loaded, `begin` fails,
the window appears as usual and the welcome starts from its first step. The
same fallback applies with Reduce Motion on or without WebGL. If the page never
begins or never finishes, `intro.rs` settles the window itself so no display
stays dimmed. Reset onboarding replays the opening in the current window.

Cue times and the shader live in `intro/atom-scene.ts`. The sound,
`apps/desktop/public/onboarding/intro/atom-intro.m4a`, is rendered by
`uv run scripts/create_intro_sound.py`; change the script and render again
instead of editing the file.

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
