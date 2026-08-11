#!/bin/sh
set -eu

: "${FFMPEG_METRICS_FILE:?FFMPEG_METRICS_FILE is required}"

exec /usr/bin/time \
  -f '{"wallSeconds":%e,"userSeconds":%U,"systemSeconds":%S,"maxRssKb":%M}' \
  -o "$FFMPEG_METRICS_FILE" \
  /usr/bin/ffmpeg "$@"
