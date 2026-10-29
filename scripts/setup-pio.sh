#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/deploy-common.sh"
set -- "${RC_ARGS[@]}"
target=${1:-all}
if [[ "$target" == --help || "$target" == -h ]]; then
  printf 'Usage: scripts/setup-pio.sh [all|pico|esp32|esp32c3|esp32c3-devkit] [--dry-run]\nCreates an isolated PlatformIO environment and installs pinned target packages.\n';exit 0
fi
[[ $# -le 1 ]] || rc_die 'Expected at most one target.'
case "$target" in all|pico|esp32|esp32c3|esp32c3-devkit) ;; *) rc_die "Unknown target: $target";; esac
cd "$RC_ROOT"
if [[ -z "${RC_LIMIT_PIO:-}" ]]; then
  rc_need python3
  rc_run python3 -m venv "$RC_ROOT/.tools/pio-venv"
  rc_run "$RC_ROOT/.tools/pio-venv/bin/python" -m pip install -r "$RC_ROOT/scripts/requirements-pio.txt"
  RC_PIO="$RC_ROOT/.tools/pio-venv/bin/pio"
else rc_pio_binary; fi
if [[ "$target" == all ]]; then rc_pio pkg install;else rc_pio pkg install --environment "$target";fi
printf 'PlatformIO setup finished. ESP32/C3 targets use native ESP-IDF; Pico uses Arduino-Pico.\n'
