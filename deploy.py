#!/usr/bin/env python3
"""
deploy.py — mod-player (pre-rewrite / xm-player)

Deployment now goes through storage.noahcohn.com (Contabo VPS).
No SFTP passwords are stored in this repo.

Usage:
  1. Build the project:  VITE_APP_BASE_PATH=/xm-player/ npm run build
  2. python deploy.py

This script contacts https://storage.noahcohn.com to upload the dist/ folder
as a single zip archive. The server extracts it and pushes files over a
persistent SFTP connection on the VPS side.

Requirements:
  pip install requests
"""

import io
import os
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

# Set via environment: export DEPLOY_TOKEN="your_long_token_from_vps_env"
DEPLOY_TOKEN: Optional[str] = os.getenv(
    "DEPLOY_TOKEN",
    "6de44dca5425348f2e2ef9456fc820bfe56a5ace68bddeb6da4a1c2a9d9cadc0",
)
# ============================================================


def build_zip(build_path: Path) -> bytes:
    """Zip the contents of build_path into an in-memory archive."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for file in sorted(build_path.rglob("*")):
            if file.is_dir():
                continue
            rel = file.relative_to(build_path)
            parts = rel.parts
            if any(p in (".git", "node_modules", "__pycache__") for p in parts):
                continue
            zf.write(file, str(rel))
            print(f"  + {rel}")
    return buf.getvalue()


def deploy_bundle(build_path: Path) -> bool:
    """Zip the build and upload it as a single bundle."""
    target_folder = DEPLOY_FOLDER or PROJECT_NAME
    url = f"{CONTABO_BASE_URL}/api/deploy/{PROJECT_NAME}/bundle"
    headers = {}
    if DEPLOY_TOKEN:
        headers["X-Deploy-Token"] = DEPLOY_TOKEN

    print("Building zip archive...")
    zip_bytes = build_zip(build_path)
    print(f"Archive size: {len(zip_bytes) / 1024:.1f} KB\n")

    print("Uploading bundle...")
    try:
        response = requests.post(
            url,
            files={"bundle": ("build.zip", zip_bytes, "application/zip")},
            data={"target_folder": target_folder},
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


def validate_build_base_path(build_path: Path) -> None:
    """Warn when dist was built without the /xm-player/ base path (breaks CSS/JS on deploy)."""
    index_html = build_path / "index.html"
    if not index_html.is_file():
        return
    html = index_html.read_text(encoding="utf-8")
    expected_prefix = f"/{PROJECT_NAME}/"
    if expected_prefix not in html and 'src="/assets/' in html:
        print(
            f"ERROR: {index_html} was built with base '/' but deploy target is '{expected_prefix}'.\n"
            f"       CSS and layout will break on test.1ink.us/xm-player/.\n"
            f"       Rebuild with:  npm run build:xm-player"
        )
        sys.exit(1)


def main():
    print(f"\n=== Deploying '{PROJECT_NAME}' via Contabo -> test.1ink.us/xm-player ===\n")

    build_path = Path(BUILD_DIR)
    if not build_path.exists() or not build_path.is_dir():
        print(f"ERROR: Build directory '{BUILD_DIR}/' does not exist.")
        print("Run:  npm run build:xm-player")
        sys.exit(1)

    validate_build_base_path(build_path)

    try:
        health = requests.get(f"{CONTABO_BASE_URL}/api/deploy/health", timeout=10)
        if health.status_code == 200:
            print(f"Contabo deploy service: {health.json().get('status', 'unknown')}")
    except Exception:
        print("Warning: Could not contact storage.noahcohn.com (continuing anyway).")

    print()
    success = deploy_bundle(build_path)

    print(f"\n=== {'Deployment complete' if success else 'Deployment finished with errors'} ===")
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
