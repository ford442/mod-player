"""Unit tests for scripts/lib/coi_headers.py (stdlib only, no network). Run via tests/coiHeadersPython.test.ts."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts" / "lib"))

from coi_headers import FAIL, OK, WARN, check_coi_headers, worst_status  # noqa: E402


class CheckCoiHeadersTest(unittest.TestCase):
    def test_require_corp_is_ok(self):
        result = check_coi_headers(
            {"Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp"}
        )
        self.assertEqual(result.status, OK)

    def test_credentialless_is_warn(self):
        result = check_coi_headers(
            {"Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "credentialless"}
        )
        self.assertEqual(result.status, WARN)
        self.assertIn("Safari", " ".join(result.messages))

    def test_missing_coep_fails(self):
        result = check_coi_headers({"Cross-Origin-Opener-Policy": "same-origin"})
        self.assertEqual(result.status, FAIL)

    def test_wrong_coop_fails(self):
        result = check_coi_headers(
            {"Cross-Origin-Opener-Policy": "unsafe-none", "Cross-Origin-Embedder-Policy": "require-corp"}
        )
        self.assertEqual(result.status, FAIL)

    def test_missing_coop_fails(self):
        result = check_coi_headers({"Cross-Origin-Embedder-Policy": "require-corp"})
        self.assertEqual(result.status, FAIL)

    def test_header_names_are_case_insensitive(self):
        result = check_coi_headers(
            {"cross-origin-opener-policy": "same-origin", "CROSS-ORIGIN-EMBEDDER-POLICY": "Require-Corp"}
        )
        self.assertEqual(result.status, OK)

    def test_duplicated_coep_fails(self):
        result = check_coi_headers(
            {
                "Cross-Origin-Opener-Policy": "same-origin",
                "Cross-Origin-Embedder-Policy": "credentialless, require-corp",
            }
        )
        self.assertEqual(result.status, FAIL)

    def test_worst_status(self):
        ok = check_coi_headers(
            {"Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp"}
        )
        warn = check_coi_headers(
            {"Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "credentialless"}
        )
        self.assertEqual(worst_status([ok, warn]), WARN)
        self.assertEqual(worst_status([ok]), OK)


if __name__ == "__main__":
    unittest.main()
