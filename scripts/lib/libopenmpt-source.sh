# shellcheck shell=bash
# ──────────────────────────────────────────────────────────────────────
# scripts/lib/libopenmpt-source.sh – which libopenmpt the JS engine builds, pinned by hash (#491, #515)
#
# Sourced by scripts/build-js-libopenmpt.sh. Bumping libopenmpt is: change LIBOPENMPT_VERSION,
# add its tarball's sha256 below, rebuild both pairs (`npm run build:js-libopenmpt` and
# `npm run build:js-libopenmpt -- --playback`) and commit them.
#
# This app parses untrusted uploads with it, so track the 0.8.x patch releases — their
# changelogs (https://lib.openmpt.org/libopenmpt/) regularly carry loader security fixes.
# ──────────────────────────────────────────────────────────────────────

LIBOPENMPT_VERSION="0.8.9"

# sha256 of https://lib.openmpt.org/files/libopenmpt/src/libopenmpt-<ver>+release.makefile.tar.gz
# Upstream publishes no digest file; each entry was computed from a fresh download.
# 0.8.4 matches the vendored tree CI's byte-reproducible JS build used up to #515.
libopenmpt_tarball_sha256() {
    case "$1" in
        0.8.4) echo "9f610ac26b2656f8edef85ffdac95b6495037108ec6d937fe913c5fe4751c44e" ;;
        0.8.9) echo "9273b88b67973cc69e54d748ab1b749399d6d07695f1c37d0c59f88b4106074f" ;;
        *) echo "" ;;
    esac
}

# shellcheck disable=SC2034  # consumed by the sourcing script
LIBOPENMPT_NAME="libopenmpt-${LIBOPENMPT_VERSION}+release"
LIBOPENMPT_TARBALL="${LIBOPENMPT_NAME}.makefile.tar.gz"

# libopenmpt_download_verified <archive-path>
# Downloads the pinned tarball and refuses it unless its sha256 matches the table.
libopenmpt_download_verified() {
    local archive="$1" want got
    want="$(libopenmpt_tarball_sha256 "$LIBOPENMPT_VERSION")"
    if [[ -z "$want" ]]; then
        echo "❌ libopenmpt $LIBOPENMPT_VERSION has no sha256 in scripts/lib/libopenmpt-source.sh" >&2
        exit 1
    fi
    echo "📥 Downloading libopenmpt ${LIBOPENMPT_VERSION}…" >&2
    if ! wget -q "https://lib.openmpt.org/files/libopenmpt/src/${LIBOPENMPT_TARBALL}" -O "$archive"; then
        echo "❌ Failed to download ${LIBOPENMPT_TARBALL}" >&2
        rm -f "$archive"
        exit 1
    fi
    got="$(sha256sum "$archive" | cut -d' ' -f1)"
    if [[ "$got" != "$want" ]]; then
        echo "❌ ${LIBOPENMPT_TARBALL}: sha256 $got, expected $want — refusing to build from it" >&2
        rm -f "$archive"
        exit 1
    fi
}

# libopenmpt_ensure_pristine <vendor-root>
# Makes sure <vendor-root>/$LIBOPENMPT_NAME holds the verified, unbuilt sources (downloads
# and extracts them if missing) and prints that path. Build trees are copies of it.
libopenmpt_ensure_pristine() {
    local vendor_root="$1" tree archive tmp
    tree="$vendor_root/$LIBOPENMPT_NAME"
    if [[ -f "$tree/Makefile" && -f "$tree/libopenmpt/libopenmpt.h" ]]; then
        echo "$tree"
        return 0
    fi
    mkdir -p "$vendor_root"
    archive="$vendor_root/$LIBOPENMPT_TARBALL"
    libopenmpt_download_verified "$archive"
    tmp="$(mktemp -d "$vendor_root/.extract.XXXXXX")"
    if ! tar xzf "$archive" -C "$tmp" || [[ ! -d "$tmp/$LIBOPENMPT_NAME" ]]; then
        echo "❌ Failed to extract ${LIBOPENMPT_TARBALL} (expected $LIBOPENMPT_NAME/)" >&2
        rm -rf "$tmp" "$archive"
        exit 1
    fi
    rm -rf "$tree"
    mv "$tmp/$LIBOPENMPT_NAME" "$tree"
    rmdir "$tmp"
    rm -f "$archive"
    echo "$tree"
}

# libopenmpt_copy_sources <from> <to>
# A build tree that always compiles from scratch: no objects, archives or dependency files.
libopenmpt_copy_sources() {
    local from="$1" to="$2"
    mkdir -p "$to"
    tar -C "$from" --exclude='./bin' --exclude='*.o' --exclude='*.d' --exclude='*.a' -cf - . | tar -C "$to" -xf -
    mkdir -p "$to/bin"
}
