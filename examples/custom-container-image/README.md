# Build a custom container image

> How do I build a project-owned container image in the same CI program as my other work?

```mermaid
flowchart LR
  step_checkout["checkout"]
  step_build_container_image["build container image"]
  step_publish_container_image["publish container image"]
  step_checkout --> step_build_container_image
  step_build_container_image --> step_publish_container_image
```

---

The image is intentionally tiny and uses `FROM scratch`, so the example tests the
Docker build boundary without downloading a base image:

```text
checkout → build container image → publish container image
```

`publishImage()` yields `buildImage()`, inspects the resulting local image, and prints a
harmless stand-in for the registry push. Authentication and registry selection belong
to the runner layer or its secret services; the action graph only expresses that a
publish consumes a successfully built image.

This is also the escape hatch for CI that handles both Cloudflare products and work
Cloudflare does not build, such as a Kubernetes workload's custom image.

Compare the conventional [GitHub Actions workflow](./.github/workflows/github.yml) with
the portable [actions](./.cloudflare/ci/actions.ts) and
[workflow](./.cloudflare/ci/workflow.ts).
