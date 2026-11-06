import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import type { InternalWorkflowStep } from './workflows-internal';

type Env = { ARTIFACTS: Artifacts; PIPELINE_SHA: string };

type PushEvent = {
	source: { namespace: string; repoName: string };
	payload: { ref: string; after: string };
};

const branches = ['left', 'right'];

const image = 'workflows/node';

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
			repo: repoName,
			ref: event.payload.payload.ref,
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
	fetch: () => new Response('Runs cf ci for examples/snapshot-fanout on pushes to its Artifacts repo.'),
};
