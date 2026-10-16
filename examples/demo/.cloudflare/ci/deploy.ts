import { verifyBuild } from "./verify-build.ts";

console.log(
  JSON.stringify(
    {
      mode: "deployment-preview",
      deploymentPerformed: false,
      source: ".cloudflare/ci/deploy.ts",
      directory: "dist",
      files: verifyBuild().files,
    },
    null,
    2,
  ),
);
