import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import type { InternalWorkflowStep, InstanceSize } from './workflows-internal';

type Env = { ARTIFACTS: Artifacts; PIPELINE_SHA: string; INSTANCE_SIZE: string };

type PushEvent = {
	source: { namespace: string; repoName: string };
	payload: { ref: string; after: string };
};
type Check = { exitCode: number | null; log: string; skipped?: true };

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

		// Like runs-on from the EFFECT_CI_RUNS_ON repository variable: CF_CI_INSTANCE_SIZE at deploy time picks
		// the container size, and the steps stay the same.
		const instanceSize = this.env.INSTANCE_SIZE as InstanceSize;
		const checks: Record<string, Check> = {};
		for (const [name, command] of [
			['npm ci', 'npm ci'],
			['npm test', 'npm test'],
		]) {
			if (Object.values(checks).some((check) => check.exitCode !== 0)) {
				checks[name] = { exitCode: null, log: '', skipped: true };
				continue;
			}
			const result = await step.runner(name, {
				image,
				instanceSize,
				inputs: [repoCharm],
				env,
				command: `cd repo && echo "instance size: ${instanceSize}" && ${command}`,
				allowFailure: true,
			});
			checks[name] = { exitCode: result.exitCode, log: result.logs.data };
		}

		return {
			repo: repoName,
			ref: event.payload.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: Object.values(checks).every((check) => check.exitCode === 0),
			checks,
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/runner-selection on pushes to its Artifacts repo.'),
};
