import assert from "node:assert/strict";
import test from "node:test";
import { publicIncidentTrigger } from "./public-trigger.ts";

test("only a canonical admitted error event can select the private repair route", () => {
  const event = { type: "observability_issue", admissionId: "public-incident-" + "a".repeat(64) };
  assert.deepEqual(publicIncidentTrigger(event), event);
  for (const value of [null, [], {}, { ...event, type: "push" },
    { ...event, admissionId: "caller-chosen" }, { ...event, repository: "foreign" },
    { ...event, workflow: "PublicIncidentRepairWorkflow" }, { ...event, prompt: "fix this" },
    { ...event, [Symbol("extra")]: true }]) assert.throws(() => publicIncidentTrigger(value));
  let accessed = false;
  assert.throws(() => publicIncidentTrigger({ ...event, get admissionId() { accessed = true; return event.admissionId; } }));
  assert.equal(accessed, false);
});
