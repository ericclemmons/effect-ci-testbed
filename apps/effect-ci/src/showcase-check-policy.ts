import * as Schema from "effect/Schema";
import { runnerReceiptDigest } from "@effect-ci-testbed/cloudflare/runner-check-receipt";
import type { HostedCheckIdentity } from "@effect-ci-testbed/cloudflare/check-evidence";
import inputs from "../showcase-check-inputs.json" with { type: "json" };
import { ShowcaseDigest, ShowcaseRevision, ShowcaseVersion } from "./showcase-protocol.ts";
import { showcaseRepository, showcaseRoot } from "./showcase-runner-policy.ts";
import { showcaseProcessPrefix } from "./showcase-process-policy.ts";

export const showcaseTestCommand = "env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp CI=true ./node_modules/.bin/vp test --run";
export const showcaseInspectCommand = "env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp /usr/local/bin/node /opt/effect-ci-showcase/inspect-check.cjs";
const digest = (value: unknown) => runnerReceiptDigest(new TextEncoder().encode(JSON.stringify(value)));
const Count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(100_000));
const Descriptor = Schema.fromJsonString(Schema.Struct({
  version: Schema.Literal(1), uid: Schema.Literal(1000), platform: Schema.Literal("linux"), arch: Schema.Literal("x64"),
  runtime: Schema.Literal("v24.22.0"), node: ShowcaseDigest,
  dependencies: ShowcaseDigest, dependencyFiles: Count,
  files: Schema.Array(Schema.Struct({
    path: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
    size: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(4 * 1024 * 1024)),
    sha256: ShowcaseDigest,
  })).check(Schema.isLengthBetween(10, 10)),
}));

/** This is explicit owned-app enrollment, not a generic signer for uploaded
 * modules. Other source/config changes still execute, without signed reuse.
 */
export async function showcaseTestPolicyDigest(hostVersion: string) {
  Schema.decodeUnknownSync(ShowcaseVersion)(hostVersion);
  return digest(["showcase-prepared-tests-v2", showcaseRoot, inputs, "literal-greeting-only", showcaseTestCommand,
    showcaseProcessPrefix, "uid-1000/no-capabilities/no-new-privileges/readiness-verified",
    showcaseInspectCommand, "root-owned-inspector/uid-1000/frozen-dependencies/before-and-after", hostVersion]);
}

export async function showcaseCheckIdentity(revision: string, hostVersion: string, text: string): Promise<HostedCheckIdentity> {
  try {
    Schema.decodeUnknownSync(ShowcaseRevision)(revision);
    if (text.length > 16_384) throw Error();
    const descriptor = Schema.decodeUnknownSync(Descriptor)(text);
    const files = descriptor.files.map(file => ({ ...file, sha256: Schema.encodeSync(ShowcaseDigest)(file.sha256) }));
    const paths = [...Object.keys(inputs), "packages/greeting/message.ts"].sort();
    if (files.some((file, i) => file.path !== paths[i] ||
      Object.hasOwn(inputs, file.path) && inputs[file.path as keyof typeof inputs] !== file.sha256)) throw Error();
    return { kind: "check", repository: showcaseRepository, revision, workflowId: "demo", stepId: "test", command: showcaseTestCommand,
      policyDigest: await showcaseTestPolicyDigest(hostVersion),
      sourceDigest: await digest([files, Schema.encodeSync(ShowcaseDigest)(descriptor.dependencies), descriptor.dependencyFiles]),
      toolchainDigest: await digest([Schema.encodeSync(ShowcaseDigest)(descriptor.node), descriptor.runtime, descriptor.platform, descriptor.arch, hostVersion]) };
  } catch { throw Error("Ineligible showcase check inputs"); }
}
