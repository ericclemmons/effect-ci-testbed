import * as Effect from "effect/Effect"
import * as ServiceMap from "effect/ServiceMap"
import type { ProjectTestRequest, ProjectTestResult } from "./test-protocol.ts"
export type { ProjectTestRequest, ProjectTestResult } from "./test-protocol.ts"
export interface ProjectTestsService { readonly run: (request: ProjectTestRequest) => Effect.Effect<ProjectTestResult, unknown> }
/** Portable workflow capability. Only the host chooses/provides its execution backend. */
export class ProjectTests extends ServiceMap.Service<ProjectTests, ProjectTestsService>()("@effect-ci-testbed/ProjectTests") {}
