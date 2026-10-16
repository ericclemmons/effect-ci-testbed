import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

test("tiged removes only the template npm lock so pnpm setup cannot leave ambiguous lockfiles", () => {
  const directives = new URL("../degit.json", import.meta.url);
  const npmLock = new URL("../package-lock.json", import.meta.url);
  if (existsSync(directives)) {
    assert.deepEqual(JSON.parse(readFileSync(directives, "utf8")), [
      { action: "remove", files: ["package-lock.json"] },
    ]);
    assert.ok(
      existsSync(npmLock),
      "the checked-in lock and existing attestation input stay intact",
    );
  } else {
    // tiged consumes its directive file after copying, never in the source repo.
    assert.equal(
      existsSync(npmLock),
      false,
      "exported app must not retain an npm lock beside pnpm's",
    );
  }
});
