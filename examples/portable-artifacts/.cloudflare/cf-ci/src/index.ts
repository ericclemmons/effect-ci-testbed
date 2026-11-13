import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import { checkoutRecipe, reportToGitHub, sourceUrl, type Params } from './github';
import type { InternalWorkflowStep } from './workflows-internal';

const image = 'workflows/node';

export class CI extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		return reportToGitHub(this.env, event, step, 'portable-artifacts / cf-ci', () => this.pipeline(event, step as InternalWorkflowStep));
	}

	private async pipeline(event: WorkflowEvent<Params>, step: InternalWorkflowStep) {
		const commit = event.payload.sha;

		const checkout = await step.runner('checkout', {
			image,
			env: { SOURCE_URL: sourceUrl(this.env, commit) },
			command: checkoutRecipe('portable-artifacts'),
			outputs: { repo: 'repo' },
		});
		const repoCharm = checkout.outputs.repo;
		if (repoCharm === null) throw new Error('checkout saved no repo');

		const build = await step.runner('build', {
			image,
			inputs: [repoCharm],
			command: 'cd repo && mkdir -p dist && echo worker > dist/worker.js',
			outputs: { worker: 'repo/dist/worker.js' },
			allowFailure: true,
		});

		// Like download-artifact, the deploy job restores only the saved file, not the checkout,
		// and chooses where it lands.
		const worker = build.outputs.worker;
		const deploy = worker
			? await step.runner('deploy', {
					image,
					inputs: [{ ...worker, path: 'dist/worker.js' }],
					command: 'test -f dist/worker.js && cat dist/worker.js',
					allowFailure: true,
				})
			: null;

		return {
			repo: this.env.GITHUB_REPO,
			ref: event.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: build.exitCode === 0 && deploy?.exitCode === 0,
			checks: {
				build: { exitCode: build.exitCode, log: build.logs.data },
				deploy: deploy ? { exitCode: deploy.exitCode, log: deploy.logs.data } : { exitCode: null, log: '', skipped: true },
			},
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/portable-artifacts on GitHub commits.'),
};
