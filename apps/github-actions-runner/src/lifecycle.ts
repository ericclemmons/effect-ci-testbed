import type { GitHub } from "./github.ts";
import type { Enrollment, Job } from "./policy.ts";

export type Lease = {
  policy: Enrollment;
  job: Job;
  name: string;
  deadline: number;
  phase: "authorizing" | "minting" | "starting" | "running" | "cleaning" | "quarantined" | "done";
  runnerId?: number;
  reason?: string;
};
export interface Ports {
  read(): Promise<Lease | undefined>;
  claim(lease: Lease): Promise<boolean>;
  write(lease: Lease): Promise<void>;
  alarm(at: number): Promise<void>;
  now(): number;
  github(policy: Enrollment): Pick<GitHub, "token" | "authorize" | "jit" | "runner" | "remove" | "find">;
  start(config: string, lifetimeSeconds: number): Promise<void>;
  destroy(): Promise<void>;
}

// Durable journal first, external side effect second. A restart never remints
// or relaunches a lease. Only identity-checked, idempotent cleanup is retried.
export class RunnerLifecycle {
  readonly ports: Ports;
  constructor(ports: Ports) { this.ports = ports; }

  async launch(job: Job, policy: Enrollment, name: string): Promise<void> {
    const lease: Lease = { policy, job, name, deadline: this.ports.now() + policy.lifetimeSeconds * 1000, phase: "authorizing" };
    if (!await this.ports.claim(lease)) return;
    await this.ports.alarm(this.ports.now() + 30000);
    try {
      const github = this.ports.github(policy);
      const token = await github.token();
      if (!await github.authorize(job, token)) {
        lease.phase = "done"; lease.reason = "ineligible-or-no-longer-queued";
        await this.ports.write(lease); return;
      }
      if (this.ports.now() >= lease.deadline) throw new Error("expired");
      lease.phase = "minting";
      await this.ports.write(lease);
      const jit = await github.jit(name, token);
      lease.runnerId = jit.id;
      lease.phase = "starting";
      await this.ports.write(lease);
      if (this.ports.now() >= lease.deadline) throw new Error("expired");
      // JIT is never written to durable storage, logs, responses or history.
      await this.ports.start(jit.config, Math.max(1, Math.floor((lease.deadline - this.ports.now()) / 1000)));
      lease.phase = "running";
      await this.ports.write(lease);
    } catch {
      // Never persist raw exceptions: upstream errors may contain credentials.
      lease.reason = "provisioning-incomplete";
      if (lease.phase === "minting") lease.phase = "quarantined";
      else lease.phase = "cleaning";
      await this.ports.write(lease);
    }
  }

  async reconcile(): Promise<Lease["phase"] | "absent"> {
    const lease = await this.ports.read();
    if (!lease || lease.phase === "done") return lease?.phase ?? "absent";
    // Install the next alarm before any potentially failing network operation.
    await this.ports.alarm(this.ports.now() + 30000);
    try {
      const expired = this.ports.now() >= lease.deadline;
      if ((lease.phase === "authorizing" || lease.phase === "minting" || lease.phase === "starting") && !expired)
        return lease.phase;
      // A GitHub outage must never extend the Linux compute lifetime. Stop
      // compute first at the deadline, even when no token can be minted.
      const stopFirst = expired || lease.phase === "cleaning" || lease.phase === "quarantined";
      if (stopFirst) await this.ports.destroy();
      const github = this.ports.github(lease.policy);
      const token = await github.token();
      if (lease.phase === "running" && !expired &&
        lease.runnerId && await github.runner(lease.runnerId, lease.name, token)) return "running";
      // Destroy the container before revoking registration; failure holds the
      // capacity slot, so another container cannot start alongside an orphan.
      if (!stopFirst) await this.ports.destroy();
      if (lease.phase === "minting" || lease.phase === "quarantined") {
        lease.phase = "quarantined";
        if (!lease.runnerId) {
          const found = await github.find(lease.name, token);
          if (found) lease.runnerId = found;
        }
        await this.ports.write(lease);
        // Lost JIT ACK with no observable registration is uncertain, not proof
        // that GitHub never accepted it. Hold capacity; never remint automatically.
        if (!lease.runnerId) return "quarantined";
      }
      lease.phase = "cleaning";
      await this.ports.write(lease);
      if (lease.runnerId) await github.remove(lease.runnerId, lease.name, token);
      lease.phase = "done";
      lease.reason ??= this.ports.now() >= lease.deadline ? "lease-expired" : "runner-removed";
      await this.ports.write(lease);
      return "done";
    } catch {
      // Cleanup is retried; provisioning is not. Keep the evidence and capacity.
      return lease.phase;
    }
  }
}
