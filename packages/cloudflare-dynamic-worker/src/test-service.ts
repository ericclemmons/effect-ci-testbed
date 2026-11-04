import * as Effect from "effect/Effect"
import * as Context from "effect/Context"
import type { ProjectTestRequest, ProjectTestResult } from "./test-protocol.ts"
export type { ProjectTestRequest, ProjectTestResult } from "./test-protocol.ts"
export interface ProjectTestsService { readonly run: (request: ProjectTestRequest) => Effect.Effect<ProjectTestResult, unknown> }
/** Portable workflow capability. Only the host chooses/provides its execution backend. */
export class ProjectTests extends Context.Service<ProjectTests, ProjectTestsService>()("@effect-ci-testbed/ProjectTests") {}
