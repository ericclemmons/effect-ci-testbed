import assert from "node:assert/strict";
import test from "node:test";
import { MODEL } from "./budget.ts";
import { flueBudgetInput } from "./flue-policy.ts";

const request = () => ({
  messages: [{ role: "user", content: "Owned fixture only" }],
  stream: true,
  stream_options: { include_usage: true },
  max_completion_tokens: 128,
  temperature: 0,
});
const options = () => ({ returnRawResponse: true });

test("pinned text-only Flue request produces a copied bounded budget input", () => {
  const payload = request();
  const result = flueBudgetInput(MODEL, payload, options());
  assert.deepEqual(result, {
    messages: payload.messages,
    stream: false,
    max_tokens: 128,
    temperature: 0,
  });
  payload.messages[0]!.content = "changed";
  assert.equal(result.messages[0]!.content, "Owned fixture only");
  assert.equal(
    flueBudgetInput(MODEL, { ...request(), max_completion_tokens: undefined }, options())
      .max_tokens,
    2048,
  );
});

test("model, tools, gateway, headers and provider overrides cannot enter the broker", () => {
  assert.throws(() => flueBudgetInput("other", request(), options()), /rejected/);
  for (const field of ["tools", "tool_choice", "reasoning_effort", "store", "max_tokens"]) {
    assert.throws(
      () => flueBudgetInput(MODEL, { ...request(), [field]: [] }, options()),
      /rejected/,
    );
  }
  for (const field of ["gateway", "extraHeaders", "apiKey", "fetch"]) {
    assert.throws(
      () => flueBudgetInput(MODEL, request(), { ...options(), [field]: "secret" }),
      /rejected/,
    );
  }
});

test("stream contract and all existing token, role and input bounds remain fail-closed", () => {
  for (const payload of [
    { ...request(), stream: false },
    { ...request(), stream_options: {} },
    { ...request(), stream_options: { include_usage: true, extra: true } },
    { ...request(), max_completion_tokens: 2049 },
    { ...request(), temperature: 1 },
    { ...request(), messages: [{ role: "tool", content: "tool output" }] },
    { ...request(), messages: [{ role: "user", content: "a".repeat(32769) }] },
  ]) {
    assert.throws(() => flueBudgetInput(MODEL, payload, options()), /rejected/);
  }
  assert.throws(() => flueBudgetInput(MODEL, request(), {}), /rejected/);
});

test("accessors and inherited or hidden capabilities are rejected without reading them", () => {
  let reads = 0;
  const getter = {
    get messages() {
      reads++;
      throw new Error("secret");
    },
  };
  for (const value of [
    getter,
    Object.create(request()),
    Object.defineProperty(request(), "gateway", { value: "secret" }),
    {
      ...request(),
      messages: [
        {
          role: "user",
          get content() {
            reads++;
            return "secret";
          },
        },
      ],
    },
  ]) {
    assert.throws(() => flueBudgetInput(MODEL, value, options()), /rejected/);
  }
  assert.equal(reads, 0);
});

test("an already aborted request is rejected; live abort transport is not serialized", () => {
  const controller = new AbortController();
  const result = flueBudgetInput(MODEL, request(), { ...options(), signal: controller.signal });
  assert.equal("signal" in result, false);
  controller.abort();
  assert.throws(
    () => flueBudgetInput(MODEL, request(), { ...options(), signal: controller.signal }),
    /rejected/,
  );
  assert.throws(() => flueBudgetInput(MODEL, request(), { ...options(), signal: {} }), /rejected/);
});

test("hostile reflection traps cannot leak their exceptions", () => {
  const hostile = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error("private credential");
      },
    },
  );
  assert.throws(() => flueBudgetInput(MODEL, hostile, options()), {
    message: "Flue inference request rejected",
  });
  assert.throws(() => flueBudgetInput(MODEL, request(), hostile), {
    message: "Flue inference request rejected",
  });
});

test("message-array accessors and overridden methods never execute", () => {
  let reads = 0;
  const accessor = Object.defineProperty([null], "0", {
    get() {
      reads++;
      throw new Error("secret");
    },
  });
  const overridden = Object.assign(request().messages, {
    map() {
      reads++;
      throw new Error("secret");
    },
  });
  for (const messages of [accessor, overridden, Array(1)]) {
    assert.throws(() => flueBudgetInput(MODEL, { ...request(), messages }, options()), /rejected/);
  }
  assert.equal(reads, 0);
});
