#!/bin/sh
set -eu
command=$1
shift
case "$command" in
  build|run) exec /usr/local/libexec/docker-native "$command" --network=host "$@" ;;
  *) exec /usr/local/libexec/docker-native "$command" "$@" ;;
esac
