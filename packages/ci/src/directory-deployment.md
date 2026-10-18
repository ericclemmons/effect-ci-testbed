# Directory deployment

Publish a local workspace into a versioned directory. Compare against the last
successful publication, not the latest build or source revision.

```ts
import { directoryDeployment } from "@effect-ci-testbed/ci/directory-deployment"

const destination = directoryDeployment({
  directory: "/var/lib/my-site",
  paths: ["dist/**"],
  configuration: "static-site-v1",
})

export const local = { workspaceChanges: destination.changes }

// Inside a workflow/action:
const workspace = yield* build()
if (yield* workspace.changed("dist/**")) {
  yield* destination.publish(workspace)
}
```

For direct `CI.run`, pass `workspaceChanges: destination.changes` in its options.
The CLI reads the exported `local` configuration. `configuration` is a non-secret
identity for relevant serving/runtime policy; change it when that policy changes.

The comparison includes sorted paths, bytes, executable bits, configured scope and
configuration. It excludes commit hashes, timestamps and workspace revision IDs.
The query must match the complete configured scope. Unsupported scopes, remote
workspaces, missing/corrupt state and provider failures mean unknown: run the work.
Cancellation still cancels. Planning performs no comparison or publication IO.

Publication copies files into a new version, verifies their bytes, then atomically
replaces `current.json`. Failed staging keeps the previous deployment current.
`destination.read(path)` reads a selected file from that verified current version.
Versions are retained; this adapter does not prune history.

This is a Node/local adapter, not Cloudflare deployment, signed evidence, a
cross-host artifact store or automatic external-side-effect retry. Use a dedicated
destination directory outside the selected outputs. Files must be regular files,
without symlinks. Limits: 1,000 files, 16 MiB total and 10,000 traversed entries.
An exclusive `publication.lock` prevents overlapping publication. A process crash
may leave it behind; inspect the publication before removing a stale lock.
