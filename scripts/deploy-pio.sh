#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/deploy-common.sh"
set -- "${RC_ARGS[@]}"
usage() {
  printf 'Usage: scripts/deploy-pio.sh TARGET --build-only|--port PORT|--mount PICO_VOLUME [--dry-run]\nTargets: pico, esp32, esp32c3 (native USB), esp32c3-devkit (USB UART).\nDisconnect motor power before flashing. No device is selected automatically.\n'
}
[[ $# -gt 0 ]] || { usage;exit 0; }
target=$1;shift
case "$target" in --help|-h) usage;exit 0;;pico|esp32|esp32c3|esp32c3-devkit) ;; *) rc_die "Unknown PlatformIO target: $target";;esac
port=;mount=;build_only=0
while [[ $# -gt 0 ]];do
  case "$1" in
    --port|--mount)
      [[ $# -ge 2 && -n "$2" ]] || rc_die "Missing value for $1."
      if [[ "$1" == --port ]];then port=$2;else mount=$2;fi
      shift 2;;
    --build-only) build_only=1;shift;;
    *) rc_die "Unknown PlatformIO option: $1";;
  esac
done
if [[ "$build_only" == 1 ]];then
  [[ -z "$port" && -z "$mount" ]] || rc_die '--build-only cannot be combined with --port or --mount.'
else
  [[ -n "$port" || -n "$mount" ]] || rc_die 'Select --port or a Pico --mount explicitly.'
  [[ -z "$port" || -z "$mount" ]] || rc_die 'Choose either --port or --mount.'
fi
[[ "$target" == pico || -z "$mount" ]] || rc_die '--mount is supported only for Pico.'
if [[ -n "$mount" && "$RC_DRY_RUN" == 0 ]];then
  [[ -d "$mount" && -w "$mount" && -f "$mount/INFO_UF2.TXT" ]] || rc_die 'Select a writable Pico BOOTSEL volume.'
  tr -d '\r' < "$mount/INFO_UF2.TXT" | grep -qx 'Board-ID: RPI-RP2' || rc_die 'BOOTSEL volume must identify an RP2040.'
fi
cd "$RC_ROOT";rc_pio_binary
rc_pio run --environment "$target"
output="$RC_ROOT/build/pio/$target"
rc_run mkdir -p "$output"
if [[ "$target" == pico ]];then files=(firmware.uf2);else files=(firmware.bin bootloader.bin partitions.bin);fi
for file in "${files[@]}";do
  [[ "$RC_DRY_RUN" == 1 || -f "$RC_ROOT/.pio/build/$target/$file" ]] || rc_die "Expected PlatformIO artifact missing: $file"
  rc_run cp "$RC_ROOT/.pio/build/$target/$file" "$output/$file"
done
if [[ "$build_only" == 1 ]];then printf 'Build output: %s\n' "$output"
elif [[ -n "$mount" ]];then
  rc_run cp "$output/firmware.uf2" "$mount/rc_limiter.uf2"
  printf 'Pico UF2 copied. Confirm saved settings before restoring motor power.\n'
else
  rc_pio run --environment "$target" --target upload --upload-port "$port"
  printf 'PlatformIO upload finished. Confirm saved settings before restoring motor power.\n'
fi
