import * as CI from "@effect-ci-testbed/ci"
import { inputEvidenceCheckCache } from "@effect-ci-testbed/github"

import * as actions from "./actions.ts"

const workflow = CI.workflow("squash-safe-evidence", () => actions.inputsLint())

export const local = ({ root }: { readonly root: string }): CI.RunConfiguration => {
  const publicKey = process.env.EFFECT_CI_CHECK_PUBLIC_KEY
  if (!publicKey) return {}

  return {
    checkCache: inputEvidenceCheckCache({
      cwd: root,
      ...(process.env.EFFECT_CI_CHECK_PRIVATE_KEY
        ? { privateKey: process.env.EFFECT_CI_CHECK_PRIVATE_KEY }
        : {}),
      publicKey,
    }),
  }
}

export default workflow
