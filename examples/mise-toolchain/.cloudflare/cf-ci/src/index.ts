import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import type { InternalWorkflowStep } from './workflows-internal';

type Env = { ARTIFACTS: Artifacts; PIPELINE_SHA: string };

type PushEvent = {
	source: { namespace: string; repoName: string };
	payload: { ref: string; after: string };
};

const image = 'workflows/node';
// mise and its tools install under /workspace so the setup step can save them for the checks.
const env = {
	MISE_INSTALL_PATH: '/workspace/mise/bin/mise',
	MISE_DATA_DIR: '/workspace/mise/data',
	MISE_TRUSTED_CONFIG_PATHS: '/workspace/repo',
	MISE_YES: '1',
};
const CHECKS: Record<string, string> = {
	node: `node -e "if (process.version !== 'v22.20.0') process.exit(1)" && node --version`,
	python: `python -c "import platform; assert platform.python_version() == '3.13.7'" && python --version`,
};

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

		// Like jdx/mise-action: install mise, then the tools pinned in mise.toml.
		const setup = await step.runner('mise', {
			image,
			inputs: [repoCharm],
			env,
			command: 'curl -fsSL https://mise.run | sh && cd repo && /workspace/mise/bin/mise install',
			outputs: { mise: 'mise' },
			allowFailure: true,
		});
		const mise = setup.outputs.mise;
		if (setup.exitCode !== 0 || mise === null) {
			return {
				repo: repoName,
				ref: event.payload.payload.ref,
				commit,
				pipelineSha: this.env.PIPELINE_SHA,
				passed: false,
				checks: { mise: { exitCode: setup.exitCode, log: setup.logs.data } },
			};
		}

		const names = Object.keys(CHECKS);
		const results = await Promise.all(
			names.map((name) =>
				step.runner(name, {
					image,
					inputs: [repoCharm, mise],
					env,
					command: `cd repo && /workspace/mise/bin/mise exec -- sh -c ${JSON.stringify(CHECKS[name])}`,
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
				names.map((name, index) => [name, { exitCode: results[index].exitCode, log: results[index].logs.data }]),
			),
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/mise-toolchain on pushes to its Artifacts repo.'),
};
