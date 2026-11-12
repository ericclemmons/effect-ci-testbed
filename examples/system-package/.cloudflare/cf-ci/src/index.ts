import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import { checkoutRecipe, reportToGitHub, sourceUrl, type Params } from './github';
import type { InternalWorkflowStep } from './workflows-internal';

const image = 'workflows/node';

export class CI extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		return reportToGitHub(this.env, event, step, 'system-package / cf-ci', () => this.pipeline(event, step as InternalWorkflowStep));
	}

	private async pipeline(event: WorkflowEvent<Params>, step: InternalWorkflowStep) {
		const commit = event.payload.sha;

		const checkout = await step.runner('checkout', {
			image,
			env: { SOURCE_URL: sourceUrl(this.env, commit) },
			command: checkoutRecipe('system-package'),
			outputs: { repo: 'repo' },
		});
		if (checkout.outputs.repo === null) throw new Error('checkout saved no repo');

		// Commands run as root, so apt-get needs no sudo.
		const imagemagick = await step.runner('imagemagick', {
			image,
			inputs: [checkout.outputs.repo],
			env: { DEBIAN_FRONTEND: 'noninteractive' },
			command: [
				'apt-get update -qq',
				'apt-get install --yes -qq --no-install-recommends imagemagick',
				'convert -version | grep --fixed-strings ImageMagick',
			].join(' && '),
			allowFailure: true,
		});

		return {
			repo: this.env.GITHUB_REPO,
			ref: event.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: imagemagick.exitCode === 0,
			checks: { imagemagick: { exitCode: imagemagick.exitCode, log: imagemagick.logs.data } },
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/system-package on GitHub commits.'),
};
