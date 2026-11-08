import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import type { InternalWorkflowStep, StepResult } from './workflows-internal';

type Env = { ARTIFACTS: Artifacts; PIPELINE_SHA: string };

type PushEvent = {
	source: { namespace: string; repoName: string };
	payload: { ref: string; after: string };
};
type Check = { exitCode: number | null; log: string; skipped?: true };

const image = 'workflows/node';
// Stands in for the comparison's fail-deploy dispatch input; cf ci runs start from pushes, which carry no inputs.
const FAIL_DEPLOY = 'false';

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

		const toCheck = (result: StepResult | null): Check =>
			result ? { exitCode: result.exitCode, log: result.logs.data } : { exitCode: null, log: '', skipped: true };

		// continue-on-error: the deploy result decides whether the rollback runs.
		const deploy = await step.runner('deploy', {
			image,
			inputs: [repoCharm],
			env: { FAIL_DEPLOY },
			command: 'cd repo && test "$FAIL_DEPLOY" != true',
			allowFailure: true,
		});
		const failed = deploy.exitCode !== 0;
		const rollback = failed
			? await step.runner('redeploy the previous version', { image, inputs: [repoCharm], command: 'echo rollback', allowFailure: true })
			: null;

		// The rollback does not erase the original failure.
		return {
			repo: repoName,
			ref: event.payload.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: !failed,
			checks: { deploy: toCheck(deploy), rollback: toCheck(rollback) },
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/rollback-compensation on pushes to its Artifacts repo.'),
};
