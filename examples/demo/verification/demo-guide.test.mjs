import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

const guide = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const shell = [...guide.matchAll(/```sh\n([\s\S]*?)```/g)].map((match) => match[1]);

test("demo starts in this repo's enrolled history without new repo or PATH setup", () => {
  const start = shell[0];
  assert.match(start, /git worktree add -b codex\/demo-rehearsal .* origin\/demo\/live/);
  assert.match(start, /git merge --no-edit origin\/main/);
  assert.match(start, /pnpm install\ncd examples\/demo\npnpm build/);
  assert.doesNotMatch(start, /tiged|gh repo create|npm ci|--frozen-lockfile|export PATH/);
  assert.ok(shell.every((block) => !/^(?:time )?(?:npm|npx|cf-ci)(?: |$)/m.test(block)));
});

test("only the release step pushes the enrolled ref; rehearsal saves use their own branch", () => {
  const release = guide.indexOf("## 11. Release the checked build with a decision");
  assert.ok(release > 0);
  assert.ok(!guide.slice(0, release).includes("git push origin HEAD:refs/heads/demo/live"));
  assert.match(guide.slice(release), /git merge --no-edit origin\/demo\/live/);
  assert.match(guide.slice(release), /git push origin HEAD:refs\/heads\/demo\/live/);
  assert.doesNotMatch(guide, /git switch demo\/live|git push --force|git reset --hard/);
  assert.ok(shell.every((block) => !/^git push$/m.test(block)));
});

test("Slack links to the same native run, and the retained Dashboard example is labelled", () => {
  assert.match(guide, /https:\/\/app\.slack\.com\/client\/TBXG40NPN\/C0C81FU4B5J/);
  assert.match(guide, /Details on that Slack parent card/);
  assert.match(
    guide,
    /workers\/workflows\/effect-ci-demo\/instance\/3b9098e0-c8f9-11f1-9c69-5d488bf82d84/,
  );
  assert.match(guide, /retained example, not your next run/);
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
  assert.match(section, /marker-free discovery currently runs its inferred script list serially/);
  assert.match(guide, /this deployed host still\nselects its fixed inferred program/);
  assert.match(guide, /Full test-suite reuse is not enrolled yet/);
  assert.match(guide, /not a deploy/);
});
