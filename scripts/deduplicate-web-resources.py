#!/usr/bin/env python3
"""Hard-link identical static web resources in a staged app before signing.

Paths and bytes stay unchanged. ditto/DMG preserve links; ZIP consumers may
expand them back to independent files, which affects size but not behavior.
"""
import argparse
import hashlib
import os
from pathlib import Path
import stat


def deduplicate(app):
    app = app.resolve(strict=True)
    roots = [app / relative for relative in (
        "Contents/Resources/ViewerWeb",
        "Contents/Resources/plugins/burette-agent/preview-web",
        "Contents/Resources/plugins/burette-agent/browser-shell-dist",
        "Contents/PlugIns/BurettePreview.appex/Contents/Resources/Web",
    )]
    groups = {}
    for root in roots:
        if not root.is_dir() or root.is_symlink() or not root.resolve().is_relative_to(app):
            raise ValueError(f"Missing or external web resource root: {root}")
        for path in sorted(root.rglob("*")):
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_size < 128 * 1024:
                continue
            # Never consolidate native code or files with executable modes.
            if path.suffix not in (".js", ".css", ".wasm", ".json") or info.st_mode & 0o111:
                continue
            key = (info.st_size, stat.S_IMODE(info.st_mode), info.st_uid, info.st_gid)
            groups.setdefault(key, []).append(path)

    replacements = []
    for paths in groups.values():
        if len(paths) < 2:
            continue
        canonical = {}
        for path in paths:
            content = path.read_bytes()
            digest = hashlib.sha256(content).digest()
            source = canonical.setdefault(digest, path)
            if source == path or source.samefile(path):
                continue
            if source.read_bytes() != content:
                raise ValueError("Resource hash collision")
            replacements.append((source, path))

    saved = 0
    for source, path in replacements:
        # Link first, then atomically replace: failures never leave a missing
        # resource. All mutations are inside the packager's disposable tree.
        temporary = path.with_name(path.name + ".dedup-link")
        os.link(source, temporary)
        try:
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
        saved += source.stat().st_size
    print(f"Shared {len(replacements)} web resources ({saved / 1024**2:.1f} MiB of duplicate content)")
    return len(replacements), saved


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", type=Path)
    deduplicate(parser.parse_args().app)
