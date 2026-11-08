import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import type { InternalWorkflowStep } from './workflows-internal';

type Env = { ARTIFACTS: Artifacts; PIPELINE_SHA: string };

type PushEvent = {
	source: { namespace: string; repoName: string };
	payload: { ref: string; after: string };
};

const image = 'workflows/node';
const env = { NPM_CONFIG_UPDATE_NOTIFIER: 'false' };

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

		// No workflow lists the checks: every package script becomes one. The Worker cannot read
		// the checkout, so the discovery step prints the script names as its last log line.
		const discover = await step.runner('discover', {
			image,
			inputs: [repoCharm],
			command: `cd repo && node -p "JSON.stringify(Object.keys(require('./package.json').scripts ?? {}))"`,
		});
		const names: string[] = JSON.parse(discover.logs.data.trim().split('\n').at(-1) ?? '[]');
		if (names.length === 0) throw new Error('discovered no package scripts');

		// zero-config has no dependencies, so npm ci creates no node_modules to hand to the checks.
		await step.runner('install', { image, inputs: [repoCharm], env, command: 'cd repo && npm ci' });

		const results = await Promise.all(
			names.map((name) =>
				step.runner(name, { image, inputs: [repoCharm], env, command: `cd repo && npm run ${name}`, allowFailure: true }),
			),
		);

		return {
			repo: repoName,
			ref: event.payload.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: results.every((result) => result.exitCode === 0),
			checks: Object.fromEntries(
				names.map((name, index) => [name, { exitCode: results[index].exitCode, log: results[index].logs.data }]),
			),
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/zero-config on pushes to its Artifacts repo.'),
};
