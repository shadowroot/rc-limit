#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/deploy-common.sh"
set -- "${RC_ARGS[@]}"
target=${1:-all}
if [[ "$target" == --help || "$target" == -h ]]; then
  printf 'Usage: scripts/setup-firmware.sh [pico|esp32|esp32c3|esp32c3-devkit|all] [--dry-run]\nRequires Arduino CLI and Python 3. Installs pinned cores in project-local .tools/.\n'
  exit 0
fi
[[ $# -le 1 ]] || rc_die 'Expected at most one target.'
case "$target" in pico|esp32|esp32c3|esp32c3-devkit|all) ;; *) rc_die "Unknown target: $target";; esac
cd "$RC_ROOT"
rc_need "$RC_CLI"; rc_need python3
if [[ ! -f "$RC_CONFIG" ]]; then
  if [[ "$RC_DRY_RUN" == 1 ]]; then
    printf '+ create project-local Arduino configuration: %s\n' "$RC_CONFIG"
  else
    # JSON is valid YAML; json.dump safely quotes directories containing spaces.
    python3 - "$RC_CONFIG" "$RC_ROOT/.tools/arduino" <<'PY'
import json
import pathlib
import sys
path = pathlib.Path(sys.argv[1])
base = pathlib.Path(sys.argv[2])
path.parent.mkdir(parents=True, exist_ok=True)
config = {
    "board_manager": {"additional_urls": [
        "https://espressif.github.io/arduino-esp32/package_esp32_index.json",
        "https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json",
    ]},
    "directories": {"data": str(base / "data"), "downloads": str(base / "downloads"), "user": str(base / "user")},
}
with path.open("x") as file:
    json.dump(config, file, indent=2)
    file.write("\n")
PY
  fi
fi
rc_arduino core update-index
if [[ "$target" == pico || "$target" == all ]]; then rc_arduino core install rp2040:rp2040@4.4.3; fi
if [[ "$target" == esp32 || "$target" == esp32c3 || "$target" == esp32c3-devkit || "$target" == all ]]; then rc_arduino core install esp32:esp32@2.0.17; fi
rc_arduino lib install ArduinoJson@7.4.2
printf 'Firmware toolchain setup finished. Configuration: %s\n' "$RC_CONFIG"
