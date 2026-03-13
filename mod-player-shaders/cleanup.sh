#!/bin/bash
# Cleanup script for mod-player repository
# Removes stale development artifacts and build outputs from git tracking

set -e

echo "=== Repository Hygiene Cleanup ==="
echo ""

# Files to remove from git tracking (stale development artifacts)
STALE_FILES=(
    "verify_changes.py"
    "verify_ui.py"
    "error_ui.png"
    "verification_ui.png"
    "test.ts"
    "git.sh"
)

echo "Removing stale development artifacts from git tracking..."
for file in "${STALE_FILES[@]}"; do
    if git ls-files | grep -q "^${file}$"; then
        echo "  - Removing ${file}"
        git rm -f "${file}" 2>/dev/null || true
    else
        echo "  - ${file} (not tracked)"
    fi
done

echo ""
echo "Removing dist/ directory from git tracking..."
if git ls-files | grep -q "^dist/"; then
    git rm -r --cached dist/ 2>/dev/null || true
    echo "  - dist/ removed from tracking"
else
    echo "  - dist/ (not tracked)"
fi

echo ""
echo "=== Summary ==="
echo "Stale files removed from git tracking."
echo "dist/ directory removed from git tracking."
echo ""
echo "To complete the cleanup, run:"
echo "  git commit -m \"chore: clean up stale files and add MIT license\""
echo ""
echo "NOTE: The files above are still in your working directory."
echo "      They will be ignored by git per .gitignore rules."
