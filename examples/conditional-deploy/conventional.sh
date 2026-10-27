#!/bin/sh
set -eu

if [ "${1:-pull_request}" = push ]; then
  lane=release
else
  lane=preview
fi

echo "$lane:prepare"
if (echo "$lane:advisory"; exit 1); then
  :
else
  echo "$lane:advisory warning" >&2
fi
echo "$lane:publish"
if [ "${2:-refs/heads/main}" = refs/heads/required-failure ]; then
  echo "$lane:undo publish"
  echo "$lane:undo prepare"
  exit 1
fi
echo "$lane:verify"
echo 'branch:report'
