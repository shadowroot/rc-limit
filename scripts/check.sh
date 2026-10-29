#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_binary=$(mktemp /tmp/rc-limit-tests.XXXXXX)
trap 'rm -f "$test_binary"' EXIT
g++ -std=c++11 -Wall -Wextra -Werror -fsanitize=undefined,address tests/test_limiter.cpp -o "$test_binary"
# LeakSanitizer cannot run under ptrace in some Codex hosts; this core has no heap allocation.
ASAN_OPTIONS=detect_leaks=0 "$test_binary"
node tests/protocol.test.mjs
node --check web/app.mjs
node --check web/updater.mjs
node tests/firmware.test.mjs
node tests/stable.test.mjs
node tests/hardware-ble.test.mjs
node --check web/ble.mjs
node --check web/boards.mjs
node --check electron/main.cjs
node --check electron/preload.cjs
bash -n scripts/deploy-common.sh scripts/setup-firmware.sh scripts/deploy.sh scripts/setup-pio.sh scripts/deploy-pio.sh scripts/check-idf.sh
python3 -m unittest discover -s tests -p 'test_*.py' -v
