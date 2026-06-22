#!/usr/bin/env bash
set -euo pipefail

LOCAL_XYZRENDER_ENV="${HOME}/.local/share/uv/tools/xyzrender"
PYVENV_CFG="${LOCAL_XYZRENDER_ENV}/pyvenv.cfg"

if [[ -z "${CODESIGNING_FOLDER_PATH:-}" ]]; then
  echo "error: CODESIGNING_FOLDER_PATH is required." >&2
  exit 1
fi

if [[ ! -f "$PYVENV_CFG" ]]; then
  echo "warning: xyzrender uv tool is not installed; skipping Quick Look xyzrender launcher"
  exit 0
fi

PYTHON_HOME="$(sed -n 's/^home = //p' "$PYVENV_CFG" | head -n 1)"
PYTHON_EXE="$PYTHON_HOME/../bin/python3"
if [[ -z "$PYTHON_HOME" || ! -x "$PYTHON_EXE" ]]; then
  echo "error: could not resolve xyzrender Python runtime from $PYVENV_CFG" >&2
  exit 1
fi

PYTHON_ROOT="$(cd -P "$PYTHON_HOME/.." && pwd -P)"
PYTHON_EXE="$PYTHON_ROOT/bin/python3"

resolve_linked_python_library() {
  local linked_path=""
  linked_path="$(otool -L "$PYTHON_EXE" | awk '$1 ~ /libpython3.*\.dylib/ || $1 ~ /Python\.framework\/Versions\/.*\/Python/ { print $1; exit }')"
  if [[ -z "$linked_path" ]]; then
    local candidate
    for candidate in "$PYTHON_ROOT"/lib/libpython3*.dylib; do
      [[ -f "$candidate" ]] || continue
      printf '%s\n' "$candidate"
      return 0
    done
    return 1
  fi
  case "$linked_path" in
    @executable_path/*)
      local relative="${linked_path#@executable_path/}"
      local base_dir
      base_dir="$(cd -P "$(dirname "$PYTHON_EXE")/$(dirname "$relative")" && pwd -P)"
      printf '%s/%s\n' "$base_dir" "$(basename "$relative")"
      ;;
    /*)
      printf '%s\n' "$linked_path"
      ;;
    *)
      return 1
      ;;
  esac
}

PYTHON_LIBRARY="$(resolve_linked_python_library || true)"
if [[ -z "$PYTHON_LIBRARY" || ! -f "$PYTHON_LIBRARY" ]]; then
  echo "error: could not resolve xyzrender Python shared library for $PYTHON_EXE" >&2
  exit 1
fi

PYTHON_LIBRARY_NAME="$(basename "$PYTHON_LIBRARY")"
DEST_RESOURCES="$CODESIGNING_FOLDER_PATH/Contents/Resources"
DEST_LIB="$CODESIGNING_FOLDER_PATH/Contents/lib"
DEST_PYTHON="$DEST_RESOURCES/xyzrender-python3"
DEST_LIBRARY="$DEST_LIB/$PYTHON_LIBRARY_NAME"

mkdir -p "$DEST_RESOURCES" "$DEST_LIB"
rm -f "$DEST_LIB"/libpython3*.dylib "$DEST_LIB/Python"

ditto --norsrc --noextattr "$PYTHON_EXE" "$DEST_PYTHON"
ditto --norsrc --noextattr "$PYTHON_LIBRARY" "$DEST_LIBRARY"
chmod 755 "$DEST_PYTHON" "$DEST_LIBRARY"

LINKED_LIBRARY="$(otool -L "$PYTHON_EXE" | awk '$1 ~ /libpython3.*\.dylib/ || $1 ~ /Python\.framework\/Versions\/.*\/Python/ { print $1; exit }')"
if [[ -n "$LINKED_LIBRARY" && "$LINKED_LIBRARY" != "@executable_path/../lib/$PYTHON_LIBRARY_NAME" ]]; then
  install_name_tool -change "$LINKED_LIBRARY" "@executable_path/../lib/$PYTHON_LIBRARY_NAME" "$DEST_PYTHON" || true
fi

touch "$DEST_LIB/.xyzrender-python-library.stamp"

if [[ "${CODE_SIGNING_ALLOWED:-NO}" == "YES" ]]; then
  SIGN_IDENTITY="${EXPANDED_CODE_SIGN_IDENTITY:-${CODE_SIGN_IDENTITY:-}}"
  if [[ -n "$SIGN_IDENTITY" ]]; then
    /usr/bin/codesign --force --sign "$SIGN_IDENTITY" -o runtime --timestamp=none "$DEST_LIBRARY"
    /usr/bin/codesign --force --sign "$SIGN_IDENTITY" -o runtime --timestamp=none "$DEST_PYTHON"
  fi
fi
