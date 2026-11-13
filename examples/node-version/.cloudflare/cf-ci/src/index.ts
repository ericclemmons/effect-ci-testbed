import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import { checkoutRecipe, reportToGitHub, sourceUrl, type Params } from './github';
import type { InternalWorkflowStep } from './workflows-internal';

const image = 'workflows/node';

export class CI extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		return reportToGitHub(this.env, event, step, 'node-version / cf-ci', () => this.pipeline(event, step as InternalWorkflowStep));
	}

	private async pipeline(event: WorkflowEvent<Params>, step: InternalWorkflowStep) {
		const commit = event.payload.sha;

		const checkout = await step.runner('checkout', {
			image,
			env: { SOURCE_URL: sourceUrl(this.env, commit) },
			command: checkoutRecipe('node-version'),
			outputs: { repo: 'repo' },
		});
		const repoCharm = checkout.outputs.repo;
		if (repoCharm === null) throw new Error('checkout saved no repo');

		// The managed image ships Node.js 24, so install the version from .node-version, like setup-node.
		const setup = await step.runner('setup node', {
			image,
			inputs: [repoCharm],
			command: [
				'version="$(tr -d "v[:space:]" < repo/.node-version)"',
				'case "$(uname -m)" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) echo "unsupported $(uname -m)"; exit 1 ;; esac',
				'mkdir -p node',
				'curl -fsSL "https://nodejs.org/dist/v$version/node-v$version-linux-$arch.tar.gz" | tar -xz -C node --strip-components 1',
				'node/bin/node --version',
			].join(' && '),
			outputs: { node: 'node' },
		});
		const node = setup.outputs.node;
		if (node === null) throw new Error('setup node saved no Node.js');

		const check = await step.runner('check version', {
			image,
			inputs: [repoCharm, node],
			command: `export PATH="/workspace/node/bin:$PATH" && cd repo && node -e "if (process.version !== 'v22.20.0') process.exit(1)" && node --version`,
			allowFailure: true,
		});

		return {
			repo: this.env.GITHUB_REPO,
			ref: event.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: check.exitCode === 0,
			checks: { node: { exitCode: check.exitCode, log: check.logs.data } },
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/node-version on GitHub commits.'),
};
