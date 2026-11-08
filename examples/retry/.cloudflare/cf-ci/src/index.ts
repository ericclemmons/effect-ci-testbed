import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import type { InternalWorkflowStep } from './workflows-internal';

type Env = { ARTIFACTS: Artifacts; PIPELINE_SHA: string };

type PushEvent = {
	source: { namespace: string; repoName: string };
	payload: { ref: string; after: string };
};

const image = 'workflows/node';
const attempts = 2;

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

		// step.runner() can retry natively, but its command cannot see the attempt number, so each attempt
		// is its own step. The check fails on attempt 1 and passes on attempt 2, after a constant 1 second delay.
		const logs: string[] = [];
		let exitCode = -1;
		for (let attempt = 1; attempt <= attempts; attempt++) {
			if (attempt > 1) await step.sleep(`retry delay ${attempt}`, '1 second');
			const result = await step.runner(`flaky test attempt ${attempt}`, {
				image,
				inputs: [repoCharm],
				env: { ATTEMPT: String(attempt) },
				command: 'if [ "$ATTEMPT" = 1 ]; then echo "Simulated transient failure on attempt 1"; exit 1; fi; echo "passed on attempt $ATTEMPT"',
				allowFailure: true,
			});
			exitCode = result.exitCode;
			logs.push(`attempt ${attempt}: exit ${exitCode}\n${result.logs.data}`);
			if (exitCode === 0) break;
		}

		return {
			repo: repoName,
			ref: event.payload.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: exitCode === 0,
			checks: { 'flaky test': { exitCode, log: logs.join('\n') } },
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/retry on pushes to its Artifacts repo.'),
};
