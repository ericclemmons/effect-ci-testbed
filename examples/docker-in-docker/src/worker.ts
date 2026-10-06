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
      "dockerd-entrypoint.sh dockerd --iptables=false --ip6tables=false --ip-forward=false >/var/log/dockerd.log 2>&1 & until docker info >/dev/null 2>&1; do sleep 0.2; done; exec sleep infinity",
    ],
    image: "workspace",
  },
  root: "examples/docker-in-docker",
})
