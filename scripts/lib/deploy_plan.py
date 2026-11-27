"""Upload planning and live verification for deploy.py (#561). Stdlib only; tests/python/test_deploy_plan.py.

Why this exists
---------------
* **Size is not content.** deploy.py used to leave out any non-HTML file whose size equalled the
  remote copy, so a same-size change to `sw.js`, a shader, a worklet, a `.wasm` or `.htaccess`
  never shipped. Only Vite's content-hashed `assets/<name>-<hash>.<ext>` files are safe to skip by
  name + size (a changed file has a new name). Everything else is always uploaded.
* **The server may skip equal-sized files too** (its extract path is not in this repo), so after an
  upload the live bytes of every unhashed file are compared with `dist/`, and the live
  `version.json` must carry the SHA that was built.
* **A deployed build must say which commit it is** (`dist/version.json`, written by
  vite-plugins/buildVersion.ts); a dirty tree is refused.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Callable, Iterable, Mapping, Optional

# Vite names emitted chunks `assets/<name>-<8 base64url chars>.<ext>` (vite.config.ts assetFileNames).
HASHED_ASSET_RE = re.compile(r"^assets/.+-[A-Za-z0-9_-]{8}\.[A-Za-z0-9.]+$")

VERSION_FILE = "version.json"
PROFILE_BY_SITE = {"test": "test", "go": "public"}

# Files in dist/ that are uploaded but cannot be (or need not be) fetched back over HTTP.
NOT_VERIFIABLE_LIVE = {".htaccess", ".deploy-inventory.json"}


def is_content_hashed(rel: str) -> bool:
    return bool(HASHED_ASSET_RE.match(rel.replace("\\", "/")))


def is_html(rel: str) -> bool:
    return rel.lower().endswith((".html", ".htm"))


def may_skip_upload(rel: str, local_size: int, remote_size: Optional[int]) -> bool:
    """True only for a content-hashed asset whose remote copy has the same size."""
    return is_content_hashed(rel) and remote_size is not None and remote_size == local_size


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_version(build_path: Path) -> Optional[dict]:
    path = build_path / VERSION_FILE
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def check_version_for_deploy(version: Optional[dict], site: str, *, allow_dirty: bool = False) -> list[str]:
    """Reasons this dist/ must not be deployed to `site` (empty = fine)."""
    if version is None:
        return [f"dist/{VERSION_FILE} is missing or unreadable — rebuild with `npm run build:xm-player` (or build:go)"]
    errors: list[str] = []
    sha = version.get("sha")
    if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{40}", sha):
        errors.append(f"{VERSION_FILE} has no full commit SHA (got {sha!r}); build from a git checkout")
    if version.get("dirty") is not False and not allow_dirty:
        errors.append(
            "the build was made from a dirty working tree (uncommitted changes); commit them, rebuild, "
            "or pass --allow-dirty for a throwaway deploy"
        )
    expected = PROFILE_BY_SITE.get(site)
    if version.get("profile") != expected:
        errors.append(
            f"dist/ is a '{version.get('profile')}' build but --site {site} needs '{expected}'; rebuild for this site"
        )
    return errors


def live_mismatches(
    build_path: Path,
    files: Iterable[str],
    fetch: Callable[[str], Optional[bytes]],
) -> list[str]:
    """Relative paths whose live bytes differ from dist/ (or cannot be fetched).

    `fetch(rel)` returns the live bytes for a dist-relative path, or None when it cannot be read.
    HTML is excluded by the caller (it carries a deploy stamp); dot-files are never fetched.
    """
    bad: list[str] = []
    for rel in files:
        if rel in NOT_VERIFIABLE_LIVE or rel.split("/")[-1].startswith("."):
            continue
        live = fetch(rel)
        if live is None:
            bad.append(f"{rel} (not readable on the live site)")
        elif sha256_bytes(live) != sha256_file(build_path / rel):
            bad.append(f"{rel} (live content differs from dist/)")
    return bad


def live_version_problems(local: Mapping[str, object], live: Optional[Mapping[str, object]]) -> list[str]:
    if live is None:
        return [f"live {VERSION_FILE} is missing or not JSON"]
    problems = []
    if live.get("sha") != local.get("sha"):
        problems.append(f"live {VERSION_FILE} sha {live.get('sha')!r} != built sha {local.get('sha')!r}")
    if live.get("profile") != local.get("profile"):
        problems.append(f"live profile {live.get('profile')!r} != built profile {local.get('profile')!r}")
    return problems
