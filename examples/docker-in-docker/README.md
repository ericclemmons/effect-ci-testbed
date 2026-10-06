# Build and run a user Dockerfile

> How do I build and run a project-owned Dockerfile inside Cloudflare CI?

```mermaid
flowchart LR
  step_checkout["checkout"]
  step_build_user_image["build user image"]
  step_run_user_image["run user image"]
  step_checkout --> step_build_user_image
  step_build_user_image --> step_run_user_image
```

---

The outer runner image uses `docker:dind` and Cloudflare Sandbox 1.0's
`sandbox-shim`. Its runner entrypoint starts Docker with iptables and IP forwarding
disabled, as required by Cloudflare Containers.

The portable actions contain ordinary Docker commands:

```sh
docker build --network=host --tag effect-ci-user-image app
docker run --network=host --rm effect-ci-user-image
```

This is different from [`../custom-runner-image`](../custom-runner-image): that example
customizes the outer CI environment, while this one treats `app/Dockerfile` as project
input and creates an inner image during CI.

Run `pnpm dev` with Docker available, then trigger the local Workflow with:

```sh
pnpm trigger -- '{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"main"}' --local
```
