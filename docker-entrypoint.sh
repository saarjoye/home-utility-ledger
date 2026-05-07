#!/bin/sh
set -eu

if [ "$#" -eq 0 ]; then
  set -- node "$APP_ENTRY"
fi

if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data
  chown -R node:node /app/data
  exec su-exec node "$@"
fi

exec "$@"
