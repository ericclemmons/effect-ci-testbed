FROM docker:dind-rootless

USER root

RUN apk add --no-cache bash ca-certificates git

COPY --from=docker.io/cloudflare/sandbox:1.0.0 \
  /usr/local/bin/sandbox-shim \
  /usr/local/bin/sandbox-shim

RUN mkdir -p /workspace

CMD ["sleep", "infinity"]
