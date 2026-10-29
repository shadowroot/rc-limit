#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/deploy-common.sh"
set -- "${RC_ARGS[@]}"
usage() {
  cat <<'HELP'
Usage (run from any directory):
  scripts/deploy.sh ports
  scripts/deploy.sh pico --port /dev/ttyACM0
  scripts/deploy.sh pico --mount /media/USER/RPI-RP2
  scripts/deploy.sh esp32 --port /dev/ttyUSB0
  scripts/deploy.sh pico|esp32 --build-only
  scripts/deploy.sh android --serial DEVICE_ID [--launch] [--apk FILE]
  scripts/deploy.sh android --build-only
  scripts/deploy.sh web [--port 8080]
  scripts/deploy.sh desktop [--install] [--package]

Add --dry-run anywhere to print commands without building, flashing or installing.
Firmware setup: scripts/setup-firmware.sh [pico|esp32|all]
Disconnect motor power before flashing. Board/device selection is always explicit.
See docs/deploy.md for prerequisites and environment overrides.
HELP
}
[[ $# -gt 0 ]] || { usage; exit 0; }
action=$1; shift
cd "$RC_ROOT"
case "$action" in
  --help|-h|help) usage ;;
  ports)
    [[ $# == 0 ]] || rc_die 'ports takes no options.'
    rc_firmware_ready; rc_arduino board list
    ;;
  pico|esp32)
    port=; mount=; build_only=0
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --port|--mount)
          [[ $# -ge 2 && -n "$2" ]] || rc_die "Missing value for $1."
          if [[ "$1" == --port ]]; then port=$2; else mount=$2; fi
          shift 2 ;;
        --build-only) build_only=1; shift ;;
        *) rc_die "Unknown firmware option: $1" ;;
      esac
    done
    if [[ "$build_only" == 1 ]]; then
      [[ -z "$port" && -z "$mount" ]] || rc_die '--build-only cannot be combined with --port or --mount.'
    else
      [[ -n "$port" || -n "$mount" ]] || rc_die 'Select --port or, for Pico BOOTSEL, --mount. No device is selected automatically.'
      [[ -z "$port" || -z "$mount" ]] || rc_die 'Choose either --port or --mount.'
    fi
    [[ "$action" == pico || -z "$mount" ]] || rc_die '--mount is supported only for Pico.'
    if [[ -n "$mount" && "$RC_DRY_RUN" == 0 ]]; then
      [[ -d "$mount" && -w "$mount" && -f "$mount/INFO_UF2.TXT" ]] || rc_die 'Mount must be a writable Pico BOOTSEL volume containing INFO_UF2.TXT.'
      tr -d '\r' < "$mount/INFO_UF2.TXT" | grep -qx 'Board-ID: RPI-RP2' || rc_die 'BOOTSEL volume does not identify an RP2040 board.'
    fi
    rc_firmware_ready
    if [[ "$action" == pico ]]; then fqbn=rp2040:rp2040:rpipico; else fqbn=esp32:esp32:esp32; fi
    output="$RC_ROOT/build/$action"
    rc_run mkdir -p "$output"
    rc_arduino compile --fqbn "$fqbn" --build-path "$RC_ROOT/build/work-$action" --output-dir "$output" "$RC_ROOT/firmware/rc_limiter"
    if [[ "$build_only" == 1 ]]; then
      printf 'Build output: %s\n' "$output"
    elif [[ -n "$mount" ]]; then
      rc_run cp "$output/rc_limiter.ino.uf2" "$mount/rc_limiter.uf2"
      printf 'UF2 copied; the Pico should reboot. Confirm saved settings before connecting motor power.\n'
    else
      rc_arduino upload --fqbn "$fqbn" --port "$port" --input-dir "$output" "$RC_ROOT/firmware/rc_limiter"
      printf 'Firmware upload finished. Confirm saved settings before connecting motor power.\n'
    fi
    ;;
  android)
    serial=; apk=; launch=0; build_only=0
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --serial|--apk)
          [[ $# -ge 2 && -n "$2" ]] || rc_die "Missing value for $1."
          if [[ "$1" == --serial ]]; then serial=$2; else apk=$2; fi
          shift 2 ;;
        --build-only) build_only=1; shift ;;
        --launch) launch=1; shift ;;
        *) rc_die "Unknown Android option: $1" ;;
      esac
    done
    if [[ "$build_only" == 1 ]]; then
      [[ -z "$serial" && -z "$apk" && "$launch" == 0 ]] || rc_die '--build-only cannot be combined with install options.'
    else
      [[ -n "$serial" ]] || rc_die 'Select --serial from adb devices. No phone is selected automatically.'
      adb=${RC_LIMIT_ADB:-adb}; rc_need "$adb"
      rc_run "$adb" -s "$serial" get-state
    fi
    if [[ -z "$apk" ]]; then
      rc_need java
      (cd "$RC_ROOT/android"; rc_run ./gradlew --no-daemon assembleDebug)
      apk="$RC_ROOT/build/android/rc-limit-debug.apk"
      rc_run mkdir -p "$RC_ROOT/build/android"
      rc_run cp "$RC_ROOT/android/app/build/outputs/apk/debug/app-debug.apk" "$apk"
    else
      [[ "$RC_DRY_RUN" == 1 || -f "$apk" ]] || rc_die "APK does not exist: $apk"
    fi
    if [[ "$build_only" == 0 ]]; then
      rc_run "$adb" -s "$serial" install -r "$apk"
      if [[ "$launch" == 1 ]]; then rc_run "$adb" -s "$serial" shell am start -n dev.rclimit/.MainActivity; fi
    fi
    printf 'Android APK: %s\n' "$apk"
    ;;
  web)
    port=8080
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --port) [[ $# -ge 2 && -n "$2" ]] || rc_die 'Missing HTTP port.'; port=$2; shift 2 ;;
        *) rc_die "Unknown web option: $1" ;;
      esac
    done
    [[ "$port" =~ ^[0-9]{1,5}$ ]] || rc_die 'HTTP port must be an integer from 1 to 65535.'
    (( 10#$port >= 1 && 10#$port <= 65535 )) || rc_die 'HTTP port must be from 1 to 65535.'
    rc_need python3
    printf 'Open http://localhost:%s in desktop Chrome/Edge. Press Ctrl+C to stop.\n' "$port"
    rc_run python3 -m http.server "$port" --bind 127.0.0.1 --directory "$RC_ROOT/web"
    ;;
  desktop)
    install=0; package=0
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --install) install=1; shift ;;
        --package) package=1; shift ;;
        *) rc_die "Unknown desktop option: $1" ;;
      esac
    done
    npm=${RC_LIMIT_NPM:-npm}; rc_need "$npm"; rc_need node
    if [[ "$install" == 1 || "$package" == 1 || ! -f node_modules/electron/package.json ]]; then rc_run "$npm" ci; fi
    if [[ "$package" == 1 ]]; then
      rc_run "$npm" run package
      printf 'Desktop package output: %s/build/desktop/\n' "$RC_ROOT"
    else
      rc_run env -u ELECTRON_RUN_AS_NODE "$npm" start
    fi
    ;;
  *) rc_die "Unknown deployment target: $action. Run scripts/deploy.sh --help." ;;
esac
