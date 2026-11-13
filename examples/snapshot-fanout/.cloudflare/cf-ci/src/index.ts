import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import { checkoutRecipe, reportToGitHub, sourceUrl, type Params } from './github';
import type { InternalWorkflowStep } from './workflows-internal';

const branches = ['left', 'right'];

const image = 'workflows/node';

export class CI extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		return reportToGitHub(this.env, event, step, 'snapshot-fanout / cf-ci', () => this.pipeline(event, step as InternalWorkflowStep));
	}

	private async pipeline(event: WorkflowEvent<Params>, step: InternalWorkflowStep) {
		const commit = event.payload.sha;

		const checkout = await step.runner('checkout', {
			image,
			env: { SOURCE_URL: sourceUrl(this.env, commit) },
			command: checkoutRecipe('snapshot-fanout'),
			outputs: { repo: 'repo' },
		});
		const repoCharm = checkout.outputs.repo;
		if (repoCharm === null) throw new Error('checkout saved no repo');

		// The prepared file is saved once and restored into each branch, like upload-artifact/download-artifact.
		const prepare = await step.runner('prepare', {
			image,
			inputs: [repoCharm],
			command: 'cd repo/app && printf prepared > prepared.txt',
			outputs: { prepared: 'repo/app/prepared.txt' },
		});
		const prepared = prepare.outputs.prepared;
		if (prepared === null) throw new Error('prepare saved no prepared.txt');

		// Both branches write the same file at the same time; each sees only its own because each has its own container.
		const results = await Promise.all(
			branches.map((name) =>
				step.runner(`check ${name}`, {
					image,
					inputs: [repoCharm, prepared],
					command: [
						'cd repo/app',
						'test "$(cat prepared.txt)" = prepared',
						`printf ${name} > branch.txt`,
						'sleep 2',
						`test "$(cat branch.txt)" = ${name}`,
						`echo "isolated ${name} check passed"`,
					].join(' && '),
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
				branches.map((name, index) => [name, { exitCode: results[index].exitCode, log: results[index].logs.data }]),
			),
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/snapshot-fanout on GitHub commits.'),
};
