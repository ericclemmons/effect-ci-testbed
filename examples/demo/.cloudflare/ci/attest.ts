import { attestDemoSyntax } from "@effect-ci-testbed/cloudflare/node-syntax-signer";

console.log(JSON.stringify(await attestDemoSyntax(), null, 2));
