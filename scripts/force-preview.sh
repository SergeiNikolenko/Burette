#!/usr/bin/env bash
set -euo pipefail
FILE="${1:-}"
if [[ -z "$FILE" || ! -f "$FILE" ]]; then
  echo "usage: $0 /path/to/structure.pdb|cif|mmcif|sdf|smi|csv|tsv|xyz|gro|xtc|trr|cube|vasp|mae" >&2
  exit 1
fi
if [[ "${FILE,,}" == *.mae.gz ]]; then
  TYPE="com.local.burrete10.schrodinger"
else
case "${FILE##*.}" in
  pdb|PDB|ent|ENT|pdbqt|PDBQT|pqr|PQR) TYPE="com.local.burrete10.pdb" ;;
  cif|CIF) TYPE="com.local.burrete10.cif" ;;
  mmcif|MMCIF|mcif|MCIF) TYPE="com.local.burrete10.mmcif" ;;
  bcif|BCIF) TYPE="com.local.burrete10.bcif" ;;
  csv|CSV) TYPE="public.comma-separated-values-text" ;;
  sdf|SDF|sd|SD) TYPE="com.local.burrete10.sdf" ;;
  smi|SMI|smiles|SMILES) TYPE="com.local.burrete10.smiles" ;;
  tsv|TSV) TYPE="public.tab-separated-values-text" ;;
  mol|MOL) TYPE="com.local.burrete10.mol" ;;
  mol2|MOL2) TYPE="com.local.burrete10.mol2" ;;
  xyz|XYZ) TYPE="com.local.burrete10.xyz" ;;
  cub|CUB|cube|CUBE|in|IN|log|LOG|out|OUT|vasp|VASP) TYPE="com.local.burrete10.xyzrender-input" ;;
  gro|GRO) TYPE="com.local.burrete10.gro" ;;
  xtc|XTC|trr|TRR|dcd|DCD|nctraj|NCTRAJ|lammpstrj|LAMMPSTRJ|top|TOP|psf|PSF|prmtop|PRMTOP) TYPE="com.local.burrete10.molecular-dynamics" ;;
  mae|MAE|maegz|MAEGZ|cms|CMS) TYPE="com.local.burrete10.schrodinger" ;;
  *) TYPE="$(mdls -raw -name kMDItemContentType "$FILE" 2>/dev/null || true)" ;;
esac
fi
qlmanage -p -c "$TYPE" "$FILE"
