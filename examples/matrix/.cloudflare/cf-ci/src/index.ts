import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import { checkoutRecipe, reportToGitHub, sourceUrl, type Params } from './github';
import type { InternalWorkflowStep } from './workflows-internal';

const locales = ['en-US', 'de-DE'];
const currencies = ['USD', 'EUR'];

const image = 'workflows/node';

export class CI extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		return reportToGitHub(this.env, event, step, 'matrix / cf-ci', () => this.pipeline(event, step as InternalWorkflowStep));
	}

	private async pipeline(event: WorkflowEvent<Params>, step: InternalWorkflowStep) {
		const commit = event.payload.sha;

		const checkout = await step.runner('checkout', {
			image,
			env: { SOURCE_URL: sourceUrl(this.env, commit) },
			command: checkoutRecipe('matrix'),
			outputs: { repo: 'repo' },
		});
		const repoCharm = checkout.outputs.repo;
		if (repoCharm === null) throw new Error('checkout saved no repo');

		// Every combination runs in its own container; one failure does not stop the others (fail-fast: false).
		const combinations = locales.flatMap((locale) => currencies.map((currency) => ({ locale, currency })));
		const results = await Promise.all(
			combinations.map(({ locale, currency }) =>
				step.runner(`test ${locale} ${currency}`, {
					image,
					inputs: [repoCharm],
					command: `cd repo/app && node verify.mjs ${locale} ${currency}`,
					allowFailure: true,
				}),
			),
		);

		return {
			repo: this.env.GITHUB_REPO,
			ref: event.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: results.every((result) => result.exitCode === 0),
			checks: Object.fromEntries(
				combinations.map(({ locale, currency }, index) => [
					`${locale} ${currency}`,
					{ exitCode: results[index].exitCode, log: results[index].logs.data },
				]),
			),
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/matrix on GitHub commits.'),
};
