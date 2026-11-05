FROM docker:29-dind

COPY --from=node:24-alpine /usr/local/bin/node /usr/local/bin/node
COPY --from=node:24-alpine /usr/lib/libstdc++.so.6* /usr/lib/
COPY --from=node:24-alpine /usr/lib/libgcc_s.so.1 /usr/lib/

COPY --from=docker.io/cloudflare/sandbox:1.0.0 \
  /usr/local/bin/sandbox-shim \
  /usr/local/bin/sandbox-shim

RUN mkdir -p /workspace /usr/local/libexec \
  && mv /usr/local/bin/docker /usr/local/libexec/docker-native

COPY --chmod=755 runner/docker.sh /usr/local/bin/docker
COPY --chmod=755 runner/start.sh /usr/local/bin/start-docker
COPY --chmod=755 runner/ready.sh /usr/local/bin/docker-ready

ENTRYPOINT ["/usr/local/bin/start-docker"]
