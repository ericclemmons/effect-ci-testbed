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
