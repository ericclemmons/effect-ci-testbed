import type { WorkflowStep } from "cloudflare:workers";

// Fixed operator-only proof. No caller-selected source, commands or resource limits.
export function emptyParameters(value: unknown) {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length) {
    throw Error("This fixture accepts only an empty parameters object");
  }
}

export const once = { retries: { limit: 0, delay: "1 second" }, timeout: "1 minute" } as const;
export const cleanupOnce = { ...once, timeout: "30 seconds" } as const;
export function scopedSteps(step: Pick<WorkflowStep, "do">, label: string): Pick<WorkflowStep, "do"> {
  return { do: ((name: string, ...args: unknown[]) => step.do(`${label}:${name}`, once, args.at(-1) as () => Promise<any>)) as WorkflowStep["do"] };
}
