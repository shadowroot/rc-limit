#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
json_dir=${RC_CJSON_DIR:-${IDF_PATH:-$PWD/.tools/platformio/packages/framework-espidf}/components/json/cJSON}
[[ -f "$json_dir/cJSON.c" ]] || { printf 'ESP-IDF cJSON source missing; run scripts/setup-pio.sh esp32c3 first.\n' >&2;exit 1; }
work=$(mktemp -d /tmp/rc-idf-codec.XXXXXX)
trap 'rm -rf "$work"' EXIT
cc -c -fsanitize=address,undefined -I "$json_dir" "$json_dir/cJSON.c" -o "$work/cJSON.o"
g++ -std=c++17 -Wall -Wextra -Werror -fsanitize=address,undefined -I "$json_dir" -I firmware/espidf/main -I firmware/rc_limiter tests/test_idf_codec.cpp firmware/espidf/main/model_json.cpp "$work/cJSON.o" -o "$work/codec"
ASAN_OPTIONS=detect_leaks=0 "$work/codec"
printf 'Native ESP-IDF profile codec tests passed.\n'
