import { attestDemoTests } from "@effect-ci-testbed/cloudflare/demo-test-signer";

console.log(JSON.stringify(await attestDemoTests(), null, 2));
