FROM docker.io/library/node:24-trixie-slim

RUN apt-get update \
  && apt-get install --yes --no-install-recommends git python3 python3-pip \
  && python3 -m pip install --break-system-packages --no-cache-dir build==1.3.0 hatchling==1.27.0 \
  && rm -rf /var/lib/apt/lists/*
