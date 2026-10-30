# Walkthrough

Create a React app with a Worker API. Run and cache its build locally, then run
the same build on an Effect CI host.

## 1. Make the CLI available

Install [Vite+](https://viteplus.dev/guide/). You'll also need Node
24.11+ or 26+, pnpm, and Git.

From a clone of [Effect CI](https://github.com/ericclemmons/effect-ci-testbed):

```sh
pnpm install
export PATH="$PWD/node_modules/.bin:$PATH"
effect-ci --help
```

Keep this shell open.

## 2. Create a Cloudflare app

Use [Cloudflare's React starter](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/)
through `vp create`. This creates a React SPA and a Worker that serves `/api/`.

Run this from the directory where you keep projects:

```sh
vp create cloudflare
```

Follow the prompts: name the app `walkthrough`, choose **Framework Starter**, then
**React** with TypeScript and pnpm, and enable Git and commit hooks. Skip deployment
for now.

```sh
cd walkthrough
vp dev
```

Open the printed URL. Click the **Name from API** button to call the Worker:

```json
{ "name": "Cloudflare" }
```

Stop the server with Ctrl-C. Nothing has been deployed.

## 3. Inspect before running

```sh
effect-ci list
```

```text
Workflow: walkthrough
Run commands:
  effect-ci run build
  effect-ci run lint
  ...
```

Every `package.json` script is an action, including `dev`, `build`, and `lint`.
Vite+ tasks in `vite.config.ts` under `run.tasks` are actions too.
Use `effect-ci list` to see them. Execution requires an action name; bare
`effect-ci run` reports how to choose one.

Agents get JSON from the same command. Try it with `AI_AGENT=demo`:

```sh
AI_AGENT=demo effect-ci list
```

Inspect both goals without running them:

```sh
effect-ci plan lint build --format=mermaid
```

```mermaid
flowchart LR
  step_checkout["checkout"]
  step_install["install"]
  step_build["build"]
  step_lint["lint"]
  step_checkout --> step_install
  step_install --> step_build
  step_install --> step_lint
```

## 4. Run the build

```sh
effect-ci run build
```

Shortened output:

```text
$ tsc -b && vp build
...
dist/walkthrough/index.js
...
dist/client/index.html
dist/client/assets/index-piJr7AhZ.js
...
CI execution summary: walkthrough/build
Environment: development

✓ checkout
✓ install depends on checkout
✓ build depends on install
```

The existing build script checks TypeScript and bundles the SPA and Worker.
No CI workflow to write.

## 5. Run again

Move the build script into `run.tasks` in `vite.config.ts`. Vite+ caches config
tasks by default. Effect CI discovers the task and runs it through `vp run`.

In `package.json`:

```diff
   "scripts": {
-    "build": "tsc -b && vp build",
-    "preview": "pnpm run build && vp preview",
+    "preview": "vp run build && vp preview",
```

In `vite.config.ts`, keep the existing plugins and add `run.tasks`:

```diff
 export default defineConfig({
+  run: {
+    tasks: {
+      build: {
+        command: "tsc -b && vp build",
+      },
+    },
+  },
```

A task name must be defined in one place: `package.json` scripts or Vite+
`run.tasks`. Update any other scripts that call `pnpm run build` to use
`vp run build`.

```sh
effect-ci run build
effect-ci run build
```

The second run reuses the bundle:

```text
$ vp run build
$ tsc -b

$ vp build ◉ cache hit, replaying
...
vp run: 1/2 cache hit (50%)
...
✓ build depends on install
```

TypeScript still runs. Vite+ caches the bundle by tracking its inputs and outputs.

In `worker/index.ts`:

```diff
       return Response.json({
-        name: "Cloudflare",
+        name: "Effect CI",
       });
```

Run again:

```sh
effect-ci run build
```

```text
$ vp build ○ cache miss: 'worker/index.ts' modified, executing
transforming...
```

[More on Vite+ caching](../vite-plus-cache).

## 6. Run on a host

Remote execution runs the same named action on a host, from your pushed GitHub
commit. No custom CI workflow is needed.

### Push the app to GitHub

Install the [GitHub CLI](https://cli.github.com/) and sign in with `gh auth login`.
From the app directory, commit your changes and create its GitHub repository:

```sh
git add .
git commit -m "Prepare walkthrough"
gh repo create walkthrough --private --source=. --remote=origin --push
git remote get-url origin
```

Choose another repository name if `walkthrough` is already taken. The command
sets `origin` and pushes your commits. Enrollment reads `remote.origin.url` to
identify your repository.

If you already created the GitHub repository but have no `origin`, connect it
instead. Replace the URL with your repository's URL:

```sh
git remote add origin https://github.com/YOUR-OWNER/YOUR-REPO.git
git push -u origin HEAD
```

### Connect to a host

Use an existing Effect CI host, or [set one up](../../apps/effect-ci/SELF-HOST.md).
Ensure the host's GitHub App installation can access your new repository. If it
uses **Only select repositories**, add the repository to **Repository access**.

Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
for local sign-in. From the app directory, replace `https://your-ci-host` with
the host's origin:

```sh
cloudflared access login https://your-ci-host
effect-ci oidc --service https://your-ci-host
```

Enrollment writes `.cloudflare/ci/oidc.json` with the public host origin and
repository name. It contains no credentials. The CLI reads it to find the remote
endpoint; without enrollment or `EFFECT_CI_REMOTE_URL`, `--remote` reports
`CI_REMOTE_UNAVAILABLE`.

Commit and push the enrollment file:

```sh
git add .cloudflare/ci/oidc.json
git commit -m "Configure hosted CI"
git push
```

### Run the build remotely

Check access, then run the build:

```sh
effect-ci doctor --remote
effect-ci run build --remote
```

Remote runs use the pushed commit. [Host setup](../../apps/effect-ci/SELF-HOST.md)
and [GitHub integration](../GITHUB.md) are separate guides.

## Add one thing

| What next?                      | Guide                                         |
| ------------------------------- | --------------------------------------------- |
| Run from GitHub                 | [GitHub](../GITHUB.md)                        |
| Use Turbo's task graph          | [Turborepo](../turborepo-cache)               |
| Add custom CI logic             | [Exported actions](../exported-actions)       |
| Approve a small safe change     | [Safe-change approval](../small-change)       |
| Keep secrets out of the process | [Outbound authentication](../secret-outbound) |
