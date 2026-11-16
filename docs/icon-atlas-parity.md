# Shared Icon Parity With Codex Atlas

Source inventory: InterfaceAtlas `public/data/icons.json`, build `26.1027`.
The asset paths below are relative to that Atlas's `public/` directory. This
covers all 96 shared icon exports available to shell, menus and viewer controls.
Application logos and scientific symbols outside the shared registry are not
replaced by unrelated generic icons.

The generator remains `scripts/sync-app-icons.mjs`; the reviewed source remains
`config/icons/apps-sdk.json`. Sixteen refreshed glyphs copy the captured SVG
path data verbatim and apply the existing 16-to-24 canvas scale. Robot, filled
pin and expand have changed geometry; the other refreshed glyphs differ only
by source coordinate precision. Exact path matches below verify geometry,
not hover, selected-state CSS, native menu rendering or runtime accessibility.

| Burette export | Captured Atlas reference | Result |
| --- | --- | --- |
| `Annotate` | — | Product-specific annotation composite, explicitly retained by design-system.md; no identical standalone Atlas glyph. |
| `SidebarFolder` | `RadioGroup--UC` — `icons/build-26.1027/RadioGroup-89936f777914.svg` | Existing path match |
| `SidebarFolderOpen` | `RadioGroup--ZC` — `icons/build-26.1027/RadioGroup-2f4f065b4118.svg` | Existing path match |
| `SidebarGlobe` | `RadioGroup--J` — `icons/build-26.1027/RadioGroup-18ffa20178f8.svg` | Existing path match |
| `Agent` | `robot-light-16` — `icons/build-26.1027/app-shared-ad696c924c15.svg` | Updated to captured source |
| `ArrowCurvedRight` | `arrow-uturn-right-light-16` — `icons/build-26.1027/app-shared-c82b2ba6c892.svg` | Existing path match |
| `ArrowLeft` | `arrow-left-lg-light-16` — `icons/build-26.1027/app-shared-e00eaa2721d1.svg` | Existing path match |
| `ArrowRight` | `arrow-right-lg-light-16` — `icons/build-26.1027/app-shared-07450e149597.svg` | Existing path match |
| `ArrowRotateCcw` | `arrow-rotate-counterclockwise-light-16` — `icons/build-26.1027/app-shared-ad13dc14dc2b.svg` | Existing path match |
| `ArrowRotateCw` | `arrow-rotate-clockwise-light-16` — `icons/build-26.1027/app-shared-ad5827d95359.svg` | Existing path match |
| `ArrowUp` | `arrow-up-lg-light-16` — `icons/build-26.1027/app-shared-4fb542e7be5e.svg` | Existing path match |
| `Atom` | `RadioGroup--Fa` — `icons/build-26.1027/RadioGroup-dfb788991280.svg` | Existing path match |
| `BarChart` | `bar-chart-light-16` — `icons/build-26.1027/app-shared-7bf4747c627a.svg` | Existing path match |
| `Camera` | `camera-light-16` — `icons/build-26.1027/app-shared-f9d95016518f.svg` | Updated to captured source |
| `CameraPhoto` | `photo-light-16` — `icons/build-26.1027/app-shared-41459fdaf1c1.svg` | Updated to captured source |
| `Chart` | `line-chart-light-16` — `icons/build-26.1027/app-shared-71e92c4c92c8.svg` | Existing path match |
| `Check` | `checkmark-md-light-16` — `icons/build-26.1027/app-shared-d0db7def8bf1.svg` | Updated to captured source |
| `CheckCircle` | `circle-checkmark-light-16` — `icons/build-26.1027/app-shared-b04f5f46378c.svg` | Existing path match |
| `ChevronDown` | `chevron-down-md-light-16` — `icons/build-26.1027/app-shared-8f5ee215adbd.svg` | Existing path match |
| `ChevronRight` | `chevron-right-md-light-16` — `icons/build-26.1027/app-shared-4ffa45ec5f49.svg` | Existing path match |
| `ChevronUp` | `chevron-up-md-light-16` — `icons/build-26.1027/app-shared-71f89f4884b2.svg` | Existing path match |
| `ChevronUpDown` | — | Retains reviewed Codex 26.1007 selector chevrons. Latest selector assets use different viewBoxes and rendering contexts; no verified drop-in counterpart. |
| `Circle` | — | Filled status dot; intentionally not replaced with the outlined circle navigation glyph. |
| `Clip` | `paperclip-light-16` — `icons/build-26.1027/app-shared-94f1c3fec7de.svg` | Existing path match |
| `Clipboard` | `clipboard-light-16` — `icons/build-26.1027/app-shared-ae4825b26ca8.svg` | Existing path match |
| `Collapse` | `arrow-down-left-arrow-up-right-sm-light-16` — `icons/build-26.1027/app-shared-ca680b2fc2f7.svg` | Existing path match |
| `ColorTheme` | `paint-palette-light-16` — `icons/build-26.1027/app-shared-d6be2bdf2b40.svg` | Existing path match |
| `Compare` | `RadioGroup--Ih` — `icons/build-26.1027/RadioGroup-9a7033251eb2.svg` | Existing path match |
| `CompareArrows` | `arrow-left-arrow-right-light-16` — `icons/build-26.1027/app-shared-ce76a269c0c1.svg` | Existing path match |
| `Copy` | `square-on-square-light-16` — `icons/build-26.1027/app-shared-26f2f3f994df.svg` | Existing path match |
| `Cube` | `cube-light-16` — `icons/build-26.1027/app-shared-fd79f973f067.svg` | Existing path match |
| `Delete` | `trash-light-16` — `icons/build-26.1027/app-shared-c33260f864a3.svg` | Existing path match |
| `DotsHorizontal` | `ellipsis-horizontal-light-16` — `icons/build-26.1027/app-shared-43ccdfd3013f.svg` | Existing path match |
| `Download` | `arrow-down-open-base-light-16` — `icons/build-26.1027/app-shared-afdfe872165e.svg` | Existing path match |
| `Email` | `envelope-regular-16` — `icons/build-26.1027/app-shared-97d8f5da8a01.svg` | Existing path match |
| `Expand` | `arrow-up-right-arrow-down-left-md-light-16` — `icons/build-26.1027/app-shared-26a042bd699d.svg` | Updated to captured source |
| `ExternalLink` | `open-link-light-16` — `icons/build-26.1027/app-shared-dd5dce167486.svg` | Existing path match |
| `Eye` | `eye-light-16` — `icons/build-26.1027/app-shared-9c58c18414cc.svg` | Updated to captured source |
| `EyeOff` | `eye-slash-light-16` — `icons/build-26.1027/app-shared-a3b7278993a2.svg` | Updated to captured source |
| `FileBlank` | `document-light-16` — `icons/build-26.1027/app-shared-5789887d8d6a.svg` | Existing path match |
| `FileCode` | `code-light-16` — `icons/build-26.1027/app-shared-9770545da6ff.svg` | Existing path match |
| `FileDocument` | `document-text-light-16` — `icons/build-26.1027/app-shared-fadf727d591f.svg` | Existing path match |
| `FileImage` | `photo-light-16` — `icons/build-26.1027/app-shared-41459fdaf1c1.svg` | Updated to captured source |
| `FileSpreadsheet` | `spreadsheet-light-16` — `icons/build-26.1027/app-shared-730492f56752.svg` | Updated to captured source |
| `FileUpload` | `arrow-up-open-base-light-16` — `icons/build-26.1027/app-shared-545457f6f454.svg` | Existing path match |
| `Filter` | `filter-light-16` — `icons/build-26.1027/app-shared-b1a2d4110905.svg` | Existing path match |
| `Flask` | `flask-light-16` — `icons/build-26.1027/app-shared-315fb6614571.svg` | Updated to captured source |
| `Folder` | `folder-light-16` — `icons/build-26.1027/app-shared-2a39e4518e1c.svg` | Updated to captured source |
| `FolderOpen` | `folder-open-light-16` — `icons/build-26.1027/app-shared-ff6837f48fc5.svg` | Existing path match |
| `FolderPlus` | `folder-badge-plus-light-16` — `icons/build-26.1027/app-shared-42286f435696.svg` | Existing path match |
| `Grid` | `square-grid-2x2-light-16` — `icons/build-26.1027/app-shared-0e79be18c931.svg` | Existing path match |
| `History` | `arrow-rotate-counterclockwise-clock-light-16` — `icons/build-26.1027/app-shared-e2573946ed01.svg` | Existing path match |
| `InfoCircle` | `circle-info-light-16` — `icons/build-26.1027/app-shared-8932be0ca734.svg` | Existing path match |
| `Keyboard` | `keyboard-light-16` — `icons/build-26.1027/app-shared-a8eb3bf255bc.svg` | Updated to captured source |
| `Lightbulb` | `lightbulb-light-16` — `icons/build-26.1027/app-shared-9fbc358dfadf.svg` | Existing path match |
| `Link` | `link-light-16` — `icons/build-26.1027/app-shared-f13e42566e9e.svg` | Existing path match |
| `Minus` | `minus-md-light-16` — `icons/build-26.1027/app-shared-e60dfeeafeb9.svg` | Existing path match |
| `Pin` | `pin-light-16` — `icons/build-26.1027/app-shared-a81e0343a198.svg` | Existing path match |
| `Play` | `play-light-16` — `icons/build-26.1027/app-shared-aac3d4f61cfe.svg` | Existing path match |
| `PlayCircle` | `circle-play-light-16` — `icons/build-26.1027/app-shared-543fc4bbeae7.svg` | Existing path match |
| `Plus` | `plus-md-light-16` — `icons/build-26.1027/app-shared-0276f04533a1.svg` | Existing path match |
| `Reload` | `arrows-clockwise-rotate-lg-light-16` — `icons/build-26.1027/app-shared-2720c68648a9.svg` | Existing path match |
| `Scissor` | `RadioGroup--pK` — `icons/build-26.1027/RadioGroup-78f7b53078a4.svg` | Existing path match |
| `Search` | `magnifying-glass-md-light-16` — `icons/build-26.1027/app-shared-e54a9021e34c.svg` | Existing path match |
| `SettingsCog` | `gear-light-16` — `icons/build-26.1027/app-shared-b7dd2322d6c7.svg` | Updated to captured source |
| `SettingsSlider` | `sliders-light-16` — `icons/build-26.1027/app-shared-8b54aa9c559e.svg` | Existing path match |
| `SettingsWrench` | `wrench-light-16` — `icons/build-26.1027/app-shared-456897503c13.svg` | Existing path match |
| `SidebarLeft` | `sidebar-light-16` — `icons/build-26.1027/app-shared-54f84c5e65a9.svg` | Existing path match |
| `SidebarRight` | `sidebar-light-16` — `icons/build-26.1027/app-shared-54f84c5e65a9.svg` | Existing path match; rotated 180° as in panel-header controller |
| `SidebarLeftHidden` | `sidebar-hidden-light-16` — `icons/build-26.1027/app-shared-6e216b7e9f00.svg` | Existing path match |
| `SidebarRightHidden` | `sidebar-hidden-light-16` — `icons/build-26.1027/app-shared-6e216b7e9f00.svg` | Existing path match; rotated 180° as in panel-header controller |
| `Stack` | `stack-light-16` — `icons/build-26.1027/app-shared-1d3d434fc6d1.svg` | Existing path match |
| `Stop` | `stop-fill-light-16` — `icons/build-26.1027/app-shared-5c52c5f1c10d.svg` | Existing path match |
| `Stopwatch` | `stopwatch-light-16` — `icons/build-26.1027/app-shared-7c703b2e1665.svg` | Existing path match |
| `Tag` | `tag-light-16` — `icons/build-26.1027/app-shared-4c9b62dd1161.svg` | Existing path match |
| `Undo` | `arrow-uturn-left-light-16` — `icons/build-26.1027/app-shared-57dfa525c7b1.svg` | Existing path match |
| `Unpin` | `pin-slash-light-16` — `icons/build-26.1027/app-shared-2a60e7e518a4.svg` | Existing path match |
| `Warning` | `exclamation-mark-triangle-light-16` — `icons/build-26.1027/app-shared-9ed8c8a41bae.svg` | Existing path match |
| `X` | `xmark-md-light-16` — `icons/build-26.1027/app-shared-d655678b1763.svg` | Updated to captured source |
| `XCircleCrossedClose` | `circle-xmark-light-16` — `icons/build-26.1027/app-shared-959702d83ba8.svg` | Existing path match |
| `PinFilled` | `pin-fill-light-16` — `icons/build-26.1027/app-shared-c3add26fc1e6.svg` | Updated to captured source |
| `Edit` | `pencil-light-16` — `icons/build-26.1027/app-shared-b771afaaf0ce.svg` | Existing path match |
| `ThemeLight` | `RadioGroup---M` — `icons/build-26.1027/RadioGroup-85572e540192.svg` | Existing path match |
| `ThemeDark` | `RadioGroup--pne` — `icons/build-26.1027/RadioGroup-fd4676cdfe99.svg` | Existing path match |
| `ThemeAuto` | `RadioGroup--qI` — `icons/build-26.1027/RadioGroup-fd70dffcd461.svg` | Existing path match |
| `Orbit` | `orbit` — `icons/build-26.1027/lucide-orbit-0edbf769aa53.svg` | Existing path match |
| `Focus` | `focus` — `icons/build-26.1027/lucide-focus-2516f36dc999.svg` | Existing path match |
| `GripVertical` | — | Reviewed six-dot drag grip, preserved; latest Lucide grip assets are a different dot layout. |
| `GripHorizontal` | — | Reviewed six-dot drag grip, preserved; latest Lucide grip assets are a different dot layout. |
| `Move` | `move` — `icons/build-26.1027/lucide-move-230f2683f183.svg` | Existing path match |
| `MoveHorizontal` | `move-horizontal` — `icons/build-26.1027/lucide-move-horizontal-723e308c1c80.svg` | Existing path match |
| `MoveVertical` | `move-vertical` — `icons/build-26.1027/lucide-move-vertical-1182097c56b0.svg` | Existing path match |
| `Percent` | `percent-light-16` — `icons/build-26.1027/app-shared-8557cb5e7cbc.svg` | Existing path match |
| `KeystrokeSearch` | `keyboard--t` — `icons/build-26.1027/keyboard-5db30928dbb7.svg` | Existing path match |
| `ExclamationCircle` | `circle-exclamation-mark-light-16` — `icons/build-26.1027/app-shared-2d2152054255.svg` | Existing path match |
| `Sun` | `sun-light-16` — `icons/build-26.1027/app-shared-686edabdfe34.svg` | Updated to captured source |
