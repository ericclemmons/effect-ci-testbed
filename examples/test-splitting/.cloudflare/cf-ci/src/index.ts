import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import type { InternalWorkflowStep } from './workflows-internal';

type Env = { ARTIFACTS: Artifacts; PIPELINE_SHA: string };

type PushEvent = {
	source: { namespace: string; repoName: string };
	payload: { ref: string; after: string };
};

const image = 'workflows/node';
const shards = [0, 1];

export class CI extends WorkflowEntrypoint<Env> {
	async run(event: WorkflowEvent<PushEvent>, workflowStep: WorkflowStep) {
		const step = workflowStep as InternalWorkflowStep;
		const { repoName } = event.payload.source;
		const commit = event.payload.payload.after;

		// The read token reaches the checkout through `env`, which step.runner() does not treat as secret.
		const repo = await step.do('get clone token', async () => {
			using artifactsRepo = await this.env.ARTIFACTS.get(repoName);
			const [info, token] = await Promise.all([artifactsRepo.info(), artifactsRepo.createToken('read', 3600)]);
			return { remote: info.remote, token: token.plaintext };
		});

		const checkout = await step.runner('checkout', {
			image,
			env: { GIT_TOKEN: repo.token, REMOTE: repo.remote, COMMIT: commit },
			command: [
				'git init -q repo && cd repo',
				'git -c http.extraHeader="Authorization: Bearer $GIT_TOKEN" fetch -q --depth 1 "$REMOTE" "$COMMIT"',
				'git checkout -q FETCH_HEAD',
			].join(' && '),
			outputs: { repo: 'repo' },
		});
		const repoCharm = checkout.outputs.repo;
		if (repoCharm === null) throw new Error('checkout saved no repo');

		// fail-fast: false. Each shard writes its report before exiting, so the report saves even when a test fails.
		const results = await Promise.all(
			shards.map((shard) =>
				step.runner(`test shard ${shard}/${shards.length}`, {
					image,
					inputs: [repoCharm],
					command: `cd repo/app && node scripts/run-shard.mjs ${shard} ${shards.length}`,
					outputs: { report: `repo/app/reports/shard-${shard}.json` },
					allowFailure: true,
				}),
			),
		);
		const reports = results.map((result) => result.outputs.report);

		// Like downloading both uploaded reports: every test ran exactly once across the shards.
		const verify = reports.every((report) => report !== null)
			? await step.runner('verify shard reports', {
					image,
					inputs: [repoCharm, ...reports.filter((report) => report !== null)],
					command: `cd repo/app && node scripts/verify-reports.mjs "$(jq -s . reports/shard-*.json)"`,
					allowFailure: true,
				})
			: null;

		const checks = Object.fromEntries([
			...shards.map((shard, index) => [`shard ${shard}`, { exitCode: results[index].exitCode, log: results[index].logs.data }]),
			['verify', verify ? { exitCode: verify.exitCode, log: verify.logs.data } : { exitCode: null, log: 'a shard saved no report', skipped: true }],
		]);

		return {
			repo: repoName,
			ref: event.payload.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: results.every((result) => result.exitCode === 0) && verify?.exitCode === 0,
			checks,
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/test-splitting on pushes to its Artifacts repo.'),
};
