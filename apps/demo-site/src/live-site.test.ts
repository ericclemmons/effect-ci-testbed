import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";

export const nativeSiteUrl =
  "https://effect-ci-demo-site.ericclemmons.workers.dev/r/b302e8cb0965cdbc7da2ab455d696385e782abf7/e9fad7f0e6117c0a33f76d9d9891ebefb2c34519364179e464857a2780efcb23/index.html";

test(
  "retained native Vite build bytes equal the immutable public site, without redispatch",
  { skip: !process.env.LIVE_DEMO_SITE },
  async () => {
    const history = JSON.parse(
      execFileSync(
        process.env.CF_BIN ?? "cf",
        [
          "workflows",
          "instances",
          "get",
          "14c8ceb0-840f-4f39-a565-a97cc9b76c71",
          "--workflow-name",
          "effect-ci-demo",
        ],
        { encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
      ),
    );
    assert.equal(history.status, "complete");
    assert.equal(history.success, true);
    assert.equal(history.params.revision, "b302e8cb0965cdbc7da2ab455d696385e782abf7");
    assert.equal(history.output.nodes.length, 10);
    assert.ok(history.output.nodes.every((n: any) => n.status === "complete"));
    const publication = history.steps.find((s: any) => s.name === 'action:"publish site"-1');
    const result = JSON.parse(publication.output).value.data;
    assert.equal(result.url, nativeSiteUrl);
    assert.equal(result.revision, history.params.revision);
    assert.equal(publication.attempts.length, 1);
    assert.equal(publication.config.retries.limit, 0);
    const commands = history.steps.filter((s: any) => s.name.startsWith("command:"));
    assert.equal(commands.length, 9);
    for (const step of commands) {
      assert.equal(step.success, true);
      assert.equal(step.attempts.length, 1);
      assert.equal(step.config.retries.limit, 0);
    }
    const verifier = commands.find((s: any) => s.name === 'command:["verify build",1]-1');
    const checked = JSON.parse(JSON.parse(verifier.output).stdout.trim());
    assert.equal(checked.verified, true);
    assert.deepEqual(
      checked.files.map((f: any) => [f.path, f.size]),
      [
        ["dist/index.html", 525],
        ["dist/app.js", 1520],
        ["dist/message.js", 103],
      ],
    );
    for (const file of checked.files) {
      const response = await fetch(nativeSiteUrl.replace("index.html", file.path.slice(5)), {
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-site-digest"), result.digest);
      const bytes = new Uint8Array(await response.arrayBuffer());
      assert.equal(bytes.length, file.size);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
    }
    const post = await fetch(nativeSiteUrl, {
      method: "POST",
      body: "not allowed",
      redirect: "manual",
    });
    assert.equal(post.status, 405);
    await post.body?.cancel();
    const missing = await fetch(nativeSiteUrl.replace(result.digest, "0".repeat(64)), {
      redirect: "manual",
    });
    assert.equal(missing.status, 404);
    await missing.body?.cancel();
  },
);
