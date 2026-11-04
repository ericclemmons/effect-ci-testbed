# Walkthrough

- [ ] Build a React app and Worker API.
- [ ] Inspect, cache, and run the build on Cloudflare.
- [ ] Write `ci.ts`; skip Markdown-only changes and unchanged output.
- [ ] Deploy with OIDC; notify Slack and gate publication.

## 1. Make the CLI available

Prerequisites: Git, Node 24.11+ or 26+, pnpm, Vite+, `gh`, `cf`,
`cloudflared`, and `beautiful-mermaid`.

1. Install the unpublished CLI in a separate directory:

   ```sh
   git clone https://github.com/ericclemmons/effect-ci-testbed.git
   cd effect-ci-testbed
   pnpm install
   export PATH="$PWD/node_modules/.bin:$PATH"
   gh auth login
   ```

2. Keep this shell open. Return to your projects directory.

## 2. Create the app

1. Run:

   ```sh
   vp create cloudflare
   ```

2. Choose **walkthrough → Framework Starter → React → TypeScript → pnpm**.
   Enable Git. Skip deployment.

3. Start the app:

   ```sh
   cd walkthrough
   vp dev
   ```

4. Open the printed URL. Click **Name from API**.

   - [ ] The API returns `{ "name": "Cloudflare" }`.

5. Stop the server with Ctrl-C. Commit the starter if needed, then migrate its
   Wrangler configuration for `cf`:

   ```sh
   git add .
   git commit -m "feat: Create the app"
   cf migrate
   pnpm add -D @cloudflare/vite-plugin@beta
   ```

6. Ignore generated output and local publication state:

   [`.gitignore`](./tutorial/ignore.diff "source")

   - [ ] `cloudflare.config.ts` keeps `entrypoint: "worker/index.ts"` and SPA assets.
   - [ ] `cf migrate` installs the local `cf` dependency used by that config.

## 3. Inspect before running

1. Discover the existing scripts:

   ```sh
   effect-ci list
   effect-ci plan build
   effect-ci plan build --format=mermaid | beautiful-mermaid ascii
   ```

   ```text
   checkout → install → build
   ```

2. Preview the agent interface:

   ```sh
   AI_AGENT=demo effect-ci list
   AI_AGENT=demo effect-ci plan build
   ```

   - [ ] Human: text. Agent: JSON. Same commands.
   - [ ] No build has run.

## 4. Run the build

1. Run:

   ```sh
   effect-ci run build
   ```

   - [ ] TypeScript passes; the React app and Worker bundle.
   - [ ] Local execution, before OIDC enrollment.

## 5. Cache the build

1. Apply these changes:

   [`package.json`](./tutorial/package.diff "source")

   [`vite.config.ts`](./tutorial/cache.diff "source")

2. Run twice to prove unchanged inputs reuse the build:

   ```console frame="terminal"
   $ effect-ci run build
   …

   $ effect-ci run build
   $ tsc -b ◉ cache hit, replaying
   $ vp build ◉ cache hit, replaying
   …
   ```

3. Change the API response:

   [`worker/index.ts`](./tutorial/worker.diff "source")

4. Run again to prove source edits invalidate the cache:

   ```console frame="terminal"
   $ effect-ci run build
   …
   $ vp build ○ cache miss: 'worker/index.ts' modified, executing
   …
   ```

## 6. Create a GitHub repository

1. Commit and push:

   ```sh
   git branch -M main
   git add .
   git commit -m "feat: Cache the build"
   gh repo create walkthrough --private --source=. --remote=origin --push
   ```

<a id="6-run-on-a-host"></a>

## 7. Enroll OIDC and run on a host

Prerequisite: the host's GitHub App is installed on `walkthrough`, and your
account can sign in through its Access policy.

1. Enroll with the current host:

   ```sh
   export EFFECT_CI_REMOTE_URL=https://effect-ci-github-cloudflare.eclemmons.workers.dev
   cloudflared access login --quiet "$EFFECT_CI_REMOTE_URL"
   effect-ci oidc --service "$EFFECT_CI_REMOTE_URL"
   git add .cloudflare/ci/oidc.json
   git commit -m "ci: Enroll hosted execution"
   git push
   effect-ci doctor --remote
   ```

2. Run the pushed commit twice:

   ```sh
   effect-ci run build
   effect-ci run build
   ```

   - [ ] Remote Workflow IDs appear.
   - [ ] Check the second run's cache output; a cold host can still miss.

3. Run uncommitted edits locally:

   ```sh
   effect-ci run build --local
   ```

   - [ ] Enrollment makes remote execution the default; `--local` bypasses it.

## 8. Open a PR with checks

1. Create `.github/workflows/checks.yml`:

   [`.github/workflows/checks.yml`](./tutorial/checks.example.yml "source")

2. Open the PR:

   ```sh
   git switch -c feat/github-checks
   git add .github/workflows/checks.yml
   git commit -m "ci: Run the build on Cloudflare"
   git push -u origin feat/github-checks
   gh pr create --title "ci: Run the build on Cloudflare"
   gh pr checks
   ```

   - [ ] GitHub's `build` job dispatches to the enrolled host.
   - [ ] Push events support branch PRs; fork PR events are not enrolled.
   - [ ] No stored Effect CI token.

## 9. Own the workflow

1. Disable the SDK's optional native addon:

   [`pnpm-workspace.yaml`](./tutorial/pnpm.diff "source")

2. Install SDK types from the prototype source:

   ```sh
   pnpm add -D github:ericclemmons/effect-ci-testbed#path:packages/ci
   ```

3. Add a Node TypeScript scope for the workflow:

   [`.cloudflare/ci/tsconfig.json`](./tutorial/ci.tsconfig.json "source")

4. Replace the discovery marker:

   [`.cloudflare/ci/ci.ts`](./tutorial/ci.exec.ts "source")

5. Inspect and run:

   ```sh
   effect-ci plan
   effect-ci run --local
   ```

   - [ ] Your file now owns the default goal.

### Replace shell plumbing with SDK methods

1. Apply:

   [`.cloudflare/ci/ci.ts`](./tutorial/sdk.diff "source")

2. Run:

   ```sh
   effect-ci run --local
   ```

   - [ ] `CI.PackageManager.JavaScript` detects pnpm and its lockfile.
   - [ ] `install()` uses the frozen lockfile; `exec()` runs the cached Vite+ task.

### Skip Markdown-only changes

1. Apply:

   [`.cloudflare/ci/ci.ts`](./tutorial/docs.diff "source")

   [`.github/workflows/checks.yml`](./tutorial/checks.diff "source")

2. Commit the workflow upgrade first:

   ```sh
   git add .
   git commit -m "ci: Skip Markdown-only changes"
   ```

3. Edit only `README.md`, commit, and compare with the previous commit:

   ```sh
   git add README.md
   git commit -m "docs: Update the readme"
   EFFECT_CI_BASE_REVISION=HEAD~1 effect-ci run --local
   ```

   - [ ] No checkout, install, or build actions run.
   - [ ] Unknown source comparison runs CI.
   - [ ] GitHub's path filter skips dispatch before remote compute starts.

## 10. Skip unchanged build output

This lesson publishes to a local directory. The shared Cloudflare host has no
successful-deployment baseline adapter yet.

1. Apply:

   [`.cloudflare/ci/ci.ts`](./tutorial/output.diff "source")

2. Run twice without the earlier comparison override:

   ```sh
   effect-ci run --local
   cat .effect-ci/deployed-site/current.json
   effect-ci run --local
   cat .effect-ci/deployed-site/current.json
   ```

   - [ ] First run: build → publish.
   - [ ] Same bytes: build → skip publication; receipt stays unchanged.
   - [ ] Failed build or publication keeps the last successful baseline.

3. Change the API response again and run:

   ```sh
   effect-ci run --local
   ```

   - [ ] Changed output publishes once.
   - [ ] `workspace.changed(".cloudflare/output/**")` compares output, not source paths.

## 11. Deploy with temporary credentials

Prerequisite: this host permits deployment to your intended Cloudflare account.
This job deploys independently of the local publication lesson.

1. Add the manual deployment workflow:

   [`.github/workflows/deploy.yml`](./tutorial/deploy.diff "source")

2. Commit, push, and merge the PR. Once `deploy.yml` reaches `main`, run:

   ```sh
   gh workflow run deploy.yml --ref main
   ```

   - [ ] The auth action exchanges GitHub OIDC for a temporary Cloudflare token.
   - [ ] `cf deploy` builds and deploys the Worker and React assets.
   - [ ] The action revokes the token on job exit; expiry covers interrupted cleanup.

## 12. Add Slack

### Notify the channel

1. Create a Slack incoming webhook. Store it in the repository:

   ```sh
   gh secret set SLACK_WEBHOOK_URL
   ```

2. Append this step to the deployment job:

   [`.github/workflows/deploy.yml`](./tutorial/slack.diff "source")

3. Commit and push. After merge, trigger another deployment:

   ```sh
   gh workflow run deploy.yml --ref main
   ```

   - [ ] Slack receives the job status and run link after success or failure.

### Require approval before publication

1. Add the gate to `ci.ts`:

   [`.cloudflare/ci/ci.ts`](./tutorial/approval.diff "source")

2. Change the API response so the build output differs. Reject, then approve locally:

   ```sh
   EFFECT_CI_APPROVAL=rejected effect-ci run --local
   EFFECT_CI_APPROVAL=approved effect-ci run --local
   ```

   - [ ] Rejection fails the run and preserves the baseline.
   - [ ] Approval publishes the changed output.
   - [ ] Missing approval handler fails closed.

Live Slack buttons require a host approval adapter with an authorized reviewer
list and verified callbacks. Generic repository runs on this host do not have
that adapter. The webhook above only sends notifications; the local environment
switch previews the gate.
