import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import { checkoutRecipe, reportToGitHub, sourceUrl, type Params } from './github';
import type { InternalWorkflowStep } from './workflows-internal';

const image = 'workflows/node';

// apt-get installs outside /workspace, where no output can save it, so the job's steps share one container.
// Commands run as root, so apt-get needs no sudo.
const build = [
	'apt-get update -qq',
	'apt-get install --yes -qq --no-install-recommends python3 python3-venv',
	'python3 -m venv .venv',
	'.venv/bin/pip install --no-cache-dir build==1.3.0 hatchling==1.27.0',
	'cd app && ../.venv/bin/python -m build --no-isolation',
	'ls dist',
].join(' && ');

export class CI extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		return reportToGitHub(this.env, event, step, 'cloudflare-toolchain / cf-ci', () => this.pipeline(event, step as InternalWorkflowStep));
	}

	private async pipeline(event: WorkflowEvent<Params>, step: InternalWorkflowStep) {
		const commit = event.payload.sha;

		const checkout = await step.runner('checkout', {
			image,
			env: { SOURCE_URL: sourceUrl(this.env, commit) },
			command: checkoutRecipe('cloudflare-toolchain'),
			outputs: { repo: 'repo' },
		});
		const repoCharm = checkout.outputs.repo;
		if (repoCharm === null) throw new Error('checkout saved no repo');

		const result = await step.runner('build', {
			image,
			inputs: [repoCharm],
			env: { DEBIAN_FRONTEND: 'noninteractive' },
			command: `cd repo && ${build}`,
			allowFailure: true,
		});

		return {
			repo: this.env.GITHUB_REPO,
			ref: event.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: result.exitCode === 0,
			checks: { build: { exitCode: result.exitCode, log: result.logs.data } },
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/cloudflare-toolchain on GitHub commits.'),
};
