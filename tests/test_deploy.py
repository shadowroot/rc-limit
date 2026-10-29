"""Exercise deployment routing without touching hardware or installing tools."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="rc deploy ")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.log = self.base / "calls.jsonl"
        self.tool = self.base / "mock-tool"
        self.tool.write_text("""#!/usr/bin/env python3
import json, os, pathlib, sys
with open(os.environ['RC_TEST_LOG'], 'a') as file:
    file.write(json.dumps(sys.argv[1:])+'\\n')
if ('compile' in sys.argv or 'run' in sys.argv) and os.environ.get('RC_TEST_FAIL_COMPILE'):
    sys.exit(7)
if 'get-state' in sys.argv:
    print('device')
""")
        self.tool.chmod(0o755)
        self.config = self.base / "Arduino configuration.yaml"
        self.config.write_text("{}")
        self.env = {**os.environ, "RC_LIMIT_ARDUINO_CLI": str(self.tool),
                    "RC_LIMIT_ARDUINO_CONFIG": str(self.config), "RC_LIMIT_ADB": str(self.tool),
                    "RC_LIMIT_PIO": str(self.tool), "RC_TEST_LOG": str(self.log)}

    def run_script(self, *args, script="deploy.sh", **env):
        return subprocess.run(["bash", str(ROOT / "scripts" / script), *args],
                              cwd=self.base, env={**self.env, **env}, text=True, capture_output=True)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def test_requires_explicit_board_or_phone(self):
        for target in ["pico", "esp32", "esp32c3", "esp32c3-devkit", "android"]:
            result = self.run_script(target)
            self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.calls(), [])

    def test_c3_targets_keep_native_usb_and_uart_board_options_distinct(self):
        for target, fqbn in [("esp32c3", "esp32:esp32:esp32c3:CDCOnBoot=cdc"),
                             ("esp32c3-devkit", "esp32:esp32:esp32c3:CDCOnBoot=default")]:
            self.log.unlink(missing_ok=True)
            result = self.run_script(target, "--arduino", "--port", "/dev/test-c3")
            self.assertEqual(result.returncode, 0, result.stderr)
            compile_call, upload_call = self.calls()
            self.assertIn(fqbn, compile_call)
            self.assertIn(fqbn, upload_call)

    def test_flash_builds_then_uploads_to_exact_port(self):
        result = self.run_script("esp32", "--arduino", "--port", "/dev/serial/by-id/board with spaces")
        self.assertEqual(result.returncode, 0, result.stderr)
        compile_call, upload_call = self.calls()
        self.assertIn("compile", compile_call)
        self.assertIn("esp32:esp32:esp32", compile_call)
        self.assertIn("upload", upload_call)
        self.assertEqual(upload_call[upload_call.index("--port") + 1], "/dev/serial/by-id/board with spaces")
        self.assertIn(str(self.config), upload_call)
        self.assertIn("--input-dir", upload_call)

    def test_failed_compile_never_uploads(self):
        result = self.run_script("pico", "--port", "/dev/test", RC_TEST_FAIL_COMPILE="1")
        self.assertEqual(result.returncode, 7)
        self.assertEqual(len(self.calls()), 1)
        self.assertNotIn("upload", self.calls()[0])

    def test_native_failed_build_never_uploads(self):
        result = self.run_script("esp32c3", "--port", "/dev/test", RC_TEST_FAIL_COMPILE="1")
        self.assertEqual(result.returncode, 7, result.stderr)
        self.assertEqual(self.calls(), [["run", "--environment", "esp32c3"]])

    def test_native_and_pico_platformio_target_routing(self):
        for target in ["pico", "esp32", "esp32c3", "esp32c3-devkit"]:
            result = self.run_script("pio", target, "--build-only", "--dry-run")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("--environment " + target, result.stdout)
            self.assertNotIn("--target upload", result.stdout)
        self.assertEqual(self.calls(), [])

    def test_dry_run_never_invokes_tools(self):
        for args in [("pico", "--port", "/dev/test"), ("android", "--serial", "phone", "--launch"),
                     ("web", "--port", "8090"), ("pio", "pico", "--build-only"), ("esp32c3", "--port", "/dev/test"), ("desktop", "--package")]:
            result = self.run_script(*args, "--dry-run")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("Dry run", result.stdout)
        self.assertEqual(self.calls(), [])

    def test_invalid_mount_and_conflicting_options_fail_before_build(self):
        for args in [("pico", "--mount", str(self.base)), ("esp32", "--mount", str(self.base)),
                     ("pico", "--build-only", "--port", "test"), ("web", "--port", "65536"),
                     ("web", "--port", "0"), ("android", "--build-only", "--launch")]:
            self.assertNotEqual(self.run_script(*args).returncode, 0)
        self.assertEqual(self.calls(), [])

    def test_android_installs_exact_apk_on_selected_phone(self):
        apk = self.base / "my app.apk"
        apk.write_bytes(b"mock")
        result = self.run_script("android", "--serial", "PHONE123", "--apk", str(apk), "--launch")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls(), [["-s", "PHONE123", "get-state"],
                                       ["-s", "PHONE123", "install", "-r", str(apk)],
                                       ["-s", "PHONE123", "shell", "am", "start", "-n", "dev.rclimit/.MainActivity"]])

    def test_setup_uses_pinned_versions_and_isolated_config(self):
        result = self.run_script("pico", script="setup-firmware.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls(), [["--config-file", str(self.config), "core", "update-index"],
                                       ["--config-file", str(self.config), "core", "install", "rp2040:rp2040@4.4.3"],
                                       ["--config-file", str(self.config), "lib", "install", "ArduinoJson@7.4.2"]])
        self.assertEqual(self.config.read_text(), "{}")

    def test_setup_creates_valid_config_at_a_path_with_spaces(self):
        config = self.base / "new configuration" / "arduino.yaml"
        result = self.run_script("esp32", script="setup-firmware.sh", RC_LIMIT_ARDUINO_CONFIG=str(config))
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(config.read_text())
        self.assertEqual(data["directories"]["data"], str(ROOT / ".tools/arduino/data"))
        self.assertEqual(len(data["board_manager"]["additional_urls"]), 2)
        self.assertIn("esp32:esp32@2.0.17", self.calls()[1])


if __name__ == "__main__":
    unittest.main()
