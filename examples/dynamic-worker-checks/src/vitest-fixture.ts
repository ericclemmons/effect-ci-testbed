import type { ProjectTestRequest } from "@effect-ci-testbed/cloudflare-dynamic-worker/tests";
export const assertionModes = ["passing", "assertion-failure", "state-isolation", "cpu-loop", "forbidden-import", "host-filesystem"] as const;
export type AssertionMode = typeof assertionModes[number];
export function assertionMode(input: unknown): AssertionMode {
  if (!input || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype || Reflect.ownKeys(input).length !== 1)
    throw Error("Exact owned assertion mode required");
  const mode = Object.getOwnPropertyDescriptor(input, "mode")?.value;
  if (!assertionModes.includes(mode)) throw Error("Exact owned assertion mode required");
  return mode;
}
// All project modules are fixed RAW TEXT. Never import/evaluate them in this host.
export function assertionFixture(mode: AssertionMode): ProjectTestRequest {
  const modules: Record<string, string> = { "suite.js": "export function check(e){e(2).toBe(2);e({a:1}).toEqual({a:1});e(2).not.toBe(3)}" };
  const tests = [{ name: "owned assertion", export: "check" }];
  if (mode === "passing") {
    modules["math.js"] = "export const plus=(a,b)=>a+b";
    modules["suite.js"] = "import{plus}from'./math.js';export async function check(e){await Promise.resolve();e(plus(2,3)).toBe(5);e({a:1}).toEqual({a:1});e(2).not.toBe(3)}";
  } else if (mode === "assertion-failure") modules["suite.js"] = "export function check(e){e(2).toBe(3)}";
  else if (mode === "state-isolation") {
    modules["suite.js"] = "export function check(e){globalThis.counter=(globalThis.counter??0)+1;e(globalThis.counter).toBe(1)}";
    tests.push({ name: "fresh independent assertion", export: "check" });
  } else if (mode === "cpu-loop") modules["suite.js"] = "export function check(){while(true){}}";
  else if (mode === "forbidden-import") modules["suite.js"] = "import secret from 'forbidden-parent-binding';export function check(e){e(secret).toBe(1)}";
  else modules["suite.js"] = "import fs from 'node:fs';export function check(e){e(fs.readFileSync('/etc/passwd','utf8')).toBe('forbidden host file')}";
  return { mainModule: "suite.js", modules, tests };
}
