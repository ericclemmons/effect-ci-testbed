import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import { checkoutRecipe, reportToGitHub, sourceUrl, type Params } from './github';
import type { InternalWorkflowStep } from './workflows-internal';

const image = 'workflows/node';
const changes = ['input', 'unchanged', 'missing', 'tampered', 'program', 'runtime', 'filesystem-loss'];

// One comparison job. Its steps share runner-local files, so they run in one container. The script writes
// its step outputs to GITHUB_OUTPUT, which this shell reads back to choose the affected steps.
const job = `set -e
cd repo
export GITHUB_OUTPUT="$(mktemp)"
node verification/conventional.mjs prepare "$CHANGE"
. "$GITHUB_OUTPUT"
export COMPARISON_ROOT="$root"
for name in left right bundle; do
  eval "selected=\\$$name"
  if [ "$selected" = true ]; then echo "run $name"; node verification/conventional.mjs run "$name"; else echo "reuse $name"; fi
done
node verification/conventional.mjs verify`;

export class CI extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		return reportToGitHub(this.env, event, step, 'dependency-aware-reruns / cf-ci', () => this.pipeline(event, step as InternalWorkflowStep));
	}

	private async pipeline(event: WorkflowEvent<Params>, step: InternalWorkflowStep) {
		const commit = event.payload.sha;

		const checkout = await step.runner('checkout', {
			image,
			env: { SOURCE_URL: sourceUrl(this.env, commit) },
			command: checkoutRecipe('dependency-aware-reruns'),
			outputs: { repo: 'repo' },
		});
		const repoCharm = checkout.outputs.repo;
		if (repoCharm === null) throw new Error('checkout saved no repo');

		const results = await Promise.all(
			changes.map((change) =>
				step.runner(`compare ${change}`, { image, inputs: [repoCharm], env: { CHANGE: change }, command: job, allowFailure: true }),
			),
		);

		return {
			repo: this.env.GITHUB_REPO,
			ref: event.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: results.every((result) => result.exitCode === 0),
			checks: Object.fromEntries(
				changes.map((change, index) => [change, { exitCode: results[index].exitCode, log: results[index].logs.data }]),
			),
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/dependency-aware-reruns on GitHub commits.'),
};
