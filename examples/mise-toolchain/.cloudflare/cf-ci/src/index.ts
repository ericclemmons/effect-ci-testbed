import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import { checkoutRecipe, reportToGitHub, sourceUrl, type Params } from './github';
import type { InternalWorkflowStep } from './workflows-internal';

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

export class CI extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		return reportToGitHub(this.env, event, step, 'mise-toolchain / cf-ci', () => this.pipeline(event, step as InternalWorkflowStep));
	}

	private async pipeline(event: WorkflowEvent<Params>, step: InternalWorkflowStep) {
		const commit = event.payload.sha;

		const checkout = await step.runner('checkout', {
			image,
			env: { SOURCE_URL: sourceUrl(this.env, commit) },
			command: checkoutRecipe('mise-toolchain'),
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
				repo: this.env.GITHUB_REPO,
				ref: event.payload.ref,
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
			repo: this.env.GITHUB_REPO,
			ref: event.payload.ref,
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
	fetch: () => new Response('Runs cf ci for examples/mise-toolchain on GitHub commits.'),
};
