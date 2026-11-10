# Embeddable Burette viewer

A static web component for one structure or a docking result. It uses Burette's
3D runtime, default illustrative appearance, pose controls and scene tree.
It does not load the application workspace, structure editor or compute services.

## Build and serve

```sh
bun run build:embed --out /absolute/path/burette-embed
```

Serve the whole output directory from the host origin. For immutable caching,
put the directory under the version recorded in `manifest.json`. The manifest
records the Burette source revision and a SHA-256 for every shipped asset.
Deploy a whole directory at once so the client and frame stay in sync.

Copy that same artifact into each host's `public/burette-embed` directory.
Record its checksum in the host's runtime metadata after an intentional update.

```sh
node public/burette-embed/verify.mjs --write-pin src/viewer/runtime.json
```

Run `node public/burette-embed/verify.mjs src/viewer/runtime.json` before host
builds to verify every asset and the pinned manifest. Never edit copied assets.

## Use

```js
import { createBuretteViewer } from '/burette-embed/burette-embed.js';

const viewer = createBuretteViewer(container, { theme: 'light' });
viewer.on('pose', ({ sourceRecordId }) => selectRow(sourceRecordId));
await viewer.open({
  structure: { name: 'receptor.pdb', url: receptorUrl },
  poses: { name: 'poses.sdf', data: posesText },
});
await viewer.setPoseRecord(3);
```

Give the container a height. Use `burette-embed.d.ts` for types. Pass the
application theme explicitly when it can differ from the system theme.

| Method | Effect |
| --- | --- |
| `open({ structure, poses?, activePose? })` | Resolves when the new scene is rendered. A subsequent open replaces the frame and cancels pending work. |
| `setPose(index)` | Shows the zero-based displayed pose. The camera stays where it is. |
| `setPoseRecord(sourceRecordId)` | Selects a zero-based record from the supplied docking pose file. |
| `setPoseMode('single' \| 'all')` | Switches between one pose and all poses. |
| `focusLigand()`, `resetCamera()` | Changes the camera in place. |
| `capture({ width?, height?, format?, axes?, transparent? })` | Returns an image data URI (PNG by default). Custom dimensions accept up to 4096 pixels per side. |
| `setTheme('light' \| 'dark' \| 'auto')` | Changes the theme in place. |
| `on(event, listener)` | Subscribes to `ready`, `pose`, `selection`, `error` or `export`. Returns an unsubscribe function. |
| `destroy()` | Cancels pending work and removes the frame and listeners. |

Files accept an `ArrayBuffer`, typed array, `Blob`, text or `url`.
The client does not detach input buffers. URLs use the host's same-origin
credentials. To use an application-specific authentication flow, load the file
in the application and pass its bytes. The combined scene limit is 100 MiB.
Structures accept PDB, mmCIF, BinaryCIF, SDF, MOL, MOL2, PDBQT, XYZ and GRO.
Docking accepts multiple SDF records, or one ligand in MOL, MOL2 or PDBQT.
`activePose` is a display index. To select by the original SDF record number,
call `setPoseRecord` after opening the scene.

The pose event includes the display index, source record, count and mode.
Without an `export` listener, files exported from the viewer menu download
through the host page. Call scene commands after `open` resolves.
If a scene command times out, the viewer discards that scene and its pending
commands. Call `open` again to recover.

Use the client API to control the scene. The renderer and its internal DOM
are private to the component. The client and frame match messages to their
own window and origin. Self-host trusted assets and serve the frame over HTTPS
in production.
