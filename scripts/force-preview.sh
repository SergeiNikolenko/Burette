#!/usr/bin/env bash
set -euo pipefail
FILE="${1:-}"
if [[ -z "$FILE" || ! -f "$FILE" ]]; then
  echo "usage: $0 /path/to/structure.pdb|cif|mmcif|sdf" >&2
  exit 1
fi
case "${FILE##*.}" in
  pdb|PDB|ent|ENT|pdbqt|PDBQT|pqr|PQR) TYPE="com.local.molstarquicklook10.pdb" ;;
  cif|CIF) TYPE="com.local.molstarquicklook10.cif" ;;
  mmcif|MMCIF|mcif|MCIF) TYPE="com.local.molstarquicklook10.mmcif" ;;
  bcif|BCIF) TYPE="com.local.molstarquicklook10.bcif" ;;
  sdf|SDF|sd|SD) TYPE="com.local.molstarquicklook10.sdf" ;;
  mol|MOL) TYPE="com.local.molstarquicklook10.mol" ;;
  mol2|MOL2) TYPE="com.local.molstarquicklook10.mol2" ;;
  xyz|XYZ) TYPE="com.local.molstarquicklook10.xyz" ;;
  gro|GRO) TYPE="com.local.molstarquicklook10.gro" ;;
  *) TYPE="$(mdls -raw -name kMDItemContentType "$FILE" 2>/dev/null || true)" ;;
esac
qlmanage -p -c "$TYPE" "$FILE"
