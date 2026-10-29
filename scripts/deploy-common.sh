#!/usr/bin/env bash
# Shared by the deployment entry points; sourcing this file performs no installation.
set -euo pipefail
RC_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
RC_DRY_RUN=0
RC_ARGS=()
for rc_arg in "$@"; do
  if [[ "$rc_arg" == --dry-run ]]; then RC_DRY_RUN=1; else RC_ARGS+=("$rc_arg"); fi
done
if [[ "$RC_DRY_RUN" == 1 ]]; then printf 'Dry run: commands are printed only; nothing will be deployed.\n'; fi
RC_CLI=${RC_LIMIT_ARDUINO_CLI:-arduino-cli}
RC_CONFIG=${RC_LIMIT_ARDUINO_CONFIG:-$RC_ROOT/.tools/arduino/arduino-cli.yaml}
rc_die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
rc_need() {
  if [[ "$RC_DRY_RUN" == 0 ]]; then
    command -v "$1" >/dev/null 2>&1 || rc_die "Missing executable: $1. See docs/deploy.md for prerequisites."
  fi
}
rc_run() {
  printf '+ '; printf '%q ' "$@"; printf '\n'
  if [[ "$RC_DRY_RUN" == 0 ]]; then "$@"; fi
}
rc_arduino() { rc_run "$RC_CLI" --config-file "$RC_CONFIG" "$@"; }
rc_firmware_ready() {
  rc_need "$RC_CLI"
  [[ "$RC_DRY_RUN" == 1 || -f "$RC_CONFIG" ]] || rc_die "Run scripts/setup-firmware.sh first (Arduino configuration missing: $RC_CONFIG)."
}
