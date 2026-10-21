import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

test("the OFF-mode proposal repairs only a literal blank greeting, without evaluating source or pretending to create a PR", () => {
  const { prepareModeledGreeting } = createRequire(import.meta.url)("../showcase-modeled-repair.cjs");
  for (const before of ['export const greeting = "";\n', 'export const greeting = "   ";\n']) {
    const result = prepareModeledGreeting(before);
    assert.equal(result.path, "packages/greeting/message.ts");
    assert.equal(result.after, 'export const greeting = "Hello from a shared package.";\n');
    assert.equal(result.mode, "modeled-off");
    assert.equal(result.modelCalled, false);
    assert.equal(result.pullRequestCreated, false);
    assert.equal(result.deploymentPerformed, false);
    assert.notEqual(result.beforeDigest, result.afterDigest);
  }
  let evaluated = false;
  for (const value of ['export const greeting = "healthy";', 'export const greeting = (() => { throw Error("execute"); })();',
    'export const greeting = ""; fetch("https://foreign.invalid")', "export const greeting = ;", "x".repeat(8193),
    { toString() { evaluated = true; return 'export const greeting = "";'; } }])
    assert.throws(() => prepareModeledGreeting(value));
  assert.equal(evaluated, false);
});
