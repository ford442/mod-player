"""Unit tests for scripts/lib/deploy_plan.py (stdlib only, no network). Run via tests/build/coiHeadersPython.test.ts."""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts" / "lib"))

from deploy_plan import (  # noqa: E402
    check_version_for_deploy,
    is_content_hashed,
    is_text_file,
    live_mismatches,
    live_version_problems,
    may_skip_upload,
    pad_for_server,
    same_content,
)

SHA = "a" * 40


class UploadPlanTest(unittest.TestCase):
    def test_vite_hashed_assets_are_recognised(self):
        self.assertTrue(is_content_hashed("assets/index-ChYbJfUY.js"))
        self.assertTrue(is_content_hashed("assets/openmpt-parser.worker-BUJDBBfM.js"))
        self.assertTrue(is_content_hashed("assets/index-WJjQ4uIG.css"))

    def test_unhashed_files_are_never_hashed_assets(self):
        for rel in (
            "sw.js", "version.json", ".htaccess", "_headers", "manifest.json",
            "worklets/libopenmpt-worklet.wasm", "worklets/openmpt-worklet.js",
            "shaders/patternv0.55.wgsl", "icon-512.png", "ir/hall.opus",
        ):
            self.assertFalse(is_content_hashed(rel), rel)

    def test_same_size_content_change_is_uploaded(self):
        # The #561 bug: sw.js 'mod-player-v8' -> 'v9' has the same size and used to be skipped.
        self.assertFalse(may_skip_upload("sw.js", 1234, 1234))
        self.assertFalse(may_skip_upload("worklets/libopenmpt-worklet.wasm", 99, 99))
        self.assertFalse(may_skip_upload("shaders/patternv0.55.wgsl", 10, 10))
        self.assertFalse(may_skip_upload(".htaccess", 10, 10))

    def test_only_equal_sized_hashed_assets_are_skipped(self):
        self.assertTrue(may_skip_upload("assets/index-ChYbJfUY.js", 5, 5))
        self.assertFalse(may_skip_upload("assets/index-ChYbJfUY.js", 5, 6))
        self.assertFalse(may_skip_upload("assets/index-ChYbJfUY.js", 5, None))


class SameSizeDecisionTest(unittest.TestCase):
    """The server skips equal-sized files (proven live in #561: sw.js v8 -> v9 never arrived)."""

    def test_text_types(self):
        for rel in ("sw.js", "version.json", "shaders/patternv0.55.wgsl", ".htaccess", "_headers", "assets/x-AbCdEfGh.css"):
            self.assertTrue(is_text_file(rel), rel)
        for rel in ("worklets/libopenmpt-worklet.wasm", "icon-512.png", "ir/hall.opus", "clouds.mp4", "4-mat_madness.mod"):
            self.assertFalse(is_text_file(rel), rel)

    def test_padding_changes_the_size_so_the_server_does_not_skip(self):
        local = b"const CACHE_NAME = 'mod-player-v9';\n"
        self.assertNotEqual(len(pad_for_server(local)), len(local))

    def test_padding_does_not_count_as_a_difference_for_text_only(self):
        self.assertTrue(same_content("sw.js", b"abc", b"abc\n"))
        self.assertTrue(same_content("sw.js", pad_for_server(b"abc"), b"abc"))
        self.assertFalse(same_content("a.wasm", b"abc", b"abc\n"))
        self.assertFalse(same_content("sw.js", b"abc", b"abd"))


class VersionGateTest(unittest.TestCase):
    good = {"sha": SHA, "dirty": False, "profile": "test"}

    def test_clean_matching_build_passes(self):
        self.assertEqual(check_version_for_deploy(dict(self.good), "test"), [])
        self.assertEqual(check_version_for_deploy({**self.good, "profile": "public"}, "go"), [])

    def test_missing_version_file_refuses(self):
        self.assertTrue(check_version_for_deploy(None, "test"))

    def test_dirty_tree_refuses_unless_allowed(self):
        dirty = {**self.good, "dirty": True}
        self.assertTrue(check_version_for_deploy(dirty, "test"))
        self.assertEqual(check_version_for_deploy(dirty, "test", allow_dirty=True), [])

    def test_unknown_sha_refuses_even_when_dirty_is_allowed(self):
        self.assertTrue(check_version_for_deploy({**self.good, "sha": "unknown"}, "test", allow_dirty=True))

    def test_wrong_profile_for_site_refuses(self):
        self.assertTrue(check_version_for_deploy(dict(self.good), "go"))
        self.assertTrue(check_version_for_deploy({**self.good, "profile": "public"}, "test"))


class LiveVerifyTest(unittest.TestCase):
    def test_same_size_different_content_is_caught(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "sw.js").write_bytes(b"CACHE_NAME='mod-player-v9'")
            (root / ".htaccess").write_bytes(b"x")
            live = {"sw.js": b"CACHE_NAME='mod-player-v8'"}  # same length
            self.assertEqual(len(live["sw.js"]), len((root / "sw.js").read_bytes()))
            bad = live_mismatches(root, ["sw.js", ".htaccess"], live.get)
            self.assertEqual(len(bad), 1)
            self.assertIn("sw.js", bad[0])

    def test_identical_and_unreadable(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "a.wasm").write_bytes(b"\0asm")
            (root / "b.js").write_bytes(b"b")
            bad = live_mismatches(root, ["a.wasm", "b.js"], {"a.wasm": b"\0asm"}.get)
            self.assertEqual(len(bad), 1)
            self.assertIn("b.js", bad[0])

    def test_live_version_must_match_sha_and_profile(self):
        local = {"sha": SHA, "profile": "test"}
        self.assertEqual(live_version_problems(local, {"sha": SHA, "profile": "test"}), [])
        self.assertTrue(live_version_problems(local, {"sha": "b" * 40, "profile": "test"}))
        self.assertTrue(live_version_problems(local, {"sha": SHA, "profile": "public"}))
        self.assertTrue(live_version_problems(local, None))


if __name__ == "__main__":
    unittest.main()
