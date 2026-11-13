import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import { checkoutRecipe, reportToGitHub, sourceUrl, type Params } from './github';
import type { InternalWorkflowStep, InstanceSize } from './workflows-internal';

declare global {
	interface Env {
		INSTANCE_SIZE: string;
	}
}

type Check = { exitCode: number | null; log: string; skipped?: true };

const image = 'workflows/node';
const env = { NPM_CONFIG_UPDATE_NOTIFIER: 'false' };

export class CI extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		return reportToGitHub(this.env, event, step, 'runner-selection / cf-ci', () => this.pipeline(event, step as InternalWorkflowStep));
	}

	private async pipeline(event: WorkflowEvent<Params>, step: InternalWorkflowStep) {
		const commit = event.payload.sha;

		const checkout = await step.runner('checkout', {
			image,
			env: { SOURCE_URL: sourceUrl(this.env, commit) },
			command: checkoutRecipe('runner-selection'),
			outputs: { repo: 'repo' },
		});
		const repoCharm = checkout.outputs.repo;
		if (repoCharm === null) throw new Error('checkout saved no repo');

		// Like runs-on from the EFFECT_CI_RUNS_ON repository variable: CF_CI_INSTANCE_SIZE at deploy time picks
		// the container size, and the steps stay the same.
		const instanceSize = this.env.INSTANCE_SIZE as InstanceSize;
		const checks: Record<string, Check> = {};
		for (const [name, command] of [
			['npm ci', 'npm ci'],
			['npm test', 'npm test'],
		]) {
			if (Object.values(checks).some((check) => check.exitCode !== 0)) {
				checks[name] = { exitCode: null, log: '', skipped: true };
				continue;
			}
			const result = await step.runner(name, {
				image,
				instanceSize,
				inputs: [repoCharm],
				env,
				command: `cd repo && echo "instance size: ${instanceSize}" && ${command}`,
				allowFailure: true,
			});
			checks[name] = { exitCode: result.exitCode, log: result.logs.data };
		}

		return {
			repo: this.env.GITHUB_REPO,
			ref: event.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: Object.values(checks).every((check) => check.exitCode === 0),
			checks,
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/runner-selection on GitHub commits.'),
};
