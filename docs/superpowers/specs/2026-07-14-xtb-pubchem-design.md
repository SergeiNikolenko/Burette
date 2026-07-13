# xTB Runtime and PubChem Search Design

## Goal

Make xTB usable with an existing Conda-family installation, replace the current global Pixi installation with an app-managed environment, and add PubChem identity and 90% similarity searches for molecules with a trustworthy SMILES representation.

## Scope

This change covers the macOS desktop app and its browser-development parity surface. It does not change Quick Look file-type registration. The current registry already includes the ChemDraw SDF and MOL aliases, and any further change requires the `mdls` output requested from Chris.

Implementation is split into three reviewable stages:

1. Existing xTB selection and automatic Conda/Pixi/Homebrew/PATH discovery.
2. An isolated Burrete-managed xTB environment, replacing `pixi global install xtb`.
3. PubChem identity and similarity actions for exact molecule structures.

## xTB Runtime Contract

The native backend owns runtime selection so status checks and actual jobs always use the same executable. The selected executable is persisted under the Tauri app-data directory in `runtimes/xtb/config.json`. The stored path remains the user-selected path, including symlinks.

Resolution order is:

1. Explicitly selected executable. An invalid explicit selection fails closed and must not silently fall back.
2. The current Burrete-managed environment.
3. Active Conda environment (`CONDA_PREFIX`).
4. Common Miniconda, Miniforge, Mambaforge, Anaconda, and Pixi locations.
5. `PATH`, Homebrew, and conventional local binary locations.

Candidates must be absolute regular executable files. Status includes the resolved source (`selected`, `managed`, `conda`, `pixi`, `homebrew`, or `path`), executable path, version, and actionable diagnostics. Version probing is bounded so a broken executable cannot hang the settings panel.

Settings provides these contextual actions:

- **Use Existing…** opens a native file picker and validates the selected xTB executable.
- **Use Automatically** clears an explicit selection and returns to discovery.
- **Install Managed** installs xTB in Burrete app data.
- **Check** refreshes status.

Browser development exposes equivalent status, selection, installation, and execution routes. It stores its selection outside the repository and never mutates global `PATH`.

## Managed xTB Installation

Burrete ships a repository-owned Pixi manifest and lockfile for xTB. Installation runs `pixi install --locked --manifest-path` into a staged directory under app data, validates the resulting executable, and atomically promotes the staged environment. A failed install leaves the previous managed environment intact.

The installer never calls `pixi global install`, never modifies shell configuration, and never writes to the user's global Pixi environment. If Pixi is unavailable, Burrete explains how to select an existing executable instead.

## PubChem Search Contract

PubChem actions live in molecule-level menus: the Mol* molecule actions menu and grid row/card menus. They are visible only in the desktop app viewer, not shared Quick Look or iPhone viewer surfaces.

Actions are enabled only when Burrete can derive a complete, exact SMILES from the source molecule. SDF-backed structures and explicit grid SMILES are supported. Protein residues, inferred PDB/mmCIF/XYZ bonds, empty structures, wildcard/query atoms, and oversized SMILES are rejected.

The embedded viewer posts a structured trusted bridge message:

```json
{
  "type": "openPubChemSearch",
  "searchType": "identity",
  "smiles": "CCO"
}
```

The native backend accepts only `identity` or `similarity`, validates the SMILES, constructs the PubChem URL internally, URL-encodes the query, and opens it through the existing external-URL boundary. Identity uses `simp_schtp=fs`; similarity uses `simp_schtp=90`. The iframe never opens an arbitrary URL directly.

## Validation

Focused checks must cover:

- Resolution precedence and common Conda paths.
- Invalid explicit selections failing closed.
- Persisted selection and clearing behavior.
- No global Pixi installation command remaining in the xTB flow.
- Staged managed installation preserving an existing environment on failure.
- Native and browser-development status/run parity.
- PubChem encoding for stereochemistry, charges, salts, and reserved characters.
- Rejection of wildcard and oversized structures.
- Trusted bridge-source checks and absence of PubChem actions in Quick Look/iPhone modes.
- A flavored packaged-app smoke test for native selection, managed runtime status, and external PubChem opening.

## Acceptance Criteria

- Chris's `~/miniconda3/bin/xtb` can be detected automatically or selected explicitly.
- Running a job uses exactly the executable shown in Settings.
- Installing xTB creates only a Burrete-managed environment and does not affect global Pixi packages.
- Supported molecules can open PubChem identity and 90% similarity results with correctly encoded SMILES.
- Unsupported or ambiguous structures cannot launch a misleading PubChem search.
- Quick Look behavior remains unchanged until diagnostic evidence is available.
