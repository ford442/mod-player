#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# scripts/ci/setup-emsdk.sh <install-dir> – the pinned emsdk for CI (and anyone reproducing it)
#
# Clones emsdk at WASM_EMSDK_SCRIPTS_COMMIT, installs + activates WASM_EMSDK_PIN (both in
# scripts/lib/wasm-flags.sh), and, on GitHub Actions, exports EMSDK_ENV so
# scripts/build-js-libopenmpt.sh activates it. Idempotent: an existing checkout at the pinned
# commit (e.g. restored from a cache) is reused.
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/wasm-flags.sh
source "$SCRIPT_DIR/../lib/wasm-flags.sh"

DEST="${1:?usage: setup-emsdk.sh <install-dir>}"

if [[ ! -d "$DEST/.git" ]]; then
    git clone --quiet https://github.com/emscripten-core/emsdk.git "$DEST"
fi
if [[ "$(git -C "$DEST" rev-parse HEAD)" != "$WASM_EMSDK_SCRIPTS_COMMIT" ]]; then
    git -C "$DEST" fetch --quiet origin "$WASM_EMSDK_SCRIPTS_COMMIT" || git -C "$DEST" fetch --quiet origin
    git -C "$DEST" checkout --quiet --detach "$WASM_EMSDK_SCRIPTS_COMMIT"
fi

"$DEST/emsdk" install "$WASM_EMSDK_PIN"
"$DEST/emsdk" activate "$WASM_EMSDK_PIN"

if [[ -n "${GITHUB_ENV:-}" ]]; then
    echo "EMSDK_ENV=$DEST/emsdk_env.sh" >> "$GITHUB_ENV"
fi
echo "✅ emsdk $WASM_EMSDK_PIN (scripts @ ${WASM_EMSDK_SCRIPTS_COMMIT:0:12}) in $DEST"
