# Direct Containers profile: real, unmodified GitHub runner; no Docker daemon.
# Official runner SHA: https://github.com/actions/runner/releases/tag/v2.336.0
FROM ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55
ARG RUNNER_VERSION=2.336.0
ARG RUNNER_SHA256=04cf0be1aff4c3ec3554466c39124ca250e3effd8873bb7e8d68535aa9505d5d
RUN apt-get update && apt-get install --yes --no-install-recommends \
    bash ca-certificates curl git jq libicu74 libssl3t64 libkrb5-3 zlib1g liblttng-ust1t64 python3 xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1001 runner
RUN mkdir /opt/actions-runner \
    && curl --fail --location --silent --show-error \
      "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" --output /tmp/runner.tgz \
    && echo "${RUNNER_SHA256}  /tmp/runner.tgz" | sha256sum --check \
    && tar -xzf /tmp/runner.tgz -C /opt/actions-runner \
    && rm /tmp/runner.tgz && chown -R runner:runner /opt/actions-runner
COPY docker/run-runner.sh /usr/local/bin/run-runner
RUN chmod 755 /usr/local/bin/run-runner
WORKDIR /opt/actions-runner
# Root owns the outer timeout; Actions itself runs as the unprivileged user.
USER root
ENTRYPOINT ["/usr/local/bin/run-runner"]
