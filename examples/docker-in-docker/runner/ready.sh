#!/bin/sh
set -eu
if ! timeout 60 sh -c 'until /usr/local/libexec/docker-native info >/dev/null 2>&1; do sleep 0.2; done'; then
  tail -c 16384 /var/log/dockerd.log >&2
  exit 1
fi
