import * as Cloudflare from "@effect-ci-testbed/cloudflare"

import workflow from "../.cloudflare/ci/workflow.ts"

export { WorkspaceContainer } from "@effect-ci-testbed/cloudflare"

export default {
  fetch() {
    return new Response("Effect CI Docker-in-Docker example")
  },
}

export const EffectCIWorkflow = Cloudflare.workflowEntrypoint(workflow, {
  container: {
    entrypoint: [
      "sh",
      "-c",
      "dockerd-entrypoint.sh dockerd --iptables=false --ip6tables=false --ip-forward=false >/var/log/dockerd.log 2>&1 & exec sleep infinity",
    ],
    image: "workspace",
    readyCommand: "for attempt in $(seq 1 100); do docker info >/dev/null 2>&1 && exit 0; sleep 0.2; done; cat /var/log/dockerd.log >&2; exit 1",
  },
  root: "examples/docker-in-docker",
})
