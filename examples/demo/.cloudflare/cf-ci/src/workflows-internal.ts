/**
 * Cloudflare Workflows: internal step types (`step.dynamic()` and `step.runner()`).
 *
 * These steps are only available on the internal step context, and only for accounts with the
 * Managed CI feature flag. Calling them elsewhere throws `step.<type>() is not enabled for this account`.
 *
 * Requires @cloudflare/workers-types (for `WorkerLoaderWorkerCode`, `Rpc`, and the `cloudflare:workers` types).
 */
import type {
  WorkflowBackoff,
  WorkflowDelayDuration,
  WorkflowEvent,
  WorkflowStep,
  WorkflowStepSensitivity,
  WorkflowTimeoutDuration,
} from "cloudflare:workers";

// ---------------------------------------------------------------------------
// Step config (shared with step.do())
// ---------------------------------------------------------------------------

export type WorkflowStepContext = {
  step: { name: string; count: number };
  attempt: number;
  config: {
    retries: { limit: number; delay?: WorkflowDelayDuration; backoff?: WorkflowBackoff };
    timeout: WorkflowTimeoutDuration;
    sensitive?: WorkflowStepSensitivity;
  };
};

export type WorkflowDelayFunction = (ctx: {
  ctx: WorkflowStepContext;
  error: Error;
}) => WorkflowDelayDuration | Promise<WorkflowDelayDuration>;

export type WorkflowStepConfig = {
  retries?: {
    limit: number;
    delay: WorkflowDelayDuration | WorkflowDelayFunction;
    backoff?: WorkflowBackoff;
  };
  timeout?: WorkflowTimeoutDuration;
  sensitive?: WorkflowStepSensitivity;
  concurrency?: string | [string, ...string[]];
};

// ---------------------------------------------------------------------------
// step.dynamic()
// ---------------------------------------------------------------------------

export type DynamicWorkflowBundle = {
  /** Calls with the same key (per account + workflow) share an isolate. Non-empty. */
  isolationKey: string;
  /** Name of the entrypoint class in the bundle that exposes `run(event, step)`. Non-empty. */
  entrypoint: string;
  /** Code handed to the Worker Loader. Runs with `globalOutbound: null`. */
  worker: WorkerLoaderWorkerCode;
};

export type DynamicWorkflowRunArgs = {
  event: Readonly<WorkflowEvent<unknown>>;
  /** Must be an RPC stub (e.g. the caller's `step`; callers before compat date 2026-01-20 should pass `step.dup()`). */
  step: Rpc.Stubable;
};

export type DynamicWorkflowResult = unknown;

/** Shape the loaded entrypoint must implement. */
export interface DynamicWorkflowEntrypoint {
  run(
    event: DynamicWorkflowRunArgs["event"],
    step: DynamicWorkflowRunArgs["step"],
  ): Promise<DynamicWorkflowResult>;
}

// ---------------------------------------------------------------------------
// step.runner()
// ---------------------------------------------------------------------------

/** Container sizes, smallest to largest: lite 1/16 vCPU, basic 1/4, standard-1 1/2, standard-2 1, standard-3 2, standard-4 4. */
export type InstanceSize =
  | "lite"
  | "basic"
  | "standard-1"
  | "standard-2"
  | "standard-3"
  | "standard-4";

/** Images Cloudflare manages, started by name. */
export type ManagedImage = "cloudflare/debian-trixie" | "workflows/node" | "workflows/python";

/** The customer's own image, pushed to their Cloudflare registry under `cf-workflows/` and prepared. */
export type CustomerImage = {
  /** Plain lowercase repository path, e.g. "my-toolchain". No registry, account, or `..`. */
  repository: string;
  /** "sha256:" followed by 64 lowercase hex characters. */
  digest: `sha256:${string}`;
};

/**
 * Container path. Relative paths resolve against `/workspace`, so `dist`, `./dist/` and `/workspace/dist`
 * all become `/workspace/dist`.
 */
export type ContainerPath = string;

/**
 * A step output: a pointer to stored files plus where to restore them. Treat `store`, `version` and `data`
 * as opaque; you may change `path` to restore somewhere else.
 */
export type Charm = {
  store: string;
  version: number;
  path: ContainerPath;
  data: Record<string, string | number | boolean | null>;
};

/** What callers pass to `step.runner()`. */
export type RunnerOptionsInput = {
  /** Defaults to 'cloudflare/debian-trixie'. */
  image?: ManagedImage | CustomerImage;
  /** Defaults to 'standard-1' (1/2 vCPU, 4 GiB). */
  instanceSize?: InstanceSize;
  /** Names must match /^[A-Za-z_][A-Za-z0-9_]*$/. Not for secrets: values can end up in error messages and logs. */
  env?: Record<string, string>;
  /** Shell command. Must not be blank. */
  command: string;
  /** Restored in order; a later input at the same or a parent path replaces earlier ones. */
  inputs?: Charm[];
  /** Output name (a JavaScript identifier) -> container path to save after the command. */
  outputs?: Record<string, ContainerPath>;
  /** When true, a non-zero exit does not fail the step: outputs are still saved and `exitCode` is returned. Default false. */
  allowFailure?: boolean;
};

/** Last 16 KiB of the command's output. For full logs, redirect them to a file and save it as an output. */
export type LogTail = {
  data: string;
  /** True when the stream was longer and its beginning was dropped. */
  truncated: boolean;
};

export type StepResult = {
  /** Every declared output by name; `null` when it didn't exist after an allowed failure. */
  outputs: Record<string, Charm | null>;
  exitCode: number;
  /** stdout and stderr combined, in the order the command wrote them. */
  logs: LogTail;
};

// ---------------------------------------------------------------------------
// Internal step context
// ---------------------------------------------------------------------------

export type InternalWorkflowStep = WorkflowStep & {
  dynamic(
    name: string,
    bundle: DynamicWorkflowBundle,
    args: DynamicWorkflowRunArgs,
  ): Promise<DynamicWorkflowResult>;

  runner(name: string, options: RunnerOptionsInput): Promise<StepResult>;
  runner(
    name: string,
    config: WorkflowStepConfig,
    options: RunnerOptionsInput,
  ): Promise<StepResult>;
};
