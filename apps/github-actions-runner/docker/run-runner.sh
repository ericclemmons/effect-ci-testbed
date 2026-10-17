#!/bin/bash
set -euo pipefail
# Runner's native environment-input parser consumes and removes this variable.
# Never enable shell tracing, print the value, or inject the App key into Linux.
: "${ACTIONS_RUNNER_INPUT_JITCONFIG:?JIT configuration required}"
: "${RUNNER_LIFETIME_SECONDS:?Runner lifetime required}"
if [[ ! "$RUNNER_LIFETIME_SECONDS" =~ ^[0-9]+$ ]] || (( RUNNER_LIFETIME_SECONDS < 1 || RUNNER_LIFETIME_SECONDS > 1800 )); then
  echo 'Invalid runner lifetime' >&2
  exit 1
fi
cd /opt/actions-runner
# Separate from the DO alarm: GitHub/network failures cannot indefinitely keep
# the runner process alive. Job code cannot signal this root-owned supervisor.
exec timeout --signal=TERM --kill-after=10 "$RUNNER_LIFETIME_SECONDS" runuser -u runner -- ./run.sh
