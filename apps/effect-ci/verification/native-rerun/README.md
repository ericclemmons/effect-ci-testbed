# Isolated native rerun proof

Local preparation for #145. **Not deployed or native-verified.**

The controller compares original, changed-input, unchanged, fresh and changed-program
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
node --test apps/effect-ci/verification/native-rerun/source.test.ts
VERIFY_NATIVE_RERUN_IMAGE=1 node --test apps/effect-ci/verification/native-rerun/image.test.ts
```

The source test uses real local Git objects and mocked HTTP responses. The image
test retrieves the public blobs anonymously and executes their actual program
offline as the image's unprivileged user, with a read-only root filesystem.
Neither test proves the native workflow or Cloudflare snapshot reuse.

Live testing requires the separately requested isolated-target approval. Preserve
run history, stop fixture VMs afterward, and never touch the production host.
Missing-output and deliberate filesystem-loss scenarios remain to be implemented;
this is not generic dependency discovery, attestation, or completed #146 evidence.
