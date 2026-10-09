# Demo script: check my work before I push

Use this script from a disposable demo checkout or a Codex worktree. Keep the
commands in one terminal session so PATH and backup variables stay available.
The script edits only the fixture source, creates a temporary note, and restores
the original source at the end. It does not commit, push, or deploy anything.

## Set up before presenting

Use Node 24.11+ or Node 26+. Start at the testbed repository root:

```sh
pnpm install
export PATH="$PWD/node_modules/.bin:$PATH"
cd examples/developer-loop
DEMO_SOURCE="$(mktemp /tmp/effect-ci-demo-source.XXXXXX)"
cp app/message.js "$DEMO_SOURCE"
```

Keep `package.json`, `.cloudflare/ci/ci.ts`, and `app/message.js` open in the
editor. The CI marker is empty. The package scripts supply the task definitions.
If you rehearsed in this checkout, its first run may already be cached. Call it
the first run of this presentation, not a cold run. Use a fresh demo checkout to
show a cold run; do not clear a shared repository cache during the presentation.

## Human walkthrough and narration

1. **Discover what this project can do.**

   Run:

   ```sh
   wc -c .cloudflare/ci/ci.ts
   cat package.json
   cf-ci list --format=text
   cf-ci plan lint --format=mermaid
   ```

   Look for: an empty CI marker, the `lint` and `build` targets, and the lint
   plan's checkout/install prerequisites. No `--workflow` argument is supplied.

   Say:

   > I don't want to remember whether this repo wants `pnpm run`, `vp run`, or
   > something else. Once I've set up the CLI, I want to ask the repo what I can
   > run. Here the CI file is empty. The tasks come from ordinary package scripts,
   > and I can inspect the plan before running anything.

2. **Run the checks where I'm already working.**

   Run:

   ```sh
   cf-ci run lint --format=text
   time cf-ci run build --format=text
   cat dist/message.js
   ```

   Look for: successful syntax validation and an artifact containing the source
   message. Record total elapsed time, including installation and CLI overhead.

   Say:

   > I haven't committed or pushed. This is checking my working files. This demo's
   > lint is just a syntax check, and the build copies the source into an artifact.
   > I'm keeping the task small so you can see what actually happens.

3. **Run it again without changing anything.**

   Run:

   ```sh
   time cf-ci run build --format=text
   ```

   Look for: Vite+'s `cache hit, replaying` message. The replayed build output
   alone does not show whether the task executed.

   Say:

   > Here's the same command again. Vite+ is validating the cached task and
   > replaying its output. Effect CI still does its setup. I'm showing the actual
   > total time, so the cache doesn't get credit for work we're still doing.

4. **Restore a missing output.**

   Run:

   ```sh
   node --input-type=module -e 'import { rmSync } from "node:fs"; rmSync("dist/message.js", { force: true })'
   cf-ci run build --format=text
   cat dist/message.js
   ```

   Look for: a cache hit and the restored artifact.

   Say:

   > I deleted the generated file. The cached result can restore it, too. A saved
   > log by itself wouldn't give me the artifact back.

5. **Make an edit this task doesn't use.**

   Run:

   ```sh
   DEMO_NOTE="$(mktemp ./demo-note.XXXXXX)"
   printf 'An unrelated edit.\n' > "$DEMO_NOTE"
   cf-ci run build --format=text
   ```

   Look for: the build remains a cache hit because it does not read this note.

   Say:

   > I changed a file, but the build doesn't use that file. It can keep the result
   > that's still valid. I didn't write an input glob for this task; Vite+ observes
   > its filesystem inputs.

6. **Change an input and check it before pushing.**

   Run:

   ```sh
   printf 'export const message = "Checked before pushing"\n' > app/message.js
   cf-ci run lint --format=text
   cf-ci run build --format=text
   cat dist/message.js
   cf-ci run build --format=text
   ```

   Look for: the source edit invalidates the lint/build tasks; the artifact has
   the new message; the immediate repeat can reuse the new build result. If this
   exact source was checked during rehearsal, it may already have a valid cache
   entry. Use a new message to demonstrate a miss rather than calling a hit a miss.

   Say:

   > This edit matters to both tasks, so they need a result for these inputs. The
   > artifact now contains the new message. Once that work is done, the next run
   > can reuse it. I still haven't needed a commit or a push.

7. **Break it, then use the failure to repair it.**

   Run:

   ```sh
   printf 'export const message = "Checked before pushing\n' > app/message.js
   if cf-ci run lint --format=json; then
     printf 'Unexpected pass: inspect the result before continuing.\n'
   else
     printf 'Lint exit code: %s\n' "$?"
   fi
   cf-ci run lint --format=text
   printf 'export const message = "Checked before pushing"\n' > app/message.js
   cf-ci run lint --format=json
   cf-ci run build --format=json
   ```

   Look for: `ok: false`, exit code 1, the text-mode syntax diagnostic, then
   successful JSON results after the repair. The text-mode lint intentionally
   fails; continue with the repair commands in this interactive terminal.

   Say:

   > I removed a quote. The command fails, and the JSON result names the failed
   > target. There's a current limitation here: JSON doesn't include the compiler
   > diagnostic, so I rerun in text mode to read it. After the repair, I can check
   > the same working files again.

## Hand the same loop to an agent

Open the agent in `examples/developer-loop` with `cf-ci` on its PATH. Give it
this prompt; choose a different message if you already used this one in rehearsal:

> Change the exported message in `app/message.js` to "Checked by my agent".
> Use `cf-ci` to discover the available targets and inspect the lint plan. Run
> lint and build with JSON output. If either fails, read its text-mode diagnostic,
> fix the source, and rerun. Confirm that `dist/message.js` contains the new
> message. Run the build once more in text mode to show cache status. Don't
> commit, push, or add a verification trailer.

Look for: the agent uses `cf-ci list`, `cf-ci plan lint`, `cf-ci run lint`, and
`cf-ci run build`. Its successful build produces the edited artifact. A cache hit
is visible in text mode; JSON success alone does not distinguish tool execution
from tool-owned cache reuse.

Say:

> The agent gets the same entrypoint I used. It can discover the tasks, inspect
> the plan, and use exit codes and JSON results to decide what to do next. It
> doesn't have to infer this repo's validation commands from scratch.

> The part I'm exploring is this developer loop: check the files I'm editing,
> reuse work whose inputs still match, and give the agent a result it can act on.
> Vite+ owns the task cache. This example doesn't establish that another CI
> implementation couldn't provide the same loop.

## Close with the current boundary

Say:

> This is a tiny local example. I haven't demonstrated a Stratus speedup or
> container-free execution here. Installation still runs. Filesystem tracking
> also needs explicit policies for inputs such as environment variables and
> network responses. Signed evidence for dirty files and commit trailers are a
> separate step; I don't want a green result to claim more than we checked.

## Restore the demo files

After the agent has finished, run in the original terminal session:

```sh
cp "$DEMO_SOURCE" app/message.js
cf-ci run lint --format=text
cf-ci run build --format=text
rm -- "$DEMO_NOTE" "$DEMO_SOURCE"
git status --short
```

The last command lets you inspect any remaining changes. Do not use `git restore`
or a repository-wide cleanup to discard unrelated work.
