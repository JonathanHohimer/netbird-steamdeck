import importlib
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch


sys.modules.setdefault(
    "decky",
    types.SimpleNamespace(
        DECKY_PLUGIN_RUNTIME_DIR="/tmp",
        DECKY_PLUGIN_SETTINGS_DIR="/tmp",
        logger=types.SimpleNamespace(info=lambda *_: None, warning=lambda *_: None),
    ),
)
main = importlib.import_module("main")


class InstallLayoutTests(unittest.TestCase):
    def test_uses_opt_when_opt_is_writable(self) -> None:
        stat = types.SimpleNamespace(f_flag=0)
        with patch.object(main.os, "statvfs", return_value=stat):
            self.assertEqual(main._select_install_root(), Path("/opt/netbird"))

    def test_uses_var_opt_when_opt_is_read_only(self) -> None:
        stat = types.SimpleNamespace(f_flag=os.ST_RDONLY)
        with patch.object(main.os, "statvfs", return_value=stat):
            self.assertEqual(main._select_install_root(), Path("/var/opt/netbird"))

    def test_maps_supported_release_architectures(self) -> None:
        for machine, expected in (
            ("x86_64", "amd64"),
            ("amd64", "amd64"),
            ("aarch64", "arm64"),
            ("arm64", "arm64"),
        ):
            with self.subTest(machine=machine):
                with patch.object(main.platform, "machine", return_value=machine):
                    self.assertEqual(main._linux_arch(), expected)

    def test_managed_binary_candidates_cover_both_roots(self) -> None:
        self.assertIn("/opt/netbird/bin/netbird", main.BINARY_CANDIDATES)
        self.assertIn("/var/opt/netbird/bin/netbird", main.BINARY_CANDIDATES)

    def test_persist_files_skip_missing_atomic_update_mechanism(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            profile = root / "etc/profile.d/netbird.sh"
            atomic = root / "etc/atomic-update.conf.d/netbird.conf"
            with (
                patch.object(main, "PROFILE_D", profile),
                patch.object(main, "ATOMIC_UPDATE", atomic),
                patch.object(main, "OPT_BIN_DIR", Path("/var/opt/netbird/bin")),
            ):
                written = main._write_steamos_persist_files()

            self.assertEqual(written, [profile])
            self.assertEqual(
                profile.read_text(encoding="utf-8"),
                "# Managed by NetBird Decky plugin\n"
                "append_path /var/opt/netbird/bin\n",
            )
            self.assertFalse(atomic.exists())

    def test_persist_files_use_existing_atomic_update_mechanism(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            profile = root / "etc/profile.d/netbird.sh"
            atomic = root / "etc/atomic-update.conf.d/netbird.conf"
            atomic.parent.mkdir(parents=True)
            with (
                patch.object(main, "PROFILE_D", profile),
                patch.object(main, "ATOMIC_UPDATE", atomic),
                patch.object(main, "OPT_BIN_DIR", Path("/opt/netbird/bin")),
            ):
                written = main._write_steamos_persist_files()

            self.assertEqual(written, [profile, atomic])
            self.assertEqual(
                atomic.read_text(encoding="utf-8"),
                "# Managed by NetBird Decky plugin — keep across SteamOS updates\n"
                "/etc/profile.d/netbird.sh\n",
            )


if __name__ == "__main__":
    unittest.main()
