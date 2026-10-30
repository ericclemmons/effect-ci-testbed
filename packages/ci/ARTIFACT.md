# CI.Artifact

Use an artifact when a named build output must cross between workloads. Ordinary
dependent actions can pass a workspace directly.

## publish

`CI.Artifact.publish(workspace, { name, paths })` records the selected relative
paths and checkpoints the workspace. It returns a `WorkspaceArtifact`, not a
public download URL. The host owns storage and restoration.

[Publish a build](../../examples/portable-artifacts/.cloudflare/ci/actions.ts#symbol=build "source")

## restore

`CI.Artifact.restore(artifact)` returns a workspace restored from the artifact's
checkpoint. It can fail if the host cannot restore that revision. A local
snapshot is not automatically a portable upload to another service.

[Restore before deployment](../../examples/portable-artifacts/.cloudflare/ci/actions.ts#symbol=deploy "source")

[Between jobs](../../examples/portable-artifacts)
