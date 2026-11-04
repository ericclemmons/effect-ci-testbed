import * as Effect from "effect/Effect"
import * as Context from "effect/Context"

export interface ProjectCheck { readonly name: string; readonly path: string; readonly status: number; readonly body: string }
export interface ProjectRequest { readonly mainModule: string; readonly modules: Readonly<Record<string, string>>; readonly checks: readonly ProjectCheck[] }
export interface ProjectResult { readonly runtime: "dynamic-worker"; readonly passed: string[]; readonly containers: 0 }
export interface ProjectChecksService { readonly run: (request: ProjectRequest) => Effect.Effect<ProjectResult, unknown> }
export class ProjectChecks extends Context.Service<ProjectChecks, ProjectChecksService>()("@effect-ci-testbed/ProjectChecks") {}
