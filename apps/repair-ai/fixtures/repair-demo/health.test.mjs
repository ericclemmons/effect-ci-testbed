import assert from "node:assert/strict"
import test from "node:test"
import { healthStatus } from "./health.js"
test("owned demo health status is healthy", () => assert.equal(healthStatus(), 200))
