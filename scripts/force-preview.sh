#!/usr/bin/env bash
set -euo pipefail
FILE="${1:-}"
if [[ -z "$FILE" || ! -f "$FILE" ]]; then
  echo "usage: $0 /path/to/structure.pdb|cif|mmcif|sdf" >&2
  exit 1
fi
case "${FILE##*.}" in
  pdb|PDB|ent|ENT|pdbqt|PDBQT|pqr|PQR) TYPE="com.local.burrete10.pdb" ;;
  cif|CIF) TYPE="com.local.burrete10.cif" ;;
  mmcif|MMCIF|mcif|MCIF) TYPE="com.local.burrete10.mmcif" ;;
  bcif|BCIF) TYPE="com.local.burrete10.bcif" ;;
  sdf|SDF|sd|SD) TYPE="com.local.burrete10.sdf" ;;
  smi|SMI|smiles|SMILES) TYPE="com.local.burrete10.smiles" ;;
  mol|MOL) TYPE="com.local.burrete10.mol" ;;
  mol2|MOL2) TYPE="com.local.burrete10.mol2" ;;
  xyz|XYZ) TYPE="com.local.burrete10.xyz" ;;
  gro|GRO) TYPE="com.local.burrete10.gro" ;;
  *) TYPE="$(mdls -raw -name kMDItemContentType "$FILE" 2>/dev/null || true)" ;;
esac
qlmanage -p -c "$TYPE" "$FILE"
