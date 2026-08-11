#!/bin/sh
set -eu

: "${FFMPEG_METRICS_FILE:?FFMPEG_METRICS_FILE is required}"
: "${FFMPEG_DIAGNOSTIC_FILE:?FFMPEG_DIAGNOSTIC_FILE is required}"

set +e
/usr/bin/time \
  -f '{"wallSeconds":%e,"userSeconds":%U,"systemSeconds":%S,"maxRssKb":%M}' \
  -o "$FFMPEG_METRICS_FILE" \
  /usr/bin/ffmpeg "$@" 2> "$FFMPEG_DIAGNOSTIC_FILE"
status=$?
printf 'exitCode=%s\n' "$status" >> "$FFMPEG_DIAGNOSTIC_FILE"
exit "$status"
