#!/bin/sh
set -eu
rm -f /var/run/docker.pid /var/run/docker.sock
dockerd --host=unix:///var/run/docker.sock --iptables=false --ip6tables=false --ip-forward=false --storage-driver=vfs >/var/log/dockerd.log 2>&1 &
daemon=$!
trap 'kill "$daemon" 2>/dev/null || true; wait "$daemon" || true' TERM INT EXIT
wait "$daemon"
