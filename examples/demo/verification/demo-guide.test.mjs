import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

const guide = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const shell = [...guide.matchAll(/```sh\n([\s\S]*?)```/g)].map((match) => match[1]);

test("demo starts on an ordinary branch with PATH and Access setup before the walkthrough", () => {
  const start = shell[0];
  assert.match(start, /git switch -c demo\/rehearsal origin\/main/);
  assert.match(start, /export PATH="\$PWD\/node_modules\/\.bin:\$PATH"/);
  assert.match(start, /cloudflared access login .*\ncd examples\/demo\npnpm build/);
  assert.doesNotMatch(start, /git worktree|tiged|gh repo create|npm ci|--frozen-lockfile/);
  assert.ok(shell.every((block) => !/^(?:time )?(?:npm|npx)(?: |$)/m.test(block)));
});

test("ordinary branch pushes preview; main is production without a special ref or merge dance", () => {
  const release = guide.indexOf("## 11. Release from main");
  assert.ok(release > 0);
  assert.match(guide, /git push -u origin HEAD/);
  assert.match(guide.slice(release), /gh pr create --base main --fill/);
  assert.doesNotMatch(guide, /demo\/live|git worktree|git merge|git push --force|git reset --hard/);
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
