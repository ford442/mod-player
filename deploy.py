#!/usr/bin/env python3
"""
deploy.py — mod-player (pre-rewrite / xm-player)

Deployment now goes through storage.noahcohn.com (Contabo VPS).
No SFTP passwords are stored in this repo.

Usage:
  python deploy.py              # build (xm-player profile) + validate + upload
  python deploy.py --no-build   # upload existing dist/ only (must already be xm-player build)

This script contacts https://storage.noahcohn.com to upload the dist/ folder
as a single zip archive. The server extracts it and pushes files over a
persistent SFTP connection on the VPS side.

Set DEPLOY_CLEAN=1 to request remote asset pruning before extract (when supported).
See docs/DEPLOY.md for COEP headers, CDN CORP requirements, and manual prune steps.

Requirements:
  pip install requests
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path
from typing import Optional

import requests

# ============================================================
# PER-PROJECT CONFIGURATION
# ============================================================
PROJECT_NAME: str = "xm-player"
BUILD_DIR: str = "dist"
CONTABO_BASE_URL: str = "https://storage.noahcohn.com"

# Deploy under this remote folder (empty = use PROJECT_NAME = "xm-player").
# Matches the original SFTP target: test.1ink.us/xm-player
DEPLOY_FOLDER: str = ""

# target_site for storage.noahcohn.com: "test" → test.1ink.us, "go" → go.1ink.us
# Override with --site or DEPLOY_TARGET=go
DEPLOY_TARGET: str = os.getenv("DEPLOY_TARGET", "test").strip().lower() or "test"

# Set via environment: export DEPLOY_TOKEN="your_long_token_from_vps_env"
DEPLOY_TOKEN: Optional[str] = os.getenv(
    "DEPLOY_TOKEN",
    "6de44dca5425348f2e2ef9456fc820bfe56a5ace68bddeb6da4a1c2a9d9cadc0",
)
# ============================================================


def live_host_for_target(target: str) -> str:
    """Map deploy target_site to the public hostname used for post-deploy checks."""
    return "go.1ink.us" if target == "go" else "test.1ink.us"

STYLESHEET_RE = re.compile(
    r'<link[^>]+rel=["\']stylesheet["\'][^>]*href=["\']([^"\']+)["\']',
    re.IGNORECASE,
)
MODULE_SCRIPT_RE = re.compile(
    r'<script[^>]+type=["\']module["\'][^>]*src=["\']([^"\']+)["\']',
    re.IGNORECASE,
)
PRELOAD_RE = re.compile(
    r'<link[^>]+rel=["\'](?:modulepreload|preload)["\'][^>]*href=["\']([^"\']+)["\']',
    re.IGNORECASE,
)
MIN_CSS_BYTES = 10_000


def resolve_asset_href(href: str) -> str:
    """Map index.html href to a path relative to dist/.

    Handles all common forms Vite (or post-processing) may emit when
    VITE_APP_BASE_PATH=/xm-player/ is active:
      /xm-player/assets/...
      xm-player/assets/...
      ./xm-player/assets/...
      ./assets/...
      /assets/...
      assets/...
    """
    path = href.strip()
    # Strip leading ./ or / first
    if path.startswith("./"):
        path = path[2:]
    elif path.startswith("/"):
        path = path[1:]
    # Strip the project base prefix if present (handles "xm-player/..." variants)
    pfx = f"{PROJECT_NAME}/"
    if path.startswith(pfx):
        path = path[len(pfx) :]
    # Final safety strip of any remaining leading slash
    if path.startswith("/"):
        path = path[1:]
    return path


def collect_index_referenced_paths(build_path: Path) -> list[str]:
    """Paths under dist/ referenced directly from index.html."""
    index_html = build_path / "index.html"
    if not index_html.is_file():
        return []
    html = index_html.read_text(encoding="utf-8")
    hrefs: list[str] = []
    hrefs.extend(STYLESHEET_RE.findall(html))
    hrefs.extend(MODULE_SCRIPT_RE.findall(html))
    hrefs.extend(PRELOAD_RE.findall(html))
    return [resolve_asset_href(h) for h in hrefs]


def collect_asset_prune_manifest(build_path: Path, inventory: list[str]) -> dict[str, object]:
    """Files under assets/ that must exist after deploy; used for remote prune."""
    index_refs = set(collect_index_referenced_paths(build_path))
    assets_in_inventory = sorted(f for f in inventory if f.startswith("assets/"))
    # Include assets referenced from JS bundles (e.g. parser worker chunks).
    assets_dir = build_path / "assets"
    referenced_from_bundles: set[str] = set()
    if assets_dir.is_dir():
        asset_names = {f.name for f in assets_dir.iterdir() if f.is_file()}
        for bundle in assets_dir.glob("*.js"):
            try:
                text = bundle.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            for name in asset_names:
                if name in text:
                    referenced_from_bundles.add(f"assets/{name}")
    keep = sorted(set(assets_in_inventory) | index_refs | referenced_from_bundles)
    keep = [p for p in keep if p.startswith("assets/")]
    return {
        "assetsDir": "assets",
        "keep": keep,
        "referencedByIndexHtml": sorted(index_refs),
    }


def validate_build_base_path(build_path: Path) -> None:
    """Warn when dist was built without the /xm-player/ base path (breaks CSS/JS on deploy)."""
    index_html = build_path / "index.html"
    if not index_html.is_file():
        return
    html = index_html.read_text(encoding="utf-8")
    expected_prefix = f"/{PROJECT_NAME}/"
    # Detect root-base builds: either classic /assets/ or the result of
    # post-build naive replaces that leave bare "assets/" in bundle refs.
    looks_like_root_base = (
        'src="/assets/' in html
        or 'href="/assets/' in html
        or re.search(r'(?:src|href)=["\'](?:\./)?assets/[^"\']+\.(?:js|css)', html)
    )
    if expected_prefix not in html and looks_like_root_base:
        print(
            f"ERROR: {index_html} was built with base '/' but deploy target is '{expected_prefix}'.\n"
            f"       CSS and layout will break on test.1ink.us/xm-player/.\n"
            f"       Rebuild with:  npm run build:xm-player  (or: npm run deploy)"
        )
        sys.exit(1)


def validate_stylesheet_assets(build_path: Path) -> None:
    """Reject builds with non-.css stylesheet links or missing CSS chunks."""
    index_html = build_path / "index.html"
    if not index_html.is_file():
        print(f"ERROR: missing {index_html}")
        sys.exit(1)

    html = index_html.read_text(encoding="utf-8")
    if b"\x00" in index_html.read_bytes()[:128]:
        print("ERROR: dist/index.html appears to be UTF-16 (NUL bytes in header)")
        sys.exit(1)
    hrefs = STYLESHEET_RE.findall(html)
    if not hrefs:
        print("ERROR: dist/index.html has no <link rel=\"stylesheet\">")
        sys.exit(1)

    errors: list[str] = []
    for href in hrefs:
        if not href.endswith(".css"):
            errors.append(f"stylesheet must end with .css (got {href})")
            continue
        if ".1iss" in href:
            errors.append(f"stale/corrupt stylesheet name: {href}")
            continue
        rel = resolve_asset_href(href)
        css_path = build_path / rel
        if not css_path.is_file():
            errors.append(f"stylesheet file missing: {rel}")
            continue
        size = css_path.stat().st_size
        if size < MIN_CSS_BYTES:
            errors.append(f"stylesheet {rel} too small ({size} bytes)")
        head = css_path.read_bytes()[:64]
        if b"\x00" in head:
            errors.append(f"stylesheet {rel} contains NUL bytes (likely UTF-16)")

    assets_dir = build_path / "assets"
    if assets_dir.is_dir():
        stale = [f.name for f in assets_dir.iterdir() if f.suffix == ".1iss"]
        if stale:
            errors.append(f"stale .1iss files in dist/assets: {', '.join(stale)}")

    for href in MODULE_SCRIPT_RE.findall(html):
        rel = resolve_asset_href(href)
        if not (build_path / rel).is_file():
            errors.append(f"module script missing: {rel}")

    if errors:
        print("ERROR: Build validation failed:")
        for err in errors:
            print(f"  - {err}")
        print("\nRebuild with:  npm run build:xm-player:verify")
        sys.exit(1)

    print(f"  ✓ stylesheet OK ({', '.join(hrefs)})")


def build_inventory(build_path: Path) -> dict[str, object]:
    """Manifest of every file in dist/ plus asset prune hints for the server."""
    files: list[str] = []
    for file in sorted(build_path.rglob("*")):
        if file.is_file():
            files.append(str(file.relative_to(build_path)).replace("\\", "/"))
    prune = collect_asset_prune_manifest(build_path, files)
    return {
        "project": PROJECT_NAME,
        "files": files,
        "pruneAssets": prune,
    }



def fetch_remote_sizes(target_folder, target_site="test"):
    """Ask the VPS for {rel_path: bytes} already on the deploy target."""
    base = CONTABO_BASE_URL.rstrip("/")
    url = f"{base}/api/deploy/{PROJECT_NAME}/sizes"
    headers = {}
    token = globals().get("DEPLOY_TOKEN")
    if token:
        headers["X-Deploy-Token"] = token
    params = {"target_site": target_site or "test"}
    if target_folder:
        params["target_folder"] = target_folder
    try:
        response = requests.get(url, params=params, headers=headers, timeout=60)
        if response.status_code == 200:
            files = response.json().get("files") or {}
            print(f"Remote size map: {len(files)} file(s)")
            return {str(k).replace("\\", "/"): int(v) for k, v in files.items()}
        print(f"  ! sizes HTTP {response.status_code}; uploading all files")
    except Exception as exc:
        print(f"  ! Could not fetch remote sizes ({exc}); uploading all files")
    return {}


def build_zip(build_path: Path, skip_sizes=None) -> bytes:
    """Zip the contents of build_path into an in-memory archive."""
    manifest = build_inventory(build_path)
    inventory = manifest["files"]
    assert isinstance(inventory, list)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for file in sorted(build_path.rglob("*")):
            if file.is_dir():
                continue
            rel = file.relative_to(build_path)
            parts = rel.parts
            if any(p in (".git", "node_modules", "__pycache__") for p in parts):
                continue
            rel_s = str(rel).replace("\\", "/")
            local_size = file.stat().st_size
            if (skip_sizes or {}).get(rel_s) == local_size:
                print(f"  = {rel} ({local_size} bytes, unchanged)")
                continue
            zf.write(file, rel_s)
            print(f"  + {rel}")
        zf.writestr(
            ".deploy-inventory.json",
            json.dumps(manifest, indent=2),
        )
        prune = manifest.get("pruneAssets", {})
        if isinstance(prune, dict):
            keep = prune.get("keep", [])
            if isinstance(keep, list):
                print(f"  + .deploy-inventory.json ({len(inventory)} files, keep {len(keep)} assets)")
        else:
            print("  + .deploy-inventory.json (manifest for remote prune)")
    return buf.getvalue()


def deploy_bundle(build_path: Path, *, clean: bool, target_site: str) -> bool:
    """Zip the build and upload it as a single bundle."""
    target_folder = DEPLOY_FOLDER or PROJECT_NAME
    url = f"{CONTABO_BASE_URL}/api/deploy/{PROJECT_NAME}/bundle"
    headers = {}
    if DEPLOY_TOKEN:
        headers["X-Deploy-Token"] = DEPLOY_TOKEN

    print("Building zip archive...")
    target_folder_for_sizes = globals().get("DEPLOY_FOLDER") or globals().get("TARGET_FOLDER") or PROJECT_NAME
    if "target_folder" in locals() and target_folder:
        target_folder_for_sizes = target_folder
    target_site_for_sizes = target_site or globals().get("DEPLOY_TARGET", "test")
    print("Checking remote file sizes...")
    skip_sizes = fetch_remote_sizes(target_folder_for_sizes, target_site_for_sizes)
    zip_bytes = build_zip(build_path, skip_sizes)
    print(f"Archive size: {len(zip_bytes) / 1024:.1f} KB\n")

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as _zf:
        if not _zf.namelist():
            print("All files identical in size on the target; nothing to upload.")
            return True

    data: dict[str, str] = {
        "target_folder": target_folder,
        "target_site": target_site,
    }
    if clean:
        data["clean"] = "1"
        data["prune_assets"] = "1"
        print("Requesting remote asset prune before extract (clean=1)\n")

    host = live_host_for_target(target_site)
    print(f"Uploading bundle (target_site={target_site} → {host}/{target_folder})...")
    try:
        response = requests.post(
            url,
            files={"bundle": ("build.zip", zip_bytes, "application/zip")},
            data=data,
            headers=headers,
            timeout=300,
        )
    except Exception as exc:
        print(f"  ✗ Upload exception: {exc}")
        return False

    if response.status_code == 200:
        data = response.json()
        print(f"  ✓ {data.get('uploaded', 0)} files uploaded")
        if data.get("failed"):
            print("  Failures:")
            for f in data["failed"]:
                print(f"    ✗ {f['path']}: {f['error']}")
        return not data.get("failed")
    else:
        print(f"  ✗ {response.status_code}: {response.text[:400]}")
        return False


def run_build() -> None:
    print("Running npm run build:xm-player ...")
    result = subprocess.run(
        ["npm", "run", "build:xm-player"],
        cwd=Path(__file__).resolve().parent,
        check=False,
    )
    if result.returncode != 0:
        print("ERROR: npm run build:xm-player failed")
        sys.exit(1)
    result = subprocess.run(
        ["npm", "run", "verify:build"],
        cwd=Path(__file__).resolve().parent,
        check=False,
    )
    if result.returncode != 0:
        sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Deploy dist/ to test.1ink.us/xm-player or go.1ink.us/xm-player"
    )
    parser.add_argument(
        "--no-build",
        action="store_true",
        help="Skip npm run build:xm-player:verify (upload existing dist/ only)",
    )
    parser.add_argument(
        "--site",
        choices=("test", "go"),
        default=None,
        help="Deploy target site: test (test.1ink.us) or go (go.1ink.us). "
        "Default from DEPLOY_TARGET env or 'test'.",
    )
    prune_group = parser.add_mutually_exclusive_group()
    prune_group.add_argument(
        "--prune",
        action="store_true",
        help="Request remote asset prune before extract (default when DEPLOY_CLEAN=1)",
    )
    prune_group.add_argument(
        "--no-prune",
        action="store_true",
        help="Skip remote asset prune (upload only)",
    )
    args = parser.parse_args()

    target_site = (args.site or DEPLOY_TARGET).strip().lower()
    if target_site not in ("test", "go"):
        print(f"ERROR: invalid target site '{target_site}' (use test or go)")
        sys.exit(1)
    host = live_host_for_target(target_site)

    print(f"\n=== Deploying '{PROJECT_NAME}' via Contabo -> {host}/xm-player ===\n")

    if not args.no_build:
        run_build()

    build_path = Path(BUILD_DIR)
    if not build_path.exists() or not build_path.is_dir():
        print(f"ERROR: Build directory '{BUILD_DIR}/' does not exist.")
        print("Run:  npm run build:xm-player:verify")
        sys.exit(1)

    validate_build_base_path(build_path)
    print("Validating stylesheet assets...")
    validate_stylesheet_assets(build_path)

    manifest = build_inventory(build_path)
    prune_info = manifest.get("pruneAssets", {})
    if isinstance(prune_info, dict):
        keep = prune_info.get("keep", [])
        if isinstance(keep, list) and keep:
            print(f"Asset prune manifest: keep {len(keep)} file(s) under assets/")
            for path in keep:
                print(f"    · {path}")

    try:
        health = requests.get(f"{CONTABO_BASE_URL}/api/deploy/health", timeout=10)
        if health.status_code == 200:
            print(f"Contabo deploy service: {health.json().get('status', 'unknown')}")
    except Exception:
        print("Warning: Could not contact storage.noahcohn.com (continuing anyway).")

    if args.no_prune:
        clean = False
    elif args.prune:
        clean = True
    else:
        clean = os.getenv("DEPLOY_CLEAN", "1") != "0"
    print()
    success = deploy_bundle(build_path, clean=clean, target_site=target_site)

    if success:
        if clean:
            print(
                "\nRemote prune requested. Stale assets (e.g. modplayer.1iss, old index-*.js) "
                "should be removed server-side. See docs/DEPLOY.md for manual cleanup."
            )
        else:
            print(
                "\nDeployed without prune. Old assets under /xm-player/assets/ may remain."
            )

    print(f"\n=== {'Deployment complete' if success else 'Deployment finished with errors'} ===")
    if success:
        verify_live_directory_index(build_path, target_site=target_site)
    sys.exit(0 if success else 1)


def verify_live_directory_index(build_path: Path, *, target_site: str = "test") -> None:
    """Warn when the live directory URL serves a different bundle than index.html."""
    index_html = build_path / "index.html"
    if not index_html.is_file():
        return
    expected_scripts = MODULE_SCRIPT_RE.findall(index_html.read_text(encoding="utf-8"))
    if not expected_scripts:
        return
    expected = expected_scripts[0]
    host = live_host_for_target(target_site)
    live_url = f"https://{host}/xm-player/"
    try:
        resp = requests.get(live_url, timeout=15, headers={"User-Agent": "mod-player-deploy-verify"})
        if resp.status_code != 200:
            print(f"\n⚠ Live check: {live_url} returned HTTP {resp.status_code}")
            return
        charset = resp.headers.get("content-type", "")
        if "utf-16" in charset.lower():
            print(
                "\n⚠ LIVE MISMATCH: /xm-player/ is served as UTF-16 (stale directory index). "
                "Browsers load the OLD bundle and XM/MOD audio breaks.\n"
                "  Fix: redeploy with DEPLOY_CLEAN=1, ensure .htaccess DirectoryIndex is active,\n"
                "  or delete the stale UTF-16 index on the VPS. /xm-player/index.html should match:"
            )
        body = resp.text
        if expected not in body:
            found = re.search(r"index-[A-Za-z0-9_-]+\.js", body)
            found_name = found.group(0) if found else "(none)"
            expected_name = re.search(r"index-[A-Za-z0-9_-]+\.js", expected)
            print(
                f"\n⚠ LIVE MISMATCH: /xm-player/ references {found_name} "
                f"but dist/index.html has {expected_name.group(0) if expected_name else expected}.\n"
                f"  Users visiting {host}/xm-player/ get the OLD app until the server index is replaced."
            )
        else:
            print(f"\n✓ Live directory index references current bundle ({expected})")
    except Exception as exc:
        print(f"\n⚠ Live directory index check skipped: {exc}")


if __name__ == "__main__":
    main()
