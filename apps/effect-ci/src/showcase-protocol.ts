import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const ShowcaseGoal = Schema.Literals(["lint", "test", "build"]);
export const ShowcaseGoals = Schema.UniqueArray(ShowcaseGoal).check(Schema.isLengthBetween(1, 3));
export const ShowcaseSelection = Schema.Struct({
  target: Schema.optionalKey(ShowcaseGoal),
  targets: Schema.optionalKey(ShowcaseGoals),
});
export const ShowcaseRevision = Schema.String.check(Schema.isLowercased()).pipe(
  Schema.decodeTo(Schema.Uint8ArrayFromHex.check(Schema.isLengthBetween(20, 20))),
);
export const ShowcaseDigest = Schema.String.check(Schema.isLowercased()).pipe(
  Schema.decodeTo(Schema.Uint8ArrayFromHex.check(Schema.isLengthBetween(32, 32))),
);
export const ShowcaseVersion = Schema.String.check(Schema.isUUID(undefined));
export const ShowcasePublication = Schema.Struct({
  revision: ShowcaseRevision,
  digest: ShowcaseDigest,
  url: Schema.URLFromString,
});
export type ShowcaseSiteReceipt = typeof ShowcasePublication.Encoded;
export const ShowcaseStartCapability = Schema.Struct({
  owner: Schema.NonEmptyString.check(Schema.isMaxLength(128)),
  phase: Schema.Literal(0),
  snapshot: ShowcaseDigest,
  token: ShowcaseDigest,
});
export const ShowcaseDecision = Schema.Struct({
  snapshot: ShowcaseDigest,
  decision: Schema.Literals(["approved", "rejected"]),
  actor: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
  reason: Schema.NonEmptyString.check(Schema.isMaxLength(500)),
  acceptedAt: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0)),
});
export const ShowcaseWakeup = Schema.Struct({ snapshot: ShowcaseDigest });
export const ShowcaseCandidate = Schema.Struct({
  revision: ShowcaseRevision,
  digest: ShowcaseDigest,
  moduleDigest: ShowcaseDigest,
  version: ShowcaseVersion,
  script: Schema.Literal("effect-ci-hmd-demo"),
  policy: Schema.Literal("owned-vite-release-pointer-v1"),
});

/** Decode at the RPC boundary. Never render Schema issues containing input data. */
export const decodeShowcasePublication = (value: unknown) =>
  Schema.decodeUnknownEffect(ShowcasePublication)(value).pipe(
    Effect.map(receipt => Schema.encodeSync(ShowcasePublication)(receipt)),
    Effect.mapError(() => new Error("Invalid showcase publication receipt")),
  );
