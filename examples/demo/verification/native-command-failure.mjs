// OWNED NEGATIVE FIXTURE BRANCH ONLY. Do not merge this package-script change
// into main or demo/live. It verifies actual failed-command diagnostics, not a
// repair, signed proof, successful build, candidate publication or deployment.
import { mkdirSync, writeFileSync } from "node:fs";
import console from "node:console";
import process from "node:process";
mkdirSync(".verification", { recursive: true });
// A repeat within the same workspace fails this create-only marker instead of
// claiming another intentional execution. Native retries remain configured zero.
writeFileSync(".verification/native-command-failure-attempt.txt", "one owned negative execution\n", { flag: "wx" });
console.log("NATIVE_DIAGNOSTIC_EXECUTION=1: owned compiler context");
console.error("NATIVE_DIAGNOSTIC_EXPECTED_FAILURE: intentional missing export fixture");
process.exitCode = 7;
