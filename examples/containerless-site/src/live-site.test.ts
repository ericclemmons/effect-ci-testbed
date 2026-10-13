import assert from "node:assert/strict";
import test from "node:test";
import { nativeEvidence, rejectedEvidence } from "../verification/native.ts";
test(
  "retained native source/build/publication/site and identical replay match exact bytes",
  { skip: process.env.LIVE_CONTAINERLESS_SITE !== "1", timeout: 120_000 },
  async () => {
    const original = await nativeEvidence("coverage-containerless-site-20261013-1");
    const replay = await nativeEvidence("coverage-containerless-site-replay-20261013-1");
    assert.equal(replay.assetDigest, original.assetDigest);
    assert.equal(replay.sourceDigest, original.sourceDigest);
    assert.equal(replay.siteUrl, original.siteUrl);
    rejectedEvidence();
  },
);
