import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import { checkoutRecipe, reportToGitHub, sourceUrl, type Params } from './github';
import type { InternalWorkflowStep, Charm } from './workflows-internal';

type Check = { exitCode: number | null; log: string; skipped?: true };
type JobStep = { name: string; command: string; outputs?: Record<string, string> };

// The comparison job runs in node:24-bookworm; the managed image is Debian trixie with Node.js 24.
const STEPS: JobStep[] = [
	{ name: 'npm ci', command: 'npm ci' },
	{ name: 'linux', command: 'test "$(uname -s)" = Linux' },
	{ name: 'npm test', command: 'npm test' },
];

const image = 'workflows/node';
const env = { NPM_CONFIG_UPDATE_NOTIFIER: 'false' };

export class CI extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		return reportToGitHub(this.env, event, step, 'local-container / cf-ci', () => this.pipeline(event, step as InternalWorkflowStep));
	}

	private async pipeline(event: WorkflowEvent<Params>, step: InternalWorkflowStep) {
		const commit = event.payload.sha;

		const checkout = await step.runner('checkout', {
			image,
			env: { SOURCE_URL: sourceUrl(this.env, commit) },
			command: checkoutRecipe('local-container'),
			outputs: { repo: 'repo' },
		});
		const repoCharm = checkout.outputs.repo;
		if (repoCharm === null) throw new Error('checkout saved no repo');

		// A GitHub Actions job shares one filesystem. Here every step starts a fresh container, so each
		// restores the outputs of the steps before it. The first failure skips the rest.
		const inputs: Charm[] = [repoCharm];
		const checks: Record<string, Check> = {};
		for (const { name, command, outputs } of STEPS) {
			if (Object.values(checks).some((check) => check.exitCode !== 0)) {
				checks[name] = { exitCode: null, log: '', skipped: true };
				continue;
			}
			const result = await step.runner(name, {
				image,
				inputs: [...inputs],
				env,
				command: `cd repo && ${command}`,
				outputs,
				allowFailure: true,
			});
			checks[name] = { exitCode: result.exitCode, log: result.logs.data };
			for (const charm of Object.values(result.outputs)) if (charm) inputs.push(charm);
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
	fetch: () => new Response('Runs cf ci for examples/local-container on GitHub commits.'),
};
