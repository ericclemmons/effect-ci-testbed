# Isolated native rerun proof

Owned hosted fixture for #145 and #146, separate from the CI application.

The controller compares original, changed-input, unchanged, fresh, missing-output and changed-program
runs using the real native adapter and workspace snapshots. Inputs are three fixed
public Git commits. Only three bounded, Git-blob-verified files enter each VM; no
App credentials, production services, signer enrollment or HTTP dispatch exist.

After the repository's normal install, build without deploying:

```sh
cd apps/effect-ci/verification/native-rerun
../../node_modules/.bin/cf build
```

From the repository root:

```sh
node --test apps/effect-ci/verification/native-rerun/source.test.ts apps/effect-ci/verification/native-rerun/control.test.ts
VERIFY_NATIVE_RERUN_IMAGE=1 node --test apps/effect-ci/verification/native-rerun/image.test.ts
```

The source test uses real local Git objects and mocked HTTP responses. The image
test retrieves the public blobs anonymously and executes their actual program
offline as the image's unprivileged user, with a read-only root filesystem.
Neither test proves the native workflow or Cloudflare snapshot reuse.

The operator payload must be `{}`. Each native operation has a one-minute timeout
and no automatic retry; cleanup has a separate 30-second timeout. A cleanup failure
requires inspection before another run.

Deploy this fixture to your own account, then use an empty JSON object as the
operator payload. There is no public HTTP trigger. Stop fixture VMs after testing
and retain run history.

The missing-output case forks the right snapshot and removes only its copy's
`output.txt`; it does not delete the original publication or simulate a provider
outage. Every recovered output digest must match the fresh comparison.

The granular-loss case stops only the bundle's VM after its command receipt, before
workspace publication. Publication must fail closed. A new attempt may rebuild
this fixed, pure bundle while reusing the unaffected leaf snapshots; it must not
rewrite the failed attempt or pretend that a command receipt restored files.

## Verification

Native run `cf_41e4e062a0bf7f371920530ebaece292b40bf73784f99b344b987d47b85559d7`
passed all six source/output cases at `5d1e90b` on 2026-10-18: 118 successful
native steps, preserved producer/snapshot lineage, identical fresh output digests,
and zero active fixture containers afterward. The earlier CLI-parameter, RPC and
fetch-compatibility failures remain in native history.

Run `cf_c3464705c1de623db1afd6221fd99b43131dc738cc6b8c9549f8a44b3a8b562d`
at `4496c99` also completed the granular-loss/recovery case: 152 native steps,
including the expected failed publication. Attempt 4 retained that failure;
attempt 5 rebuilt only the pure bundle. Both leaf snapshots kept their original
producer and digest, every output matched the fresh comparison, and no fixture
containers remained active.

This fixed input contract is not generic dependency discovery, signing enrollment
or automatic side-effect replay. The [conventional comparison](../../../../examples/dependency-aware-reruns/.github/workflows/github.yml)
adds a real filesystem-loss case. All seven cases passed in the actual GitHub
YAML run at `72f8567`; source, step selection and output/history digests were
independently verified. It uses manual runner-local history, not a native
Cloudflare journal.
