# Does changed output mean a deployment is needed?

Throwaway prototype, not a `Workspace.changed` implementation. Run from the repo:

```sh
pnpm prototype:outputs
```

Or run the scripted cases without a prompt:

```sh
node examples/conditional-deploy/verification/output-changes.prototype.ts --demo --json
```

The Node build is real. A shared module feeds an app whose own source stays
unchanged. The existing demo asset-manifest function hashes the actual output.
“Deploy” copies files into a temporary local target and reads their bytes back;
it does not call Cloudflare. Success baselines live only in memory and disappear
on exit. All generated files are removed on normal exit.

What to explore:

- Edit the shared package, then build: app source is unchanged, output changes.
- Fail deployment, then rebuild: identical output still needs deployment.
- Deploy successfully, then rebuild: a new build number alone changes nothing.
- Deploy production: staging still needs its own successful deployment.
- Edit serving config: identical assets can still require deployment.

## Decision to carry forward

Source selection and deployable-output comparison are separate. Content identity
must not include a build number, commit SHA, or snapshot UUID just to force a
difference. The successful baseline must be scoped to the destination and advance
only after that destination confirms the candidate—not after build, cache restore,
preview upload, or failed deployment. Unknown baseline means work is still needed.

Next: absorb this into a real workspace/provider integration, then remove this
shell. The implicit destination for a targetless `workspace.changed(patterns)`
still needs a concrete host context; one workspace can feed multiple environments.
No public API, hosted comparison, persistent journal, or safe external retry is
proven by this local prototype.
