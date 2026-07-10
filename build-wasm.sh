#!/usr/bin/env bash
# =======================================================================
# build-wasm.sh  –  DEPRECATED entrypoint (kept for muscle memory)
#
# ⚠️  Historical bug: this script used to write
#     public/worklets/openmpt-worklet.{js,wasm,aw.js}
#     which OVERWROTE the tracked JS AudioWorklet processor
#     (public/worklets/openmpt-worklet.js) and even `rm -rf public/worklets`.
#
# It now only delegates to the single supported path:
#     scripts/build-wasm.sh  →  public/worklets/openmpt-native.*
#
# Prefer:
#     npm run build:emcc
#     # or
#     bash scripts/build-wasm.sh [--debug] [--safe-heap]
# =======================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CANONICAL="$SCRIPT_DIR/scripts/build-wasm.sh"

if [[ ! -f "$CANONICAL" ]]; then
  echo "❌ Canonical build script missing: $CANONICAL" >&2
  exit 1
fi

echo "⚠️  build-wasm.sh is a deprecated alias."
echo "   Forwarding to scripts/build-wasm.sh (outputs openmpt-native.* only)."
echo "   The tracked JS worklet public/worklets/openmpt-worklet.js is never overwritten."
echo ""

exec bash "$CANONICAL" "$@"
