// Container-only entrypoint. Project modules execute here, never in the host
// Worker. This installs no approval, signing, deployment or host-env capability.
await import("./effect-ci.ts")
