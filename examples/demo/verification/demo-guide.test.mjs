import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

const guide = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const shell = [...guide.matchAll(/```sh\n([\s\S]*?)```/g)].map((match) => match[1]);

test("step zero builds simply and checks remote readiness before the walkthrough", () => {
  const start = shell[0];
  assert.equal(start, "pnpm install\npnpm build\n");
  assert.match(guide, /git switch -c demo\/rehearsal\n/);
  assert.match(
    guide,
    /export PATH="\$\(git rev-parse --show-toplevel\)\/node_modules\/\.bin:\$PATH"/,
  );
  const setup = guide.split("## 1.")[0];
  assert.match(setup, /cloudflared access login[^\n]*\ncf-ci doctor --remote/);
  assert.doesNotMatch(setup, /<details>/);
  assert.match(setup, /without starting work/);
  assert.doesNotMatch(start, /git worktree|tiged|gh repo create|npm ci|--frozen-lockfile/);
  assert.ok(shell.every((block) => !/^(?:time )?(?:npm|npx)(?: |$)/m.test(block)));
});

test("ordinary branch pushes preview; main is production without a special ref or merge dance", () => {
  const release = guide.indexOf("## 11. Release from main");
  assert.ok(release > 0);
  assert.match(guide, /git push -u origin demo\/rehearsal/);
  assert.match(guide, /git commit -m "Rehearse the demo"\ngit push\n/);
  assert.match(guide.slice(release), /gh pr create --base main --fill/);
  assert.doesNotMatch(guide, /demo\/live|git worktree|git merge|git push --force|git reset --hard/);
  assert.doesNotMatch(guide, /git push[^\n`]*(?:HEAD|refs\/heads\/|:)/);
});

test("fresh demo endpoint is public config; Access is not an API token", () => {
  const endpoint = readFileSync(new URL("../.env", import.meta.url), "utf8");
  assert.match(
    endpoint,
    /^EFFECT_CI_REMOTE_URL=https:\/\/effect-ci-github-cloudflare\.ericclemmons\.workers\.dev\/demo$/m,
  );
  assert.doesNotMatch(endpoint, /EFFECT_CI_REMOTE_TOKEN/);
  assert.match(guide, /Access login alone does not provide that API token/);
});

test("Slack links to the same native run without adding another manual Dashboard identifier", () => {
  assert.match(guide, /https:\/\/app\.slack\.com\/client\/TBXG40NPN\/C0C81FU4B5J/);
  assert.match(guide, /Details on that Slack parent card/);
  assert.match(guide, /\*\*on GitHub Actions\*\*, not Cloudflare/);
});

test("GitHub adoption replaces the actual manual job with the repository workflow reference", () => {
  const baseline = readFileSync(
    new URL("../.github/workflows/github.yml", import.meta.url),
    "utf8",
  );
  const section = guide.split("## 5.")[1].split("## 6.")[0];
  const diff = section.match(/```diff\n([\s\S]*?)```/)[1];
  assert.match(diff, /--- a\/\.github\/workflows\/github.yml/);
  const removed = diff
    .split("\n")
    .filter((line) => line.startsWith("-") && !line.startsWith("---"))
    .map((line) => line.slice(1))
    .join("\n");
  assert.ok(baseline.includes(removed), "deleted job steps must match the actual baseline");
  assert.match(
    diff,
    /\+    uses: ericclemmons\/effect-ci-testbed\/\.github\/workflows\/effect-ci.yml@main/,
  );
  const reference = readFileSync(
    new URL("./effect-on-github.example.yml", import.meta.url),
    "utf8",
  );
  assert.match(
    reference,
    /uses: ericclemmons\/effect-ci-testbed\/\.github\/workflows\/effect-ci.yml@main/,
  );
});

test("authored orchestration requests goals, without claiming hosted parity or full-suite reuse", () => {
  const section = guide.split("## 6.")[1].split("## 7.")[0];
  assert.match(section, /\+export \* from "\.\/actions.ts"/);
  assert.match(section, /CI.parallel\(\[actions.test\(\), actions.build\(\)\]\)/);
  assert.doesNotMatch(section, /\+  yield\* actions\.(lint|check|typecheck)\(\)/);
  assert.match(section, /Marker-free script discovery is still conservative and serial/);
  assert.match(guide, /host currently selects its fixed demo program/);
  assert.match(guide, /Full test-suite reuse is not enrolled yet/);
  assert.match(guide, /deploymentPerformed: false/);
  assert.ok(
    guide.replace(/```[\s\S]*?```/g, "").split(/\s+/).length < 900,
    "keep technical evidence in linked maintainer docs",
  );
});

test("remote goals distinguish negotiated computation from the default preview workflow", () => {
  assert.match(guide, /cf-ci run test build --remote/);
  assert.match(guide, /checks host capabilities before dispatch/);
  assert.match(guide, /selected hosted goals share installation and never\npublish or release/);
  assert.match(guide, /Live verified: selected hosted goals/);
});
