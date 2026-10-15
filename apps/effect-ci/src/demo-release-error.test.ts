import assert from "node:assert/strict";
import test from "node:test";
import { demoReleaseError } from "./demo-release-error.ts";

test("release diagnostics preserve only the fixed broker protocol, without arbitrary cause text", () => {
  for (const stage of ["upload", "readback", "identity", "allocation"]) {
    const error = demoReleaseError(Error(`Candidate upload uncertain or rejected (${stage}, HTTP 200, version 11111111-1111-4111-8111-111111111111); reconcile the pending identity, never retry automatically`));
    assert.match(error.message, new RegExp(`stage=${stage}, HTTP 200, version 11111111`));
    assert.equal("cause" in error, false);
  }
  const hostile = "Bearer fake-secret https://private.invalid?token=fake-secret";
  for (const value of [Error(hostile), hostile, null, { message: hostile }, Error("Candidate upload uncertain or rejected (identity, HTTP 200); reconcile the pending identity, never retry automatically " + hostile)]) {
    const error = demoReleaseError(value);
    assert.match(error.message, /stage=broker/);
    assert.doesNotMatch(JSON.stringify(error) + error.stack, /fake-secret|private.invalid/);
  }
  let accessed = false;
  demoReleaseError({ get message() { accessed = true; throw Error(hostile); } });
  assert.equal(accessed, false);
  assert.match(demoReleaseError(Error("Prepared release identity mismatch")).message, /stage=receipt/);
});
